// Port of packages/agent-loop/src/providers.js fetchWithRetry/streamWithRetry; keep the two in step.
import type { ProviderEvent, RetryEvent } from './types.js'

// Provider error bodies that mean "try again", across Anthropic/OpenAI/relay shapes.
const RETRYABLE_ERROR_CODES = new Set([
  'service_overloaded',
  'overloaded_error',
  'rate_limit_exceeded',
  'rate_limit_error',
  'server_error',
  'internal_server_error',
])

const RETRY_BACKOFF_MS = [2000, 5000, 12000]
const MAX_RETRY_DELAY_MS = 30_000
export const MAX_PROVIDER_ATTEMPTS = RETRY_BACKOFF_MS.length + 1

export const STREAM_TERMINATED = 'stream terminated before content'

type RetryInfo = Omit<RetryEvent, 'type'>
type Sleep = (ms: number) => Promise<void>
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

// +/-20% so concurrent retries don't all land on the same tick.
const jittered = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4))

function parseErrorCode(text: string): string | null {
  try {
    const body = JSON.parse(text)
    return body?.error?.code ?? body?.error?.type ?? null
  } catch {
    return null
  }
}

function isRetryableStatus(status: number, text: string): boolean {
  if (status === 429 || (status >= 500 && status <= 599)) return true
  const code = parseErrorCode(text)
  return code != null && RETRYABLE_ERROR_CODES.has(code)
}

// undici throws `TypeError` both when fetch fails and when a body read is cut off (`terminated`).
function isRetryableNetworkError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === 'ECONNRESET' || e?.cause?.code === 'ECONNRESET' || err instanceof TypeError
}

function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

function backoffDelayMs(attempt: number, headerDelayMs: number | null): number {
  const base = headerDelayMs ?? jittered(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
  return Math.min(base, MAX_RETRY_DELAY_MS)
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

interface RetryOptions {
  onRetry?(event: RetryInfo): void
  sleep?: Sleep
  maxAttempts?: number
  firstAttempt?: number
}

// Retries a 429/5xx, an overloaded or rate-limited error body, or a failed connection. Returns the
// Response with its body unread, or the final failure with its body read.
export async function fetchWithRetry(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  { onRetry, sleep = defaultSleep, maxAttempts = MAX_PROVIDER_ATTEMPTS, firstAttempt = 1 }: RetryOptions = {},
): Promise<Response | { ok: false; status: number; text: string }> {
  for (let attempt = firstAttempt; ; attempt += 1) {
    let res: Response
    try {
      res = await fetchImpl(url, init)
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableNetworkError(err)) throw err
      const delayMs = backoffDelayMs(attempt, null)
      onRetry?.({ attempt, maxAttempts, status: null, reason: (err as Error).message, delayMs })
      await sleep(delayMs)
      continue
    }
    if (res.ok) return res
    const text = await res.text()
    if (attempt >= maxAttempts || !isRetryableStatus(res.status, text)) return { ok: false, status: res.status, text }
    const delayMs = backoffDelayMs(attempt, retryAfterMs(res.headers))
    onRetry?.({ attempt, maxAttempts, status: res.status, reason: text, delayMs })
    await sleep(delayMs)
  }
}

// POSTs and yields parse(body). A body cut off by a network error before any text or tool call
// reached the caller is requested again within the same budget; one cut off after is not, since the
// caller has already sent that text on.
export async function* streamWithRetry(
  label: string,
  url: string,
  init: RequestInit,
  parse: (body: ReadableStream<Uint8Array> | null) => AsyncGenerator<ProviderEvent>,
  { sleep = defaultSleep, maxAttempts = MAX_PROVIDER_ATTEMPTS }: { sleep?: Sleep; maxAttempts?: number } = {},
): AsyncGenerator<ProviderEvent> {
  let attempt = 1
  for (;;) {
    const retries: RetryInfo[] = []
    const res = await fetchWithRetry(fetch, url, init, {
      onRetry: (event) => retries.push(event),
      sleep,
      maxAttempts,
      firstAttempt: attempt,
    })
    attempt += retries.length
    for (const event of retries) yield { type: 'retry', ...event }
    if (!(res instanceof Response)) throw new Error(`${label}: ${res.text} (status ${res.status})`)
    let replied = false
    try {
      for await (const event of parse(res.body)) {
        if (event.type === 'text' || event.type === 'tool_use') replied = true
        yield event
      }
      return
    } catch (err) {
      if (!isRetryableNetworkError(err)) throw err
      const message = (err as Error).message
      if (replied) throw new Error(`${label}: stream terminated after the reply began (${message})`, { cause: err })
      if (attempt >= maxAttempts) {
        throw new Error(`${label}: ${STREAM_TERMINATED} on all ${maxAttempts} attempts (${message})`, { cause: err })
      }
      const delayMs = backoffDelayMs(attempt, null)
      yield { type: 'retry', attempt, maxAttempts, status: null, reason: `${STREAM_TERMINATED} (${message})`, delayMs }
      await sleep(delayMs)
      attempt += 1
    }
  }
}
