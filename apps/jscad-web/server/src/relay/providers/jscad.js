// The jscad-web provider hook: the free models jscad-web serves on server-held
// keys. GET serves the catalog; POST drops any client key, injects the server's,
// pins the model and endpoint, meters the turn, and always records it. It never
// trusts the client's `jscad-web-free` sentinel.
import { RelayRefusal, pickForwardHeaders, resolveTarget } from '../policy.js'
import { costUsd, estimateTokens, ipGroup, parseUsage } from '../meter.js'
import { teeRelayUpstream } from '../chatLog.js'
import { writeOrClose } from '../pipe.js'

// The catalog lives at `<root>/api/relay/jscad-web/v1/models`; the free turn
// base is `<root>/api/relay/jscad-web/<id>` and the rest is the option's path.
const CATALOG_PATH = 'v1/models'
// Two turns per IP group may be in flight; a third is refused, and agent-loop
// retries the 429, which suits a concurrency bound. The routes' operator-wide
// ceiling (`ctx.maxInFlight`, default 50) stops a holder of many /64s from
// multiplying that bound.
const MAX_IN_FLIGHT = 2

/**
 * The body a free option forwards: the client's, with the model pinned to the
 * option's, `stream` on, and the output cap the smaller of the client's and the
 * option's. Chat completions also ask for `stream_options.include_usage` so the
 * meter can read the real cost; tools and effort pass through untouched.
 * @param {unknown} client
 * @param {{ model: string, path: string, maxTokens: number }} option
 * @returns {Record<string, unknown>}
 */
const rewriteInferenceBody = (client, option) => {
  const source =
    client !== null && typeof client === 'object' && !Array.isArray(client) ? /** @type {Record<string, unknown>} */ (client) : {}
  const cap = (/** @type {unknown} */ value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, option.maxTokens) : option.maxTokens
  /** @type {Record<string, unknown>} */
  const body = { ...source, model: option.model, stream: true }
  if (option.path.endsWith('chat/completions')) {
    body.max_tokens = cap(source.max_tokens)
    const streamOptions =
      source.stream_options !== null && typeof source.stream_options === 'object'
        ? /** @type {Record<string, unknown>} */ (source.stream_options)
        : {}
    body.stream_options = { ...streamOptions, include_usage: true }
  } else {
    body.max_output_tokens = cap(source.max_output_tokens)
  }
  return body
}

/** @type {import('./index.js').RelayHook} */
export const jscadHook = {
  serveGET: (ctx, req, res, _kind, subPath) => {
    if (!ctx.corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    if (subPath !== CATALOG_PATH) {
      res.status(404).json({ error: 'unknown jscad-web path' })
      return
    }
    /** @type {import('../inference.js').InferenceConfig} */
    let config
    try {
      config = ctx.readInference()
    } catch (err) {
      // A broken file hides the free models rather than breaking the page; the
      // operator learns from the log.
      ctx.logger({ relay: 'inference-config-error', message: err instanceof Error ? err.message : String(err) })
      res.json([])
      return
    }
    const available = ctx.meter !== null && ctx.meter.available({ monthlyUsd: config.monthlyUsd, perIpDailyUsd: config.perIpDailyUsd })
    res.json(config.options.map((o) => ({ id: o.id, kind: o.kind, model: o.model, available, capabilities: { vision: o.vision === true } })))
  },

  servePOST: async (ctx, req, res, _kind, subPath) => {
    const ts = new Date().toISOString()
    const started = Date.now()
    if (!ctx.corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    /** @type {import('../inference.js').InferenceConfig} */
    let config
    try {
      config = ctx.readInference()
    } catch (err) {
      ctx.logger({ relay: 'inference-config-error', message: err instanceof Error ? err.message : String(err) })
      res.status(500).json({ error: 'relay: inference config unavailable' })
      return
    }
    // `id` is the first path segment; the rest must be exactly the option's
    // path, which pins kind, model and endpoint. Anything else is not this
    // option, and the client key is never forwarded to find out.
    const slash = subPath.indexOf('/')
    const id = slash === -1 ? subPath : subPath.slice(0, slash)
    const remainder = slash === -1 ? '' : subPath.slice(slash + 1)
    const option = config.options.find((o) => o.id === id)
    if (!option || remainder !== option.path) {
      res.status(404).json({ error: 'unknown inference option' })
      return
    }
    const meter = ctx.meter
    if (!meter) {
      res.status(503).json({ error: 'free models unavailable: the spend state could not be read' })
      return
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const budgets = { monthlyUsd: config.monthlyUsd, perIpDailyUsd: config.perIpDailyUsd }
    const quota = meter.check(ip, budgets)
    if (!quota.ok) {
      const scope = quota.scope
      res.status(402).json({
        error: {
          code: 'inference_quota_exhausted',
          scope,
          message:
            scope === 'month' ? 'inference monthly budget exhausted' : 'inference daily budget exhausted for this network',
        },
      })
      return
    }
    const group = ipGroup(ip)
    const totalInFlight = ctx.inFlightTotal()
    if (totalInFlight >= ctx.maxInFlight) {
      // The ceiling is the operator's, not the caller's: make it visible.
      ctx.logger({ relay: 'inference_busy', inFlight: totalInFlight })
      res.setHeader('Retry-After', '5')
      res.status(429).json({
        error: { code: 'inference_busy', retryAfter: 5, message: 'relay busy: too many inference requests in flight' },
      })
      return
    }
    if ((ctx.inFlight.get(group) ?? 0) >= MAX_IN_FLIGHT) {
      res.setHeader('Retry-After', '2')
      res.status(429).json({ error: { code: 'inference_busy', retryAfter: 2, message: 'too many in flight' } })
      return
    }
    ctx.inFlight.set(group, (ctx.inFlight.get(group) ?? 0) + 1)
    let released = false
    const release = () => {
      if (released) return
      released = true
      const left = (ctx.inFlight.get(group) ?? 1) - 1
      if (left <= 0) ctx.inFlight.delete(group)
      else ctx.inFlight.set(group, left)
    }
    res.on('close', release)
    // Registered before any await below, so a client that leaves during DNS
    // resolution is observed and no upstream request is sent on its behalf.
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })

    try {
      // The client key is whatever the sentinel was; it is dropped here and never
      // trusted. Only the operator's key goes upstream.
      const bodyText = JSON.stringify(rewriteInferenceBody(req.body, option))
      const headers = pickForwardHeaders(req.headers)
      delete headers.authorization
      delete headers['x-api-key']
      headers.authorization = `Bearer ${option.key}`
      const chatIdHeader = req.headers['x-jscad-chat-id']
      const chatId = typeof chatIdHeader === 'string' && chatIdHeader !== '' ? chatIdHeader : null
      // Free turns are always recorded, chat id or not.
      const tee = teeRelayUpstream({ log: ctx.log, ts, kind: option.kind, path: option.path, request: Buffer.from(bodyText), chatId, started })

      /** @type {Record<string, string>} */
      let table
      try {
        table = ctx.readAllowlist()
      } catch (err) {
        ctx.logger({ relay: 'allowlist-error', message: err instanceof Error ? err.message : String(err) })
        res.status(500).json({ error: 'relay: allowlist unavailable' })
        tee.finish(500, { error: 'relay: allowlist unavailable', inference: option.id, costUsd: 0 })
        release()
        return
      }
      /** @type {string} */
      let upstream
      try {
        upstream = await resolveTarget({ allowlist: table, kind: option.kind, subPath: option.path, dnsLookup: ctx.dnsLookup })
      } catch (err) {
        if (!(err instanceof RelayRefusal)) throw err
        ctx.logger({ relay: 'inference_refused', status: err.status, message: err.message, inference: option.id })
        res.status(err.status).json({ error: err.message })
        // Nothing reached the provider, so the turn is free but still recorded.
        tee.finish(err.status, { error: err.message, inference: option.id, costUsd: 0 })
        release()
        return
      }
      // The client left while we were resolving: no request reached the provider,
      // so nothing is charged, but the abandoned turn is still recorded.
      if (abort.signal.aborted) {
        tee.finish(499, { error: 'client closed', inference: option.id, costUsd: 0 })
        release()
        return
      }

      /** @type {globalThis.Response} */
      let upstreamRes
      try {
        upstreamRes = await ctx.fetchFn(upstream, { method: 'POST', headers, body: bodyText, signal: abort.signal })
      } catch {
        if (abort.signal.aborted) {
          // The client left after the request went upstream, where the provider can
          // still bill for the prompt it received, so charge the input estimate.
          const cost = costUsd({ inputTokens: estimateTokens(Buffer.byteLength(bodyText)), outputTokens: 0 }, option)
          meter.charge(ip, cost)
          tee.finish(499, { error: 'client closed', inference: option.id, costUsd: cost })
        } else {
          // Never connected, so nothing was sent and nothing is charged.
          res.status(502).json({ error: 'upstream unreachable' })
          tee.finish(502, { response: 'upstream unreachable', inference: option.id, costUsd: 0 })
        }
        release()
        return
      }

      res.status(upstreamRes.status)
      const contentType = upstreamRes.headers.get('content-type')
      if (contentType) res.setHeader('content-type', contentType)
      res.setHeader('cache-control', 'no-cache')

      const decoder = new TextDecoder()
      let responseText = ''
      let bytes = 0
      /**
       * @param {number} status
       * @param {string} error
       */
      const settle = (status, error) => {
        const usage = parseUsage(responseText)
        // No usage means the stream was cut (page closed, upstream failed); the
        // provider still billed for what it generated, so charge the estimate.
        const cost = usage
          ? costUsd(usage, option)
          : costUsd(
              { inputTokens: estimateTokens(Buffer.byteLength(bodyText)), outputTokens: estimateTokens(Buffer.byteLength(responseText)) },
              option,
            )
        meter.charge(ip, cost)
        tee.finish(status, { ...(error ? { error } : {}), inference: option.id, costUsd: cost })
        release()
      }
      try {
        if (!upstreamRes.body) {
          res.end()
        } else {
          const reader = upstreamRes.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            responseText += decoder.decode(value, { stream: true })
            tee.chunk(value)
            if (!(await writeOrClose(res, value))) {
              await reader.cancel().catch(() => {})
              settle(upstreamRes.status, 'client closed')
              return
            }
          }
          res.end()
        }
      } catch (err) {
        settle(upstreamRes.status, abort.signal.aborted ? 'client closed' : `upstream stream failed: ${err instanceof Error ? err.message : String(err)}`)
        res.destroy()
        return
      }
      settle(upstreamRes.status, '')
      ctx.logger({ relay: `inference:${option.id}`, status: upstreamRes.status, bytes })
    } finally {
      release()
    }
  },
}
