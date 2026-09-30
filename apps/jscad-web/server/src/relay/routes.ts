import type { Express, Request, Response } from 'express'
import { loadAllowlistFile } from './allowlist.js'
import { RATE_PER_MIN, RelayRefusal, createLimiter, isTrustedRequest, pickForwardHeaders, resolveTarget } from './policy.js'

export interface RelayRouteOptions {
  allowlistPath: string
  trustedOrigins: string[]
  logger?: (entry: Record<string, unknown>) => void
  fetchFn?: typeof fetch
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
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
    try {
      upstreamRes = await fetchFn(upstream, {
        method,
        headers: pickForwardHeaders(req.headers),
        ...(method === 'GET' ? {} : { body: JSON.stringify(req.body ?? {}) }),
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
  }

  app.post('/api/relay/:kind/*splat', async (req, res) => forward(req, res, 'POST'))
  app.get('/api/relay/:kind/*splat', async (req, res) => forward(req, res, 'GET'))
}
