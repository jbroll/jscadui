import { mergeProxyStates } from './mergeProxyStates.js'

export const ABANDON_AFTER_MS = 500

// A WASM heap never shrinks, so a worker past this is replaced rather than kept.
export const RECYCLE_HEAP_BYTES = 2 ** 30

const RESPONSE = '__RESPONSE__'

export const trapped = (data) => data.error?.name === 'RuntimeError' || data.params?.trapped === true

// A load that runs main, or a run that streams, may turn out to be a grid.
const streams = ({ method, params }) =>
  (method === 'jscadMain' && params?.[0]?.stream !== false) ||
  (method === 'jscadScript' && params?.[0]?.runMain !== false)

/** @returns {Member} */
const newMember = () => ({ key: null, url: null, startedAt: Date.now(), wins: 0, recycle: false })

/**
 * @typedef {import('./workerSlot.js').Slot} Slot
 * @typedef {{key: string | null, url: string | null, startedAt: number, wins: number, recycle: boolean}} Member
 * @typedef {{appId: unknown, method: string, options: object | undefined,
 *   message: {method: string, params: unknown[]}, runId: unknown, primary: Slot,
 *   members: Map<Slot, Member>, claimed: Set<string>, lost: {url: string | null, reason: string}[],
 *   answers: {data: any, primary: boolean}[], fanned: boolean, closed: boolean, answered: boolean,
 *   script: object | undefined}} Run
 */

/**
 * Every streaming jscadMain or jscadScript is a run. A grid's first claim fans
 * the run out to more workers, which take the leaves nobody has claimed, and
 * the app gets one answer once the last of them finishes. A run nobody claims
 * in is relayed as a single request.
 * @param {object} options
 * @param {import('./workerPool.js').State} options.state
 * @param {ReturnType<typeof import('./workerPool.js').createPool>} options.pool
 * @param {ReturnType<typeof import('./workerSlot.js').createSlots>} options.slotOps
 * @param {(message: unknown) => void} options.post
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 */
export const createGridRuns = ({ state, pool, slotOps, post, answerError }) => {
  /** @type {Set<Run>} */
  const runs = new Set()

  const runsOf = (slot) => [...runs].filter((run) => run.members.has(slot))
  // A worker can still be draining a superseded run when the next one starts on it.
  const find = (slot, runId) => runsOf(slot).findLast((run) => run.runId === runId)

  /** @returns {Run | null} */
  const open = (slot, message, entry) => {
    if (entry.onAnswer || !streams(message)) return null
    /** @type {Run} */
    const run = {
      appId: entry.appId,
      method: message.method,
      options: entry.options,
      // The app's own message may be transferred; joining workers get this copy
      message: { method: message.method, params: structuredClone(message.params) },
      runId: message.params?.[0]?.runId,
      primary: slot,
      members: new Map([[slot, newMember()]]),
      claimed: new Set(),
      lost: [],
      answers: [],
      fanned: false,
      closed: false,
      answered: false,
      script: entry.script,
    }
    runs.add(run)
    return run
  }

  const join = (run) => {
    const slot = pool.pickIdle() ?? (state.slots.length <= state.poolSize ? pool.tryStart() : null)
    if (!slot) return false
    run.members.set(slot, newMember())
    pool.relay(slot, run.message, { method: run.method, run, onAnswer: (data) => answered(run, slot, data) })
    return true
  }

  const fanOut = (run) => {
    run.fanned = true
    while (run.members.size < state.poolSize && join(run)) { /* each join adds a member */ }
    pool.ensureSpare()
  }

  const claim = (slot, { id, params }) => {
    const { key, url, runId, heap } = params?.[0] ?? {}
    if (Number.isFinite(heap)) slot.heap = heap
    const run = find(slot, runId)
    const member = run?.members.get(slot)
    // A fresh worker can start over budget; recycling it before it wins a leaf would loop.
    if (member && member.wins > 0 && slot.heap >= RECYCLE_HEAP_BYTES) member.recycle = true
    const won = !!member && !run.closed && !member.recycle && typeof key === 'string' && !run.claimed.has(key)
    if (won) {
      member.wins++
      run.claimed.add(key)
      Object.assign(member, { key, url: typeof url === 'string' ? url : null, startedAt: Date.now() })
    }
    if (member) slotOps.restartTimers(slot)
    slot.worker.postMessage({ method: '__CLAIM__', params: [{ id, won }] })
    if (won && !run.fanned) fanOut(run)
  }

  // Cells carry the runId of the request that made them, which names the run.
  // A claimed leaf streams one batch, so after it the member holds no leaf.
  const relaysCells = (slot, data) => {
    const run = find(slot, data.params?.[0]?.runId)
    if (!run || run.closed) return false
    const member = run.members.get(slot)
    if (member) member.key = null
    return true
  }

  // The primary's answer comes first: for a load it carries what the params UI is built from.
  const merged = (run) => {
    const answers = [...run.answers].sort((a, b) => Number(b.primary) - Number(a.primary)).map((a) => a.data)
    const failure = answers.find((data) => data.error && data.error.name !== 'RuntimeError')
    const done = answers.filter((data) => !data.error)
    if (failure || !done.length) {
      const error = failure?.error ?? answers.find((data) => data.error)?.error ??
        { name: 'AbortError', message: 'every worker running the grid stopped' }
      return { method: RESPONSE, id: run.appId, error }
    }
    const { trapped: _trapped, ...first } = done[0].params ?? {}
    const params = mergeProxyStates(done.map((data) => data.params), run.method === 'jscadScript')
    return {
      method: RESPONSE,
      id: run.appId,
      params: { ...first, ...params, entities: [], streamed: true, runId: run.runId, lost: run.lost },
    }
  }

  const settle = (run) => {
    if (run.members.size) return
    runs.delete(run)
    if (!run.answered) answer(run)
    pool.trim()
  }

  const answer = (run) => {
    run.answered = true
    const message = merged(run)
    post(message)
    if (!message.error) {
      if (run.method === 'jscadMain') state.lastMain = run.options
      else {
        state.lastScript = run.options
        state.lastMain = undefined
      }
    } else if (state.sentScript === run.options) state.sentScript = state.lastScript
    if (run.method === 'jscadScript' && state.active) pool.ensureSpare()
  }

  const answered = (run, slot, data) => {
    const member = run.members.get(slot)
    if (!member) return
    run.members.delete(slot)
    run.answers.push({ data, primary: slot === run.primary })
    if (!data.error && run.method === 'jscadScript') slot.script = run.options
    // A trapped worker stops walking the grid, so its unclaimed leaves need a
    // replacement even after its trapped leaf streamed; each trap uses up a leaf.
    const retiring = trapped(data) ? 'the model trapped in WebAssembly'
      : member.recycle ? 'its WASM heap passed the budget' : null
    if (retiring) {
      pool.retire(slot, retiring)
      if (!run.closed) join(run)
    }
    settle(run)
  }

  // A worker that is gone leaves every run it was in. A run that never fanned
  // out had its app request answered with the worker's own error.
  const leave = (slot, errorName) => {
    for (const run of runsOf(slot)) {
      const member = run.members.get(slot)
      run.members.delete(slot)
      if (!run.fanned) {
        runs.delete(run)
        continue
      }
      if (member.key !== null) {
        run.lost.push({ url: member.url, reason: errorName ?? 'AbortError' })
        if (!run.closed && !join(run) && !run.members.size) {
          post({ method: 'frameWorkerTerminated', params: [{ reason: 'no worker is left to finish the grid' }] })
        }
      }
      settle(run)
    }
  }

  const holdsLoad = (slot) => [...slot.pending.values()].some((r) => r.method === 'jscadScript' && !r.onAnswer)

  // A newer run replaces a grid run at once. A worker on a leaf it started
  // ABANDON_AFTER_MS ago is retired; the rest finish their leaf, find every
  // later claim refused, and go idle. A run that has not fanned out is only
  // closed: its own request is answered as any other relayed one.
  const supersede = (method) => {
    for (const run of [...runs]) {
      if (run.answered) continue
      if (method === 'jscadMain' && run.method === 'jscadScript') continue
      run.closed = true
      if (!run.fanned) continue
      run.answered = true
      answerError(run.appId, 'SupersededError', 'superseded by a newer run')
      const now = Date.now()
      for (const [slot, member] of [...run.members]) {
        if (member.key === null || now - member.startedAt < ABANDON_AFTER_MS) continue
        // A run never abandons a load, as abandonStale holds for a single worker.
        if (method === 'jscadMain' && holdsLoad(slot)) continue
        pool.retire(slot, 'a newer run superseded the model')
      }
      settle(run)
    }
  }

  return {
    open,
    claim,
    relaysCells,
    answered,
    leave,
    supersede,
    close: (run) => runs.delete(run),
    busy: (slot) => runsOf(slot).length > 0,
    inGrid: (slot) => runsOf(slot).some((run) => run.fanned),
    loadsGrid: () => [...runs].some((run) => run.fanned && !run.answered && run.method === 'jscadScript'),
    pendingCount: () => [...runs].filter((run) => run.fanned && !run.answered).length,
  }
}
