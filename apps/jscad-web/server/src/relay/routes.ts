import type { Express, Request, Response } from 'express'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadAllowlistFile } from './allowlist.js'
import { createChatLog, teeRelayUpstream } from './chatLog.js'
import { costUsd, createMeter, estimateTokens, ipGroup, parseUsage } from './meter.js'
import { RATE_PER_MIN, RelayRefusal, createLimiter, isTrustedRequest, pickForwardHeaders, resolveTarget } from './policy.js'
import { DEFAULT_SHARED_PATH, loadSharedFile } from './shared.js'

export interface RelayRouteOptions {
  allowlistPath: string
  trustedOrigins: string[]
  logger?: (entry: Record<string, unknown>) => void
  fetchFn?: typeof fetch
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
  /** Where the chat log goes: `CHAT_LOG_DIR`, then `./data/chat-logs`. `0` turns logging off. */
  chatLogDir?: string
  /** Days of chat log to keep: `CHAT_LOG_RETAIN_DAYS`, then 90. */
  chatLogRetainDays?: number
  /** Shared (demo) options file: `RELAY_SHARED`, then `/etc/jscad-relay/shared.json`. */
  sharedPath?: string
  /** Meter state file: `RELAY_SPEND_PATH`, then `./data/relay-spend.json`. */
  sharedSpendPath?: string
  /** Clock seam for the meter; defaults to `Date.now`. */
  now?: () => number
}

const DEFAULT_CHAT_LOG_DIR = './data/chat-logs'
const DEFAULT_CHAT_LOG_RETAIN_DAYS = 90
const DEFAULT_SPEND_PATH = './data/relay-spend.json'
const SHARED_CACHE_MS = 5_000
// Two turns per IP group may be in flight; a third is refused, and agent-loop
// retries the 429, which suits a concurrency bound.
const MAX_SHARED_IN_FLIGHT = 2
const DAY_MS = 24 * 60 * 60 * 1000
// One file per UTC day, named after that day, so retention reads the names.
const LOG_FILE_NAME = /^\d{4}-\d{2}-\d{2}\.jsonl$/

const resolveRetainDays = (override?: number) => {
  if (override !== undefined) return override
  const fromEnv = Number(process.env.CHAT_LOG_RETAIN_DAYS)
  return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_CHAT_LOG_RETAIN_DAYS
}

/**
 * Deletes the day files older than the retention window. Only our own file
 * names go, so an operator's stray file in the directory survives, and a
 * directory that was never written is simply left alone.
 */
const pruneChatLogs = (dir: string, days: number, now = Date.now()) => {
  const oldest = new Date(now - days * DAY_MS).toISOString().slice(0, 10)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (!LOG_FILE_NAME.test(name) || name.slice(0, 10) >= oldest) continue
    try {
      unlinkSync(join(dir, name))
    } catch {
      // A file that vanished between readdir and unlink is already pruned.
    }
  }
}

let cached: { at: number; path: string; table: Record<string, string> } | null = null

const readAllowlist = (path: string): Record<string, string> => {
  const now = Date.now()
  if (cached && cached.path === path && now - cached.at < 5_000) return cached.table
  const table = loadAllowlistFile(path)
  cached = { at: now, path, table }
  return table
}

/**
 * The body a shared option forwards: the client's, with the model pinned to the
 * option's, `stream` on, and the output cap the smaller of the client's and the
 * option's. Chat completions also ask for `stream_options.include_usage` so the
 * meter can read the real cost; tools and effort pass through untouched.
 */
const rewriteSharedBody = (client: unknown, option: { model: string; path: string; maxTokens: number }): Record<string, unknown> => {
  const source = client !== null && typeof client === 'object' && !Array.isArray(client) ? (client as Record<string, unknown>) : {}
  const cap = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, option.maxTokens) : option.maxTokens
  const body: Record<string, unknown> = { ...source, model: option.model, stream: true }
  if (option.path.endsWith('chat/completions')) {
    body.max_tokens = cap(source.max_tokens)
    const streamOptions = source.stream_options !== null && typeof source.stream_options === 'object' ? (source.stream_options as Record<string, unknown>) : {}
    body.stream_options = { ...streamOptions, include_usage: true }
  } else {
    body.max_output_tokens = cap(source.max_output_tokens)
  }
  return body
}

export function mountRelayRoutes(app: Express, options: RelayRouteOptions): void {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)))
  const fetchFn = options.fetchFn ?? fetch
  const { dnsLookup } = options
  // Many browsers share this relay, so a client gets a small burst.
  const limiter = createLimiter({ ratePerMin: RATE_PER_MIN, burst: 10 })
  const allowed = new Set(options.trustedOrigins)
  const chatLogDir = options.chatLogDir ?? process.env.CHAT_LOG_DIR ?? DEFAULT_CHAT_LOG_DIR
  const log = chatLogDir === '0' ? null : createChatLog(chatLogDir)
  if (log) {
    // At startup, and then once a day for a server that stays up for months.
    const keepDays = resolveRetainDays(options.chatLogRetainDays)
    pruneChatLogs(chatLogDir, keepDays)
    setInterval(() => pruneChatLogs(chatLogDir, keepDays), DAY_MS).unref()
  }

  const corsFor = (req: Request, res: Response): boolean => {
    if (!isTrustedRequest(req.headers, allowed)) return false
    const origin = req.headers.origin
    if (typeof origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    return true
  }

  // Demo provider: operator-owned options on server-held keys. Read through the
  // same 5-second cache as the allowlist so an edit applies without a restart.
  const sharedPath = options.sharedPath ?? process.env.RELAY_SHARED ?? DEFAULT_SHARED_PATH
  const spendPath = options.sharedSpendPath ?? process.env.RELAY_SPEND_PATH ?? DEFAULT_SPEND_PATH
  const meter = createMeter({ statePath: spendPath, now: options.now })
  let sharedCache: { at: number; path: string; config: ReturnType<typeof loadSharedFile> } | null = null
  const readShared = (): ReturnType<typeof loadSharedFile> => {
    const at = Date.now()
    if (sharedCache && sharedCache.path === sharedPath && at - sharedCache.at < SHARED_CACHE_MS) return sharedCache.config
    const config = loadSharedFile(sharedPath)
    sharedCache = { at, path: sharedPath, config }
    return config
  }
  /** In-flight demo turns per IP group, so one network cannot hold the keys open. */
  const inFlight = new Map<string, number>()

  app.get('/api/relay/shared', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    let config: ReturnType<typeof loadSharedFile>
    try {
      config = readShared()
    } catch (err) {
      // A broken file hides demo rather than breaking the page; the operator
      // learns from the log.
      logger({ relay: 'shared-config-error', message: (err as Error).message })
      res.json([])
      return
    }
    const available = meter.available({ monthlyUsd: config.monthlyUsd, perIpDailyUsd: config.perIpDailyUsd })
    res.json(config.options.map((o) => ({ id: o.id, label: o.label, kind: o.kind, model: o.model, available })))
  })

  app.post('/api/relay/shared/:id/*splat', async (req, res) => {
    const ts = new Date().toISOString()
    const started = Date.now()
    if (!corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    let config: ReturnType<typeof loadSharedFile>
    try {
      config = readShared()
    } catch (err) {
      logger({ relay: 'shared-config-error', message: (err as Error).message })
      res.status(500).json({ error: 'relay: shared config unavailable' })
      return
    }
    const { id, splat } = req.params as unknown as { id: string; splat?: string[] | string }
    const subPath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '')
    // The path must be exactly the option's: it pins kind, model and endpoint,
    // so anything else is not this option.
    const option = config.options.find((o) => o.id === id)
    if (!option || subPath !== option.path) {
      res.status(404).json({ error: 'unknown shared option' })
      return
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const budgets = { monthlyUsd: config.monthlyUsd, perIpDailyUsd: config.perIpDailyUsd }
    const quota = meter.check(ip, budgets)
    if (!quota.ok) {
      const scope = quota.scope
      res.status(402).json({
        error: {
          code: 'shared_quota_exhausted',
          scope,
          message:
            scope === 'month'
              ? 'shared keys monthly budget exhausted'
              : 'shared keys daily budget exhausted for this network',
        },
      })
      return
    }
    const group = ipGroup(ip)
    if ((inFlight.get(group) ?? 0) >= MAX_SHARED_IN_FLIGHT) {
      res.setHeader('Retry-After', '2')
      res.status(429).json({ error: 'too many in flight' })
      return
    }
    inFlight.set(group, (inFlight.get(group) ?? 0) + 1)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      const left = (inFlight.get(group) ?? 1) - 1
      if (left <= 0) inFlight.delete(group)
      else inFlight.set(group, left)
    }
    res.on('close', release)
    // Registered before any await below, so a client that leaves during DNS
    // resolution is observed and no upstream request is sent on its behalf.
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })

    // The client key is whatever the sentinel was; it is dropped here and never
    // trusted. Only the operator's key goes upstream.
    const bodyText = JSON.stringify(rewriteSharedBody(req.body, option))
    const headers = pickForwardHeaders(req.headers)
    delete headers.authorization
    delete headers['x-api-key']
    headers.authorization = `Bearer ${option.key}`
    const chatIdHeader = req.headers['x-jscad-chat-id']
    const chatId = typeof chatIdHeader === 'string' && chatIdHeader !== '' ? chatIdHeader : null
    // Demo turns are always recorded, chat id or not.
    const tee = teeRelayUpstream({ log, ts, kind: option.kind, path: option.path, request: Buffer.from(bodyText), chatId, started })

    let table: Record<string, string>
    try {
      table = readAllowlist(options.allowlistPath)
    } catch (err) {
      logger({ relay: 'allowlist-error', message: (err as Error).message })
      res.status(500).json({ error: 'relay: allowlist unavailable' })
      release()
      return
    }
    let upstream: string
    try {
      upstream = await resolveTarget({ allowlist: table, kind: option.kind, subPath: option.path, dnsLookup })
    } catch (err) {
      if (!(err instanceof RelayRefusal)) throw err
      res.status(err.status).json({ error: err.message })
      release()
      return
    }
    // The client left while we were resolving: no request reached the provider,
    // so nothing is charged, but the abandoned turn is still recorded.
    if (abort.signal.aborted) {
      tee.finish(499, { error: 'client closed', shared: option.id, costUsd: 0 })
      release()
      return
    }

    let upstreamRes: globalThis.Response
    try {
      upstreamRes = await fetchFn(upstream, { method: 'POST', headers, body: bodyText, signal: abort.signal })
    } catch {
      if (abort.signal.aborted) {
        // The client left after the request went upstream, where the provider can
        // still bill for the prompt it received, so charge the input estimate.
        const cost = costUsd({ inputTokens: estimateTokens(Buffer.byteLength(bodyText)), outputTokens: 0 }, option)
        meter.charge(ip, cost)
        tee.finish(499, { error: 'client closed', shared: option.id, costUsd: cost })
      } else {
        // Never connected, so nothing was sent and nothing is charged.
        res.status(502).json({ error: 'upstream unreachable' })
        tee.finish(502, { response: 'upstream unreachable', shared: option.id, costUsd: 0 })
      }
      release()
      return
    }

    res.status(upstreamRes.status)
    const contentType = upstreamRes.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.setHeader('cache-control', 'no-cache')

    const decoder = new TextDecoder()
    let responseText = ''
    let bytes = 0
    const settle = (status: number, error?: string): void => {
      const usage = parseUsage(responseText)
      // No usage means the stream was cut (page closed, upstream failed); the
      // provider still billed for what it generated, so charge the estimate.
      const cost = usage
        ? costUsd(usage, option)
        : costUsd(
            { inputTokens: estimateTokens(Buffer.byteLength(bodyText)), outputTokens: estimateTokens(Buffer.byteLength(responseText)) },
            option,
          )
      meter.charge(ip, cost)
      tee.finish(status, { ...(error ? { error } : {}), shared: option.id, costUsd: cost })
      release()
    }
    try {
      if (!upstreamRes.body) {
        res.end()
      } else {
        const reader = upstreamRes.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          responseText += decoder.decode(value, { stream: true })
          tee.chunk(value)
          if (!res.write(value)) await new Promise<void>((r) => res.once('drain', r))
        }
        res.end()
      }
    } catch (err) {
      settle(upstreamRes.status, abort.signal.aborted ? 'client closed' : `upstream stream failed: ${(err as Error).message}`)
      res.destroy()
      return
    }
    settle(upstreamRes.status)
    logger({ relay: `shared:${option.id}`, status: upstreamRes.status, bytes })
  })

  app.options('/api/relay/*splat', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(204).end()
      return
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'Content-Type,Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
    res.status(204).end()
  })

  const forward = async (req: Request, res: Response, method: 'GET' | 'POST') => {
    const ts = new Date().toISOString()
    const started = Date.now()
    if (!corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const limited = limiter.check(ip)
    if (!limited.ok) {
      res.setHeader('Retry-After', String(limited.retryAfterSec))
      res.status(429).json({ error: 'rate limited' })
      return
    }
    let table: Record<string, string>
    try {
      table = readAllowlist(options.allowlistPath)
    } catch (err) {
      logger({ relay: 'allowlist-error', message: (err as Error).message })
      res.status(500).json({ error: 'relay: allowlist unavailable' })
      return
    }
    const { kind, splat } = req.params as unknown as { kind: string; splat?: string[] | string }
    const subPath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '')
    let upstream: string
    try {
      upstream = await resolveTarget({ allowlist: table, kind, subPath, dnsLookup })
    } catch (err) {
      if (!(err instanceof RelayRefusal)) throw err
      res.status(err.status).json({ error: err.message })
      return
    }
    let upstreamRes: globalThis.Response
    // The chat id travels only as far as this process: logging is the one place
    // that reads it, and the header is not in FORWARD_HEADERS.
    const chatIdHeader = req.headers['x-jscad-chat-id']
    const chatId = typeof chatIdHeader === 'string' && chatIdHeader !== '' ? chatIdHeader : null
    const body = method === 'GET' ? undefined : JSON.stringify(req.body ?? {})
    const tee =
      log && method === 'POST' && chatId
        ? teeRelayUpstream({
            log,
            ts,
            kind,
            path: subPath,
            request: Buffer.from(body ?? ''),
            chatId,
            started,
          })
        : null
    // A page that goes away mid-answer must not leave the provider streaming to
    // nobody, which Phase 2 would pay for.
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    try {
      upstreamRes = await fetchFn(upstream, {
        method,
        headers: pickForwardHeaders(req.headers),
        signal: abort.signal,
        ...(body === undefined ? {} : { body }),
      })
    } catch {
      res.status(502).json({ error: 'upstream unreachable' })
      tee?.finish(502, { response: 'upstream unreachable' })
      return
    }
    res.status(upstreamRes.status)
    const contentType = upstreamRes.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.setHeader('cache-control', 'no-cache')
    let bytes = 0
    try {
      if (!upstreamRes.body) {
        res.end()
      } else {
        const reader = upstreamRes.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          tee?.chunk(value)
          if (!res.write(value)) await new Promise<void>((r) => res.once('drain', r))
        }
        res.end()
      }
    } catch (err) {
      // Headers are already sent, so a failed stream can only be cut off.
      tee?.finish(upstreamRes.status, {
        error: abort.signal.aborted ? 'client closed' : `upstream stream failed: ${(err as Error).message}`,
      })
      res.destroy()
      return
    }
    tee?.finish(upstreamRes.status)
    logger({ relay: kind, status: upstreamRes.status, bytes })
  }

  app.post('/api/relay/:kind/*splat', async (req, res) => forward(req, res, 'POST'))
  app.get('/api/relay/:kind/*splat', async (req, res) => forward(req, res, 'GET'))
}
