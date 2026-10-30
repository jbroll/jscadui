// Spend meter for the jscad-web inference (free) models: the month's total and
// the per-IP group spend for the current UTC day, persisted to one JSON file so
// a restart does not reset it. One instance per server process.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname } from 'node:path'
import { v6Groups } from './policy.js'

export interface MeterBudgets {
  monthlyUsd: number
  perIpDailyUsd: number
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export type MeterCheck = { ok: true } | { ok: false; scope: 'month' | 'day' }

export interface Meter {
  /** Refuse once the month or the caller's IP group has reached its budget. */
  check(ip: string, budgets: MeterBudgets): MeterCheck
  /** Add a completed turn's cost to both the month and the IP group. */
  charge(ip: string, costUsd: number): void
  /** Whether the month's budget still has room (the `available` flag). */
  available(budgets: MeterBudgets): boolean
  monthSpent(): number
  daySpent(ip: string): number
}

export interface MeterOptions {
  statePath: string
  now?: () => number
  warn?: (message: string) => void
}

/** A provider that streamed nothing billable still cost roughly one token per three bytes. */
export const estimateTokens = (bytes: number): number => Math.ceil(bytes / 3)

/**
 * The last token usage in an SSE stream, in either shape: chat completions put
 * it on the final chunk's `usage.prompt_tokens`/`completion_tokens`, responses
 * on the `response.completed` event's `response.usage.input_tokens`/
 * `output_tokens`. Null when the stream carried none.
 */
export const parseUsage = (text: string): Usage | null => {
  let usage: Usage | null = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    let event: unknown
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    if (event === null || typeof event !== 'object') continue
    const record = event as {
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      response?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } }
    }
    const chat = record.usage
    if (chat && typeof chat.prompt_tokens === 'number') {
      usage = { inputTokens: chat.prompt_tokens, outputTokens: typeof chat.completion_tokens === 'number' ? chat.completion_tokens : 0 }
    }
    const responses = record.response?.usage
    if (responses && typeof responses.input_tokens === 'number') {
      usage = { inputTokens: responses.input_tokens, outputTokens: typeof responses.output_tokens === 'number' ? responses.output_tokens : 0 }
    }
  }
  return usage
}

/** Input and output tokens at the option's per-million-token rates. */
export const costUsd = (usage: Usage, prices: { inputUsdPerMTok: number; outputUsdPerMTok: number }): number =>
  (usage.inputTokens * prices.inputUsdPerMTok + usage.outputTokens * prices.outputUsdPerMTok) / 1e6

/**
 * The IPv4 form of an IPv4-mapped address, so `::ffff:a.b.c.d` and its hex
 * spelling `::ffff:aabb:ccdd` share a bucket with the plain `a.b.c.d`; null
 * for any other address.
 */
const mappedV4 = (host: string): string | null => {
  const match = /^::ffff:(.+)$/i.exec(host)
  if (!match) return null
  if (match[1].includes('.')) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(match[1]) ? match[1] : null
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(match[1])
  if (!hex) return null
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

/**
 * The budget bucket an address belongs to: the whole IPv4 address, or the /64
 * prefix of an IPv6 address, since one household or phone can use a whole /64.
 */
export const ipGroup = (ip: string): string => {
  const host = ip.replace(/^\[/, '').replace(/\]$/, '').split('%')[0]
  const kind = isIP(host)
  if (kind === 4) return host
  if (kind !== 6) return host || 'unknown'
  const embedded = mappedV4(host)
  if (embedded) return embedded
  return `${v6Groups(host).slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

interface SpendState {
  month: string
  monthSpent: number
  day: string
  ipSpend: Record<string, number>
}

const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7)
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const fresh = (ms: number): SpendState => ({ month: monthOf(ms), monthSpent: 0, day: dayOf(ms), ipSpend: {} })

/**
 * A corrupt or unreadable state file throws: silently starting the meter at
 * zero would hand out the whole budget again on every restart.
 */
const loadState = (statePath: string): SpendState | null => {
  let raw: string
  try {
    raw = readFileSync(statePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`relay: cannot read spend state ${statePath}: ${(err as Error).message}`)
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SpendState>
    if (
      typeof parsed.month !== 'string' ||
      typeof parsed.monthSpent !== 'number' ||
      typeof parsed.day !== 'string' ||
      parsed.ipSpend === null ||
      typeof parsed.ipSpend !== 'object' ||
      !Object.values(parsed.ipSpend).every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new Error('unexpected shape')
    }
    return { month: parsed.month, monthSpent: parsed.monthSpent, day: parsed.day, ipSpend: { ...parsed.ipSpend } }
  } catch (err) {
    throw new Error(`relay: spend state ${statePath} is corrupt: ${(err as Error).message}`)
  }
}

export const createMeter = ({ statePath, now = Date.now, warn = console.warn }: MeterOptions): Meter => {
  let state = loadState(statePath) ?? fresh(now())

  const persist = (): void => {
    try {
      mkdirSync(dirname(statePath), { recursive: true })
      const tmp = `${statePath}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(state))
      renameSync(tmp, statePath)
    } catch (err) {
      warn(`jscad: relay spend write failed (${(err as Error).message}); spend stays in memory`)
    }
  }

  // A day or month rollover clears the counters it owns; kept counters survive.
  const roll = (): void => {
    const month = monthOf(now())
    const day = dayOf(now())
    if (state.month !== month) {
      state = { month, monthSpent: 0, day, ipSpend: {} }
      persist()
    } else if (state.day !== day) {
      state = { ...state, day, ipSpend: {} }
      persist()
    }
  }

  roll()

  return {
    check(ip, budgets) {
      roll()
      if (state.monthSpent >= budgets.monthlyUsd) return { ok: false, scope: 'month' }
      if ((state.ipSpend[ipGroup(ip)] ?? 0) >= budgets.perIpDailyUsd) return { ok: false, scope: 'day' }
      return { ok: true }
    },
    charge(ip, cost) {
      roll()
      const group = ipGroup(ip)
      state.monthSpent += cost
      state.ipSpend[group] = (state.ipSpend[group] ?? 0) + cost
      persist()
    },
    available(budgets) {
      roll()
      return state.monthSpent < budgets.monthlyUsd
    },
    monthSpent() {
      roll()
      return state.monthSpent
    },
    daySpent(ip) {
      roll()
      return state.ipSpend[ipGroup(ip)] ?? 0
    },
  }
}
