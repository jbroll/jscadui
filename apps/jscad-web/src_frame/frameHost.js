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
 * The frame's side of the relayed protocol: an active worker and a warm spare,
 * a timeout per in-flight request, and jscadInit rewritten so bundle URLs come
 * from here rather than from the sender.
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
  /**
   * `pending` is keyed by the id the worker sees. Model code shares the worker
   * with the code that answers, so a sequential id would let it answer the next
   * request itself and cancel that request's timer. An entry with `onAnswer` is
   * the frame's own request; its answer never reaches the app.
   * @typedef {{appId?: unknown, method: string, options?: object, onAnswer?: (data: any) => void,
   *   arm: () => ReturnType<typeof setTimeout>, timer: ReturnType<typeof setTimeout>}} Pending
   * @typedef {{worker: Worker, pending: Map<string, Pending>, loaded: boolean, held: object[] | null}} Slot
   * @type {{active: Slot | null, spare: Slot | null}}
   */
  const workers = { active: null, spare: null }
  // What a new spare is set up with, in the order the app sent it.
  let mirrored = []
  let lastScript
  let lastMain

  const answerError = (id, name, message) =>
    post({ method: RESPONSE, id, error: { name, message } })

  const ignore = () => {}

  // The worker is gone, so it will never answer: every app request it was
  // holding must reject now, not at the proxy's own 5-minute timeout.
  const end = (slot, expiredId, reason, errorName) => {
    slot.worker.terminate()
    for (const [workerId, { appId, onAnswer, timer }] of slot.pending) {
      clearTimeout(timer)
      if (onAnswer) continue
      if (workerId === expiredId) answerError(appId, errorName, reason)
      else answerError(appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.pending.clear()
    for (const { id } of slot.held ?? []) {
      if (id) answerError(id, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.held = null
  }

  const killWorker = (slot, expiredId, reason, errorName) => {
    end(slot, expiredId, reason, errorName)
    if (slot === workers.spare) workers.spare = null
    if (slot !== workers.active) return
    post({ method: 'frameWorkerTerminated', params: [{ reason }] })
    workers.active = workers.spare
    workers.spare = null
    if (workers.active) workers.spare = tryStart()
  }

  const track = (slot, entry) => {
    const workerId = randomId()
    const arm = () => setTimeout(() => {
      killWorker(slot, workerId, `model exceeded ${timeoutMs} ms`, 'TimeoutError')
    }, timeoutMs)
    slot.pending.set(workerId, { ...entry, arm, timer: arm() })
    return workerId
  }

  // Sent without a transfer list: a mirrored message is kept for the next spare.
  const request = (slot, message, onAnswer) => {
    slot.worker.postMessage({ ...message, id: track(slot, { method: message.method, onAnswer }) })
  }

  // A cell or a progress beat shows the model is still advancing, so the
  // budget becomes the longest one step may take.
  const restartTimers = (slot) => {
    for (const request of slot.pending.values()) {
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
  const relayable = (slot, method) => {
    const methods = Object.hasOwn(RELAYED_WHILE, method) && RELAYED_WHILE[method]
    return !!methods && [...slot.pending.values()].some((r) => !r.onAnswer && methods.has(r.method))
  }

  const trapped = (data) => data.error?.name === 'RuntimeError' || data.params?.trapped === true

  // The worker sends answers plus streamed cells and progress, so anything
  // else it posts, and any answer to a request the frame did not issue, is
  // model code talking.
  const receive = (slot, data) => {
    if (data?.id == null && slot === workers.active && relayable(slot, data?.method)) {
      restartTimers(slot)
      const message = { method: data.method, params: data.params }
      post(message, collectBuffers(message))
      return
    }
    if (data?.method !== RESPONSE) return
    const request = slot.pending.get(data.id)
    if (!request) return
    clearTimeout(request.timer)
    slot.pending.delete(data.id)
    if (request.onAnswer) {
      request.onAnswer(data)
    } else {
      const message = { ...data, id: request.appId }
      post(message, collectBuffers(message))
      answered(slot, request, data)
    }
    if (slot === workers.active && trapped(data)) retire()
  }

  const answered = (slot, { method, options }, data) => {
    if (method === 'jscadMain' && !data.error) lastMain = options
    if (method !== 'jscadScript') return
    if (!data.error) {
      lastScript = options
      slot.loaded = true
    }
    if (!workers.spare) workers.spare = tryStart()
  }

  const start = ({ replay }) => {
    const slot = { worker: createWorker(), pending: new Map(), loaded: false, held: null }
    const { worker } = slot
    worker.onmessage = (event) => receive(slot, event.data)
    // Without these a bundle that fails to load surfaces as "model exceeded
    // N ms" one timeout later, naming the model instead of the load.
    worker.onerror = (event) => {
      event.preventDefault?.()
      killWorker(slot, null, event.message ?? 'worker failed to load', 'WorkerError')
    }
    worker.onmessageerror = () => {
      killWorker(slot, null, 'worker sent a message that could not be deserialized', 'DataCloneError')
    }
    if (replay) for (const message of mirrored) request(slot, message, ignore)
    return slot
  }

  const tryStart = () => {
    try {
      return start({ replay: true })
    } catch {
      return null
    }
  }

  // A trapped WebAssembly instance cannot be trusted with the next run. The app
  // is not told: the promoted spare already holds its setup and reloads the
  // script on demand.
  const retire = () => {
    end(workers.active, null, 'the model trapped in WebAssembly', null)
    workers.active = workers.spare ?? tryStart()
    workers.spare = workers.active ? tryStart() : null
  }

  const MIRRORED = new Set(['jscadInit', 'jscadSetFiles', 'jscadClearTempCache', 'jscadClearFileCache'])

  // A file map replaces the one before it, and the cache clears before it
  // cleared state that map already replaced.
  const mirror = (message) => {
    const { id: _id, ...setup } = message
    const kept = structuredClone(setup)
    if (kept.method === 'jscadSetFiles') mirrored = mirrored.filter((m) => m.method === 'jscadInit')
    mirrored.push(kept)
    if (workers.spare) request(workers.spare, kept, ignore)
  }

  const NEEDS_MODEL = new Set(['jscadMain', 'jscadExportData', 'jscadMeasure', 'jscadCheck'])
  const NEEDS_SOLIDS = new Set(['jscadExportData', 'jscadMeasure', 'jscadCheck'])
  const RECORDED = new Set(['jscadScript', 'jscadMain'])

  const dispatch = (slot, message) => {
    let out = message
    if (message.id) {
      const options = RECORDED.has(message.method) ? structuredClone(message.params?.[0]) : undefined
      out = { ...message, id: track(slot, { appId: message.id, method: message.method, options }) }
    }
    slot.worker.postMessage(out, collectBuffers(out))
  }

  // The app does not know about a retire, so a script it sent meanwhile is the
  // model it expects; reloading lastScript would replace it.
  const needsReload = (slot) => !slot.loaded && lastScript &&
    ![...slot.pending.values()].some((r) => !r.onAnswer && r.method === 'jscadScript')

  // Requests that arrive during the reload wait behind it, so they reach the
  // worker in the order the app sent them.
  const relay = (message) => {
    const slot = workers.active
    if (slot.held) slot.held.push(message)
    else if (NEEDS_MODEL.has(message.method) && needsReload(slot)) ensureLoaded(slot, message)
    else dispatch(slot, message)
  }

  const release = (slot, error) => {
    const [first, ...rest] = slot.held
    slot.held = null
    if (!error) dispatch(slot, first)
    else if (first.id) answerError(first.id, error.name, error.message)
    for (const message of rest) relay(message)
  }

  // A promoted worker has the setup but not the model. Export, measure and
  // check read the solids of the last run, so those replay it as well.
  const ensureLoaded = (slot, message) => {
    slot.held = [message]
    const steps = [{ method: 'jscadScript', params: [{ ...lastScript, runMain: false }] }]
    if (NEEDS_SOLIDS.has(message.method) && lastMain) {
      steps.push({ method: 'jscadMain', params: [{ ...lastMain, stream: false }] })
    }
    const next = () => {
      const step = steps.shift()
      if (!step) return release(slot)
      request(slot, step, (data) => {
        if (data.error) return release(slot, data.error)
        if (step.method === 'jscadScript') slot.loaded = true
        next()
      })
    }
    next()
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

    if (!workers.active) {
      try {
        workers.active = start({ replay: false })
      } catch (error) {
        if (id) answerError(id, 'Error', `could not start the model worker: ${error?.message ?? error}`)
        return
      }
    }
    if (MIRRORED.has(data?.method)) mirror(message)
    relay(message)
  }

  const getPendingCount = () => {
    const slot = workers.active
    if (!slot) return 0
    const relayed = [...slot.pending.values()].filter((r) => !r.onAnswer).length
    return relayed + (slot.held ?? []).filter((m) => m.id).length
  }

  return { handleMessage, getPendingCount }
}
