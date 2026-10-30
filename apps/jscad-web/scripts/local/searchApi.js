// POST /api/search for the local launcher: the production route's guards
// (server/src/search/routes.ts) on plain node:http, around the shared Tavily
// call. Without an operator key the answer is 503, so the page falls back to
// its browser-direct pool (same as the server route).
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from '../../server/src/relay/policy.js'
import { searchTavily } from '../../server/src/search/tavily.js'
import { readBody } from './fsApi.js'

// A request is a query and a count; anything larger is not one.
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

export const createSearchHandler = ({ trustedOrigins, tavilyKey, fetchFn }) => {
  const allowed = new Set(trustedOrigins)
  const limiter = createLimiter({ ratePerMin: RATE_PER_MIN, burst: 10 })
  const cors = (req) => {
    if (!isTrustedRequest(req.headers, allowed)) return null
    const origin = req.headers.origin
    return typeof origin === 'string' ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}
  }

  return async (req, res) => {
    if ((req.url ?? '').split('?')[0] !== '/api/search') return false
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
    const { query, count } = parse(raw) ?? {}
    if (typeof query !== 'string' || !query.trim()) {
      json(res, 400, { error: 'search: query must be a non-empty string' }, headers)
      return true
    }
    if (count !== undefined && !Number.isInteger(count)) {
      json(res, 400, { error: 'search: count must be an integer' }, headers)
      return true
    }
    if (!tavilyKey) {
      json(res, 503, { error: 'search: no provider key configured' }, headers)
      return true
    }
    const { status, body } = await searchTavily({ tavilyKey, query: query.trim(), count, fetchFn })
    json(res, status, body, headers)
    return true
  }
}
