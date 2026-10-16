// The default relay hook: forward the caller's own provider key to the
// allowlisted upstream and stream the answer back. A GET forwards no body; a
// POST is recorded only when it carries an `x-jscad-chat-id`. This is the
// behaviour every non-jscad-web kind keeps.
import { RelayRefusal, pickForwardHeaders, resolveTarget } from '../policy.js'
import { teeRelayUpstream } from '../chatLog.js'

/**
 * @param {import('./index.js').RelayContext} ctx
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'GET' | 'POST'} method
 * @param {string} kind
 * @param {string} subPath
 */
const forward = async (ctx, req, res, method, kind, subPath) => {
  const ts = new Date().toISOString()
  const started = Date.now()
  if (!ctx.corsFor(req, res)) {
    res.status(403).json({ error: 'untrusted origin' })
    return
  }
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const limited = ctx.limiter.check(ip)
  if (!limited.ok) {
    res.setHeader('Retry-After', String(limited.retryAfterSec))
    res.status(429).json({ error: 'rate limited' })
    return
  }
  /** @type {Record<string, string>} */
  let table
  try {
    table = ctx.readAllowlist()
  } catch (err) {
    ctx.logger({ relay: 'allowlist-error', message: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'relay: allowlist unavailable' })
    return
  }
  /** @type {string} */
  let upstream
  try {
    upstream = await resolveTarget({ allowlist: table, kind, subPath, dnsLookup: ctx.dnsLookup })
  } catch (err) {
    if (!(err instanceof RelayRefusal)) throw err
    res.status(err.status).json({ error: err.message })
    return
  }
  // The chat id travels only as far as this process: logging is the one place
  // that reads it, and the header is not in FORWARD_HEADERS.
  const chatIdHeader = req.headers['x-jscad-chat-id']
  const chatId = typeof chatIdHeader === 'string' && chatIdHeader !== '' ? chatIdHeader : null
  const body = method === 'GET' ? undefined : JSON.stringify(req.body ?? {})
  const tee =
    ctx.log && method === 'POST' && chatId
      ? teeRelayUpstream({
          log: ctx.log,
          ts,
          kind,
          path: subPath,
          request: Buffer.from(body ?? ''),
          chatId,
          started,
        })
      : null
  // A page that goes away mid-answer must not leave the provider streaming to
  // nobody, which a free or own-key turn would pay for.
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) abort.abort()
  })
  /** @type {globalThis.Response} */
  let upstreamRes
  try {
    upstreamRes = await ctx.fetchFn(upstream, {
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
        if (!res.write(value)) await new Promise((r) => res.once('drain', r))
      }
      res.end()
    }
  } catch (err) {
    // Headers are already sent, so a failed stream can only be cut off.
    tee?.finish(upstreamRes.status, {
      error: abort.signal.aborted ? 'client closed' : `upstream stream failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    res.destroy()
    return
  }
  tee?.finish(upstreamRes.status)
  ctx.logger({ relay: kind, status: upstreamRes.status, bytes })
}

/** @type {import('./index.js').RelayHook} */
export const defaultHook = {
  serveGET: (ctx, req, res, kind, subPath) => forward(ctx, req, res, 'GET', kind, subPath),
  servePOST: (ctx, req, res, kind, subPath) => forward(ctx, req, res, 'POST', kind, subPath),
}
