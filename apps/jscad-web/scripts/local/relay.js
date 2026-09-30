// Same-origin relay for local startup: forwards user-keyed provider requests,
// streams responses back, stores nothing except the optional chat log. Plain
// node:http so the startup script needs no express/TS build. Access policy is
// the production relay's, from its plain-JS policy module.
import { readFileSync } from 'node:fs'
import { Agent, fetch } from 'undici'
import {
  PROVIDER_BASE_URLS,
  RATE_PER_MIN,
  RelayRefusal,
  createLimiter,
  isTrustedRequest,
  parseAllowlist,
  pickForwardHeaders,
  resolveTarget,
} from '../../server/src/relay/policy.js'
import { toLogRequest } from './chatLog.js'

// A reasoning model can stream nothing for minutes; undici's default gives up after 5.
export const PROVIDER_BODY_TIMEOUT_MS = 15 * 60_000

// One user, whose agent loop can fire steps back to back: a full minute of burst.
const LOCAL_BURST = RATE_PER_MIN

export const loadAllowlist = (path) => parseAllowlist(readFileSync(path, 'utf-8'), path)

export const defaultAllowlist = () => ({ ...PROVIDER_BASE_URLS })

const refuse = (res, status, error, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...extra })
  res.end(JSON.stringify({ error }))
}

export const createRelayHandler = ({ allowlist, trustedOrigins, allowPrivateUpstream = false, log = null, bodyTimeoutMs = PROVIDER_BODY_TIMEOUT_MS, dnsLookup }) => {
  const allowed = new Set(trustedOrigins)
  const dispatcher = new Agent({ bodyTimeout: bodyTimeoutMs, headersTimeout: bodyTimeoutMs })
  const limiter = createLimiter({ ratePerMin: RATE_PER_MIN, burst: LOCAL_BURST })
  return async (req, res) => {
    const m = (req.url ?? '').match(/^\/api\/relay\/([^/]+)(\/.*)?$/)
    if (!m || (req.method !== 'POST' && req.method !== 'GET')) return false
    const ts = new Date().toISOString()
    const started = Date.now()
    const origin = req.headers.origin
    if (!isTrustedRequest(req.headers, allowed)) {
      refuse(res, 403, 'untrusted origin')
      return true
    }
    const limited = limiter.check(req.socket.remoteAddress ?? '')
    if (!limited.ok) {
      refuse(res, 429, 'rate limited', { 'retry-after': String(limited.retryAfterSec) })
      return true
    }
    const sub = (m[2] ?? '').replace(/^\/+/, '')
    let upstream
    try {
      upstream = await resolveTarget({ allowlist, kind: m[1], subPath: sub, dnsLookup, allowPrivate: allowPrivateUpstream })
    } catch (err) {
      if (!(err instanceof RelayRefusal)) throw err
      refuse(res, err.status, err.message)
      return true
    }
    const headers = pickForwardHeaders(req.headers)
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
      up = await fetch(upstream, { method: req.method, headers, signal: abort.signal, dispatcher, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
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
