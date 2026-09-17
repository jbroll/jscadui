import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Express, Request, Response } from 'express'
import { loadAllowlistFile, resolveUpstream } from './allowlist.js'
import { createLimiter } from './limiter.js'

export interface RelayRouteOptions {
  allowlistPath: string
  trustedOrigins: string[]
  logger?: (entry: Record<string, unknown>) => void
  fetchFn?: typeof fetch
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
}

// Forwarded hop-by-hop headers are the caller's, not the relay's; content
// length especially must go, since the relay streams without knowing it.
const DROP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])

const pickHeaders = (req: Request): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (DROP_HEADERS.has(name.toLowerCase())) continue
    if (typeof value === 'string') out[name] = value
  }
  return out
}

const isPrivateAddr = (addr: string): boolean => {
  if (addr.includes(':')) return /^(::1|fc|fd|fe[89ab])/i.test(addr)
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.)/.test(addr)
}

// Hostnames are resolved here, at forward time: DNS between allowlist load
// and this request could otherwise point a permitted name at a private IP.
const assertPublicHost = async (
  url: string,
  dnsLookup: (host: string) => Promise<Array<{ address: string }>>,
): Promise<void> => {
  const host = new URL(url).hostname
  if (isIP(host)) return
  const records = await dnsLookup(host)
  if (records.some((r) => isPrivateAddr(r.address))) {
    throw new Error('relay: upstream resolves to a private address')
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
  const dnsLookup = options.dnsLookup ?? ((host) => lookup(host, { all: true }))
  const limiter = createLimiter({ ratePerMin: 60, burst: 10 })
  const allowed = new Set(options.trustedOrigins)

  const corsFor = (req: Request, res: Response): boolean => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      return true
    }
    return false
  }

  app.options('/api/relay/*splat', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(204).end()
      return
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'Content-Type,Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
    res.status(204).end()
  })

  app.post('/api/relay/:kind/*splat', async (req, res) => {
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
      res.status(500).json({ error: (err as Error).message })
      return
    }
    const { kind } = req.params as Record<string, string>
    const base = table[kind]
    if (!base) {
      res.status(404).json({ error: 'unknown provider' })
      return
    }
    const splat = (req.params as Record<string, unknown>)['splat']
    const subPath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '')
    let upstream: string
    try {
      upstream = resolveUpstream(base, subPath)
      await assertPublicHost(upstream, dnsLookup)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
      return
    }
    let upstreamRes: globalThis.Response
    try {
      upstreamRes = await fetchFn(upstream, {
        method: 'POST',
        headers: pickHeaders(req),
        body: JSON.stringify(req.body ?? {}),
      })
    } catch {
      res.status(502).json({ error: 'upstream unreachable' })
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
          if (!res.write(value)) await new Promise<void>((r) => res.once('drain', r))
        }
        res.end()
      }
    } catch {
      res.destroy()
      return
    }
    logger({ relay: kind, status: upstreamRes.status, bytes })
  })
}
