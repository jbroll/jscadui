// POST /api/fetch for the local launcher: the production route's guards
// (server/src/fetch/routes.ts) on plain node:http, around the shared fetchPage.
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from '../../server/src/relay/policy.js'
import { fetchPage } from '../../server/src/fetch/fetchPage.js'
import { readBody } from './fsApi.js'

// A request is a URL and a format; anything larger is not one.
const MAX_REQUEST_BYTES = 16 * 1024

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const parse = (buffer) => {
  try {
    return JSON.parse(buffer.toString('utf-8'))
  } catch {
    return null
  }
}

export const createFetchHandler = ({ trustedOrigins, fetchFn = fetch, dnsLookup, timeoutMs }) => {
  const allowed = new Set(trustedOrigins)
  const limiter = createLimiter({ ratePerMin: RATE_PER_MIN, burst: 10 })
  const cors = (req) => {
    if (!isTrustedRequest(req.headers, allowed)) return null
    const origin = req.headers.origin
    return typeof origin === 'string' ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}
  }

  return async (req, res) => {
    if ((req.url ?? '').split('?')[0] !== '/api/fetch') return false
    if (req.method === 'OPTIONS') {
      const headers = cors(req)
      res.writeHead(204, headers === null ? {} : {
        ...headers,
        'access-control-allow-methods': 'POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        'access-control-max-age': '600',
      })
      res.end()
      return true
    }
    if (req.method !== 'POST') return false
    const headers = cors(req)
    if (headers === null) {
      json(res, 403, { error: 'untrusted origin' })
      return true
    }
    const limited = limiter.check(req.socket.remoteAddress ?? 'unknown')
    if (!limited.ok) {
      json(res, 429, { error: 'rate limited' }, { ...headers, 'retry-after': String(limited.retryAfterSec) })
      return true
    }
    const raw = await readBody(req, MAX_REQUEST_BYTES)
    if (raw === null) {
      json(res, 413, { error: 'payload too large' }, headers)
      return true
    }
    const { url, format } = parse(raw) ?? {}
    const { status, body } = await fetchPage({ url, format, fetchFn, dnsLookup, timeoutMs })
    json(res, status, body, headers)
    return true
  }
}
