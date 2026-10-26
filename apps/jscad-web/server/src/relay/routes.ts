import type { Express, Request, Response } from 'express'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadAllowlistFile } from './allowlist.js'
import { CHAT_LOG_FILE, createChatLog } from './chatLog.js'
import { createMeter } from './meter.js'
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from './policy.js'
import { DEFAULT_INFERENCE_PATH, loadInferenceFile } from './inference.js'
import { getHook } from './providers/index.js'

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
  /** Free inference options file: `RELAY_INFERENCE`, then `/etc/jscad-relay/jscad-inference.json`. */
  inferencePath?: string
  /** Meter state file: `RELAY_SPEND_PATH`, then `./data/relay-spend.json`. */
  inferenceSpendPath?: string
  /** Clock seam for the meter; defaults to `Date.now`. */
  now?: () => number
}

const DEFAULT_CHAT_LOG_DIR = './data/chat-logs'
export const DEFAULT_CHAT_LOG_RETAIN_DAYS = 90
const DEFAULT_SPEND_PATH = './data/relay-spend.json'
const INFERENCE_CACHE_MS = 5_000
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CHAT_LOG_RETAIN_DAYS = 3650

const resolveRetainDays = (override?: number) => {
  const raw = override ?? (process.env.CHAT_LOG_RETAIN_DAYS?.trim() ? Number(process.env.CHAT_LOG_RETAIN_DAYS) : NaN)
  if (!Number.isFinite(raw)) return DEFAULT_CHAT_LOG_RETAIN_DAYS
  return Math.min(MAX_CHAT_LOG_RETAIN_DAYS, Math.max(1, Math.floor(raw)))
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
    if (!CHAT_LOG_FILE.test(name) || name.slice(0, 10) >= oldest) continue
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
 * Mounts the single relay endpoint family, `POST|GET /api/relay/:kind/*`. Every
 * request is dispatched by its wire `kind` to the provider hook for that kind
 * (see `./providers`), which owns the protocol, logging and (for jscad-web) the
 * meter. The route is the only relay surface: there is no second route family.
 */
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

  // Free inference provider: operator-owned models on server-held keys. Read
  // through the same 5-second cache as the allowlist so an edit applies without
  // a restart.
  const inferencePath = options.inferencePath ?? process.env.RELAY_INFERENCE ?? DEFAULT_INFERENCE_PATH
  const spendPath = options.inferenceSpendPath ?? process.env.RELAY_SPEND_PATH ?? DEFAULT_SPEND_PATH
  // A bad spend file must stop only the free models, not the whole server.
  let meter: ReturnType<typeof createMeter> | null = null
  try {
    meter = createMeter({ statePath: spendPath, now: options.now })
  } catch (error) {
    logger({ relay: 'meter-unavailable', message: error instanceof Error ? error.message : String(error) })
  }
  let inferenceCache: { at: number; path: string; config: ReturnType<typeof loadInferenceFile> } | null = null
  const readInference = (): ReturnType<typeof loadInferenceFile> => {
    const at = Date.now()
    if (inferenceCache && inferenceCache.path === inferencePath && at - inferenceCache.at < INFERENCE_CACHE_MS) return inferenceCache.config
    const config = loadInferenceFile(inferencePath)
    inferenceCache = { at, path: inferencePath, config }
    return config
  }
  /** In-flight free turns per IP group, so one network cannot hold the keys open. */
  const inFlight = new Map<string, number>()

  const ctx = {
    logger,
    fetchFn,
    dnsLookup,
    corsFor,
    limiter,
    readAllowlist: () => readAllowlist(options.allowlistPath),
    log,
    readInference,
    meter,
    inFlight,
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

  const dispatch = async (req: Request, res: Response, method: 'GET' | 'POST'): Promise<void> => {
    const { kind, splat } = req.params as unknown as { kind: string; splat?: string[] | string }
    const subPath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '')
    const hook = getHook(kind)
    const serve = method === 'GET' ? hook.serveGET : hook.servePOST
    if (!serve) {
      res.status(404).json({ error: 'not found' })
      return
    }
    await serve(ctx, req, res, kind, subPath)
  }

  app.post('/api/relay/:kind/*splat', (req, res) => dispatch(req, res, 'POST'))
  app.get('/api/relay/:kind/*splat', (req, res) => dispatch(req, res, 'GET'))
}
