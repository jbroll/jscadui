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
 * @param {() => string} [options.randomId]
 */
export const createFrameHost = ({
  allowedOrigin,
  bundleBase,
  createWorker,
  post,
  parentWindow,
  randomId = () => crypto.randomUUID(),
}) => {
  // Latched: a jscadInit that omits `engine` keeps the last one. The alias
  // path (onAliasFound) re-inits without naming an engine and must not switch
  // the model bundles out from under a loaded project.
  let engine
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let worker = null
  // Keyed by the id the worker sees. Model code shares the worker with the
  // code that answers, so a sequential id would let it answer the next request
  // itself and cancel that request's timer.
  /** @type {Map<string, {appId: unknown, method: string, arm: () => ReturnType<typeof setTimeout>, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map()

  const answerError = (id, name, message) =>
    post({ method: RESPONSE, id, error: { name, message } })

  // The worker is gone, so it will never answer: every request it was holding
  // must reject now, not at the proxy's own 5-minute timeout.
  const killWorker = (expiredId, reason, errorName) => {
    worker?.terminate()
    worker = null
    for (const [workerId, { appId, timer }] of pending) {
      clearTimeout(timer)
      if (workerId === expiredId) answerError(appId, errorName, reason)
      else answerError(appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    pending.clear()
    post({ method: 'frameWorkerTerminated', params: [{ reason }] })
  }

  const track = (appId, method) => {
    const workerId = randomId()
    const arm = () => setTimeout(() => {
      killWorker(workerId, `model exceeded ${timeoutMs} ms`, 'TimeoutError')
    }, timeoutMs)
    pending.set(workerId, { appId, method, arm, timer: arm() })
    return workerId
  }

  // A cell or a progress beat shows the model is still advancing, so the
  // budget becomes the longest one step may take.
  const restartTimers = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.timer = request.arm()
    }
  }

  // Only the solids re-run of export, measure and check posts progress; relaying
  // it elsewhere would let model code keep any request alive.
  const RELAYED_WHILE = {
    jscadCells: new Set(['jscadMain', 'jscadScript']),
    jscadProgress: new Set(['jscadExportData', 'jscadMeasure', 'jscadCheck']),
  }
  const relayable = (method) => {
    const methods = Object.hasOwn(RELAYED_WHILE, method) && RELAYED_WHILE[method]
    return !!methods && [...pending.values()].some((r) => methods.has(r.method))
  }

  // The worker sends answers plus streamed cells and progress, so anything
  // else it posts, and any answer to a request the frame did not issue, is
  // model code talking.
  const attach = () => {
    worker = createWorker()
    worker.onmessage = (event) => {
      const data = event.data
      if (data?.id == null && relayable(data?.method)) {
        restartTimers()
        const message = { method: data.method, params: data.params }
        post(message, collectBuffers(message))
        return
      }
      if (data?.method !== RESPONSE) return
      const request = pending.get(data.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(data.id)
      const message = { ...data, id: request.appId }
      post(message, collectBuffers(message))
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

    if (!worker) {
      try {
        attach()
      } catch (error) {
        worker = null
        if (id) answerError(id, 'Error', `could not start the model worker: ${error?.message ?? error}`)
        return
      }
    }
    if (id) message = { ...message, id: track(id, data?.method) }
    worker.postMessage(message, collectBuffers(message))
  }

  return { handleMessage, getPendingCount: () => pending.size }
}
