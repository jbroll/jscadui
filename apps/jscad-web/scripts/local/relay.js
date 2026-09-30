// Same-origin relay for local startup: forwards user-keyed provider requests,
// streams responses back, stores nothing except the optional chat log. Plain
// node:http so the startup script needs no express/TS build.
import { readFileSync } from 'node:fs'
import { toLogRequest } from './chatLog.js'

const FORWARD = new Set(['content-type', 'accept', 'authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'x-opencode-session'])

export const loadAllowlist = (path) => {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('relay: allowlist must be a {name: url} object')
  return parsed
}

export const defaultAllowlist = () => ({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
  meta: 'https://api.meta.ai',
})

export const createRelayHandler = ({ allowlist, trustedOrigins, allowPrivateUpstream = false, log = null }) => {
  const allowed = new Set(trustedOrigins)
  const hits = new Map()
  return async (req, res) => {
    const m = (req.url ?? '').match(/^\/api\/relay\/([^/]+)(\/.*)?$/)
    if (!m || (req.method !== 'POST' && req.method !== 'GET')) return false
    const ts = new Date().toISOString()
    const started = Date.now()
    const origin = req.headers.origin
    // Browsers omit Origin on a same-origin GET.
    const sameOrigin = origin === undefined && req.headers['sec-fetch-site'] === 'same-origin'
    if (!sameOrigin && (typeof origin !== 'string' || !allowed.has(origin))) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'untrusted origin' }))
      return true
    }
    const now = Date.now()
    const seen = (hits.get(req.socket.remoteAddress ?? '') ?? []).filter((t) => now - t < 60_000)
    if (seen.length >= 60) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
      res.end(JSON.stringify({ error: 'rate limited' }))
      return true
    }
    seen.push(now)
    hits.set(req.socket.remoteAddress ?? '', seen)
    const base = allowlist[m[1]]
    if (!base) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unknown provider' }))
      return true
    }
    const sub = (m[2] ?? '').replace(/^\/+/, '')
    if (sub.split('/').includes('..')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'path traversal refused' }))
      return true
    }
    const upstream = `${base.replace(/\/+$/, '')}/${sub}`
    if (!allowPrivateUpstream && /127\.|localhost|10\.|192\.168\./.test(new URL(upstream).hostname)) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'private upstream refused' }))
      return true
    }
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (FORWARD.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const logging = log !== null && req.method === 'POST'
    const chatId = req.headers['x-jscad-chat-id']
    const record = (status, response, error) => log.write({
      ts,
      chatId: typeof chatId === 'string' ? chatId : null,
      kind: m[1],
      path: sub,
      status,
      request: toLogRequest(Buffer.concat(chunks)),
      response,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    })
    // A page that goes away mid-answer must not leave the provider streaming to nobody.
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableFinished) abort.abort() })
    let up
    try {
      up = await fetch(upstream, { method: req.method, headers, signal: abort.signal, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream unreachable' }))
      if (logging) record(502, 'upstream unreachable')
      return true
    }
    res.writeHead(up.status, {
      ...(up.headers.get('content-type') ? { 'content-type': up.headers.get('content-type') } : {}),
      'cache-control': 'no-cache',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    })
    const decoder = new TextDecoder()
    let text = ''
    let failure = null
    try {
      if (up.body) {
        for await (const c of up.body) {
          res.write(c)
          if (logging) text += decoder.decode(c, { stream: true })
        }
      }
    } catch (err) {
      failure = abort.signal.aborted ? 'client closed' : `upstream stream failed: ${err?.cause?.code ?? err?.message ?? err}`
    }
    // Headers are already sent, so a failed stream can only be cut off.
    if (failure) res.destroy()
    else res.end()
    if (logging) record(up.status, text + decoder.decode(), failure)
    return true
  }
}
