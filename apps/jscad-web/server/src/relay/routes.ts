import type { Express, Request, Response } from 'express'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadAllowlistFile } from './allowlist.js'
import { createChatLog, teeRelayUpstream } from './chatLog.js'
import { RATE_PER_MIN, RelayRefusal, createLimiter, isTrustedRequest, pickForwardHeaders, resolveTarget } from './policy.js'

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
}

const DEFAULT_CHAT_LOG_DIR = './data/chat-logs'
const DEFAULT_CHAT_LOG_RETAIN_DAYS = 90
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
