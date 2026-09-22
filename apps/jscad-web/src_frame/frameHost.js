import { collectBuffers } from './collectBuffers.js'

export const DEFAULT_TIMEOUT_MS = 30000

const RESPONSE = '__RESPONSE__'

// The manifold build layers on the plain modeling bundle, so only the name
// model code requires switches; '@jscad/modeling-for-manifold' stays put.
export const workerBundles = (bundleBase, engine) => ({
  '@jscad/modeling': bundleBase + (engine === 'manifold' ? 'bundle.manifold_modeling.js' : 'bundle.jscad_modeling.js'),
  '@jscad/modeling-for-anchors': bundleBase + (engine === 'manifold' ? 'bundle.manifold_modeling.js' : 'bundle.jscad_modeling.js'),
  '@jscad/modeling-for-manifold': bundleBase + 'bundle.jscad_modeling.js',
  '@jbroll/jscad-anchors': 'https://cdn.jsdelivr.net/npm/@jbroll/jscad-anchors@0.1/dist/jscad-anchors.cjs',
  '@jscad/io': bundleBase + 'bundle.jscad_io.js',
  '@jscadui/model-tools': bundleBase + 'bundle.model-tools.js',
  '@jbroll/jscad-fluent': bundleBase + 'bundle.jscad-fluent.js',
  '@jscad/csg': bundleBase + 'bundle.V1_api.js',
  '@jscadui/params-core': bundleBase + 'bundle.params_core.js',
  '@jscadui/jscad-text': bundleBase + 'bundle.jscad_text.js',
})

/**
 * The frame's side of the relayed protocol: one worker, a timeout per
 * in-flight request, and jscadInit rewritten so bundle URLs come from here
 * rather than from the sender.
 *
 * @param {object} options
 * @param {string} options.allowedOrigin the app origin; the only sender answered
 * @param {string} options.bundleBase absolute base the frame's own bundles live under
 * @param {() => Worker} options.createWorker
 * @param {(message: unknown, transfer?: Transferable[]) => void} options.post sends to the app
 * @param {Window} options.parentWindow the only window whose messages are accepted
 */
export const createFrameHost = ({ allowedOrigin, bundleBase, createWorker, post, parentWindow }) => {
  // Latched: a jscadInit that omits `engine` keeps the last one. The alias
  // path (onAliasFound) re-inits without naming an engine and must not switch
  // the model bundles out from under a loaded project.
  let engine
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let worker = null
  const pending = new Map()

  const answerError = (id, name, message) =>
    post({ method: RESPONSE, id, error: { name, message } })

  // The worker is gone, so it will never answer: every request it was holding
  // must reject now, not at the proxy's own 5-minute timeout.
  const killWorker = (expiredId, reason, errorName) => {
    worker?.terminate()
    worker = null
    for (const [id, timer] of pending) {
      clearTimeout(timer)
      if (id === expiredId) answerError(id, errorName, reason)
      else answerError(id, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    pending.clear()
    post({ method: 'frameWorkerTerminated', params: [{ reason }] })
  }

  const armTimeout = (id) => {
    pending.set(id, setTimeout(() => {
      killWorker(id, `model exceeded ${timeoutMs} ms`, 'TimeoutError')
    }, timeoutMs))
  }

  const settle = (id) => {
    const timer = pending.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    pending.delete(id)
  }

  // A timed-out or crashed request left the worker unusable, so it was killed;
  // the next request gets a fresh one.
  const attach = () => {
    worker = createWorker()
    worker.onmessage = (event) => {
      const { method, id } = event.data
      if (method === RESPONSE) settle(id)
      post(event.data, collectBuffers(event.data))
    }
    // Without these a bundle that fails to load surfaces as "model exceeded
    // N ms" one timeout later, naming the model instead of the load.
    worker.onerror = (event) => {
      event.preventDefault?.()
      killWorker(null, event.message ?? 'worker failed to load', 'WorkerError')
    }
    worker.onmessageerror = () => {
      killWorker(null, 'worker sent a message that could not be deserialized', 'DataCloneError')
    }
  }

  // The one method that is not relayed untouched. A script source inside the
  // frame must come from the frame's own origin, so the app names an engine
  // and the frame names the bundles.
  const frameInit = (data, options, rest) => {
    const { engine: wanted, timeoutMs: wantedTimeout, ...init } = options
    if (wanted) engine = wanted
    if (wantedTimeout) timeoutMs = wantedTimeout
    // The worker's own origin is opaque, so it gets the app origin here; it is
    // the only base for include urls that arrive as bare pathnames.
    return { ...data, params: [{ ...init, bundles: workerBundles(bundleBase, engine), appOrigin: allowedOrigin }, ...rest] }
  }

  const handleMessage = (event) => {
    if (event.origin !== allowedOrigin) return
    // Same origin is not the same window: another tab or frame on the app
    // origin could otherwise drive this worker.
    if (parentWindow && event.source !== parentWindow) return

    const data = event.data
    const id = data?.id
    let message = data
    if (data?.method === 'jscadInit') {
      const [options = {}, ...rest] = data.params ?? []
      // Rejecting now matters more than the message: otherwise the rewrite
      // throws here and the request burns the whole timeout unanswered.
      if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        if (id) answerError(id, 'TypeError', 'jscadInit expects an options object')
        return
      }
      message = frameInit(data, options, rest)
    }

    if (!worker) attach()
    if (id) armTimeout(id)
    worker.postMessage(message, collectBuffers(message))
  }

  return { handleMessage, getPendingCount: () => pending.size }
}
