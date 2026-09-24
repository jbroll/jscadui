import { collectBuffers } from './collectBuffers.js'
import { ABANDON_AFTER_MS, createGridRuns, trapped } from './gridRun.js'
import { createPool, NEEDS_SOLIDS } from './workerPool.js'
import { createSlots } from './workerSlot.js'

export { ABANDON_AFTER_MS } from './gridRun.js'
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

// Each worker holds its own bundles, WASM instances and file map, which bounds the pool.
export const defaultPoolSize = (hardwareConcurrency = 2) => Math.max(1, Math.min(hardwareConcurrency - 1, 4))

/**
 * The frame's side of the relayed protocol: a pool of workers, a timeout per
 * in-flight request, grid runs spread across the pool, and jscadInit
 * rewritten so bundle URLs come from here rather than from the sender.
 *
 * @param {object} options
 * @param {string} options.allowedOrigin the app origin; the only sender answered
 * @param {string} options.bundleBase absolute base the frame's own bundles live under
 * @param {() => Worker} options.createWorker
 * @param {(message: unknown, transfer?: Transferable[]) => void} options.post sends to the app
 * @param {Window} options.parentWindow the only window whose messages are accepted
 * @param {() => string} [options.randomId]
 * @param {number} [options.hardwareConcurrency]
 */
export const createFrameHost = ({
  allowedOrigin,
  bundleBase,
  createWorker,
  post,
  parentWindow,
  randomId = () => crypto.randomUUID(),
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
}) => {
  // Latched: a jscadInit that omits `engine` keeps the last one. The alias
  // path (onAliasFound) re-inits without naming an engine and must not switch
  // the model bundles out from under a loaded project.
  let engine
  /** @type {import('./workerPool.js').State} */
  const state = {
    slots: [],
    active: null,
    // What a new worker is set up with, in the order the app sent it.
    mirrored: [],
    lastScript: undefined,
    // The newest script the app sent, answered or not.
    sentScript: undefined,
    lastMain: undefined,
    poolSize: defaultPoolSize(hardwareConcurrency),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  const answerError = (id, name, message) =>
    post({ method: RESPONSE, id, error: { name, message } })

  const slotOps = createSlots({
    createWorker,
    randomId,
    timeoutMs: () => state.timeoutMs,
    answerError,
    onMessage: (slot, data) => receive(slot, data),
    onKill: (slot, expiredId, reason, errorName) => pool.kill(slot, expiredId, reason, errorName),
    onEnd: (slot, errorName) => runs.leave(slot, errorName),
  })
  const pool = createPool({
    state,
    slotOps,
    post,
    answerError,
    busy: (slot) => runs.busy(slot),
    inGrid: (slot) => runs.inGrid(slot),
    openRun: (slot, message, entry) => runs.open(slot, message, entry),
  })
  const runs = createGridRuns({ state, pool, slotOps, post, answerError })

  // Only the solids re-run of export, measure and check posts progress; relaying
  // it elsewhere would let model code keep any request alive.
  const exporting = (slot) => [...slot.pending.values()].some((r) => !r.onAnswer && NEEDS_SOLIDS.has(r.method))

  const relayOut = (slot, data) => {
    slotOps.restartTimers(slot)
    const message = { method: data.method, params: data.params }
    post(message, collectBuffers(message))
  }

  // The worker sends answers, claims, and streamed cells and progress, so
  // anything else it posts, and any answer to a request the frame did not
  // issue, is model code talking.
  const receive = (slot, data) => {
    if (data?.method === 'jscadClaim' && data.id != null) return runs.claim(slot, data)
    if (data?.id == null && data?.method === 'jscadCells' && runs.relaysCells(slot, data)) return relayOut(slot, data)
    if (data?.id == null && data?.method === 'jscadProgress' && slot === state.active && exporting(slot)) return relayOut(slot, data)
    if (data?.method !== RESPONSE) return
    const request = slot.pending.get(data.id)
    if (!request) return
    clearTimeout(request.timer)
    slot.pending.delete(data.id)
    if (request.setup) slot.setupAnswers.set(request.setup, data)
    if (request.onAnswer) return request.onAnswer(data)
    if (request.run?.fanned) return runs.answered(request.run, slot, data)
    if (request.run) runs.close(request.run)
    const message = { ...data, id: request.appId }
    post(message, collectBuffers(message))
    answered(slot, request, data)
    // A frame request that traps still answers the one it was made for; the
    // next app run that traps retires the worker.
    if (slot === state.active && trapped(data)) pool.retire(slot, 'the model trapped in WebAssembly')
  }

  const answered = (slot, { method, options }, data) => {
    if (method === 'jscadMain' && !data.error) state.lastMain = options
    if (method !== 'jscadScript') return
    if (!data.error) {
      state.lastScript = options
      state.lastMain = undefined
      slot.script = options
    }
    pool.ensureSpare()
  }

  const RECORDED = new Set(['jscadScript', 'jscadMain'])

  // A run never abandons a load: the promoted worker would reload the previous
  // script and run the new parameters against it.
  const abandonStale = (method) => {
    const slot = state.active
    const appRequests = [...slot.pending].filter(([, r]) => !r.onAnswer && !r.run?.fanned)
    if (method === 'jscadMain' && (appRequests.some(([, r]) => r.method === 'jscadScript') || runs.loadsGrid())) return
    const stale = appRequests.filter(([, r]) => RECORDED.has(r.method))
    const now = Date.now()
    if (!stale.some(([, r]) => now - r.startedAt >= ABANDON_AFTER_MS)) return
    // A younger run queued behind the stale one is replaced too.
    for (const [workerId, { appId, timer }] of stale) {
      clearTimeout(timer)
      slot.pending.delete(workerId)
      answerError(appId, 'SupersededError', 'superseded by a newer run')
    }
    pool.retire(slot, 'a newer run superseded the model')
  }

  // Runs waiting behind a reload have not started, so a newer run replaces
  // them without a retire. A queued script stays, as a pending one does, and so
  // does a run an export, measure or check queued after it will read.
  const supersedeQueued = () => {
    const slot = state.active
    if (!slot.queued) return
    const lastRead = slot.queued.findLastIndex(({ message }) => NEEDS_SOLIDS.has(message.method))
    slot.queued = slot.queued.filter(({ message, entry }, i) => {
      if (message.method !== 'jscadMain' || i < lastRead || entry?.onAnswer) return true
      if (entry) answerError(entry.appId, 'SupersededError', 'superseded by a newer run')
      return false
    })
  }

  const takeSupersede = (message) => {
    const [options, ...rest] = message?.params ?? []
    if (options === null || typeof options !== 'object' || !Object.hasOwn(options, 'supersede')) return [message, false]
    const { supersede, ...kept } = options
    return [{ ...message, params: [kept, ...rest] }, supersede === true]
  }

  const MIRRORED = new Set(['jscadInit', 'jscadSetFiles', 'jscadClearTempCache', 'jscadClearFileCache'])

  const setupOf = new WeakMap()

  // A file map replaces the one before it, and the cache clears before it
  // cleared state that map already replaced.
  const mirror = (message) => {
    const { id: _id, ...setup } = message
    const kept = structuredClone(setup)
    if (kept.method === 'jscadSetFiles') state.mirrored = state.mirrored.filter((m) => m.method === 'jscadInit')
    state.mirrored.push(kept)
    setupOf.set(message, kept)
    pool.mirror(kept)
  }

  const entryFor = (message) => message.id
    ? {
      appId: message.id,
      method: message.method,
      options: RECORDED.has(message.method) ? structuredClone(message.params?.[0]) : undefined,
      setup: setupOf.get(message),
    }
    : null

  // The one method that is not relayed untouched. A script source inside the
  // frame must come from the frame's own origin, so the app names an engine
  // and the frame names the bundles.
  const frameInit = (data, options, rest) => {
    const { engine: wanted, timeoutMs: wantedTimeout, poolSize: wantedPool, ...init } = options
    if (wanted) engine = wanted
    if (wantedTimeout) state.timeoutMs = wantedTimeout
    if (Number.isInteger(wantedPool) && wantedPool > 0) state.poolSize = wantedPool
    // The worker's own origin is opaque, so it gets the app origin here; it is
    // the only base for include urls that arrive as bare pathnames.
    const params = { ...init, claims: true, bundles: workerBundles(bundleBase, engine), appOrigin: allowedOrigin }
    return { ...data, params: [params, ...rest] }
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
    const [relayed, supersede] = takeSupersede(message)
    message = relayed
    if (supersede && RECORDED.has(message.method)) {
      runs.supersede(message.method)
      if (state.active) {
        supersedeQueued()
        abandonStale(message.method)
      }
    }

    if (!state.active) {
      try {
        state.active = pool.start({ replay: false })
      } catch (error) {
        if (id) answerError(id, 'Error', `could not start the model worker: ${error?.message ?? error}`)
        return
      }
    }
    if (MIRRORED.has(data?.method)) mirror(message)
    const entry = entryFor(message)
    if (entry?.method === 'jscadScript') state.sentScript = entry.options
    pool.relay(state.active, message, entry)
  }

  const getPendingCount = () => {
    const slot = state.active
    const relayed = slot ? [...slot.pending.values()].filter((r) => !r.onAnswer && !r.run?.fanned).length : 0
    const queued = (slot?.queued ?? []).filter(({ entry }) => entry && !entry.onAnswer).length
    return relayed + queued + runs.pendingCount()
  }

  return { handleMessage, getPendingCount }
}
