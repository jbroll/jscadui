import { collectBuffers } from './collectBuffers.js'

const RESPONSE = '__RESPONSE__'

export const NEEDS_MODEL = new Set(['jscadMain', 'jscadExportData', 'jscadMeasure', 'jscadCheck'])
export const NEEDS_SOLIDS = new Set(['jscadExportData', 'jscadMeasure', 'jscadCheck'])

const ignore = () => {}

/**
 * The frame's workers: the active one the app's requests go to, the members
 * of grid runs, and one idle worker kept warm. Every worker gets the app's
 * setup; one without the current script loads it before it runs.
 *
 * @typedef {import('./workerSlot.js').Slot} Slot
 * @typedef {import('./workerSlot.js').Entry} Entry
 * @typedef {{slots: Slot[], active: Slot | null, mirrored: object[], lastScript: object | undefined,
 *   lastMain: object | undefined, poolSize: number, timeoutMs: number}} State
 * @param {object} options
 * @param {State} options.state
 * @param {ReturnType<typeof import('./workerSlot.js').createSlots>} options.slotOps
 * @param {(message: unknown, transfer?: Transferable[]) => void} options.post
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 * @param {(slot: Slot) => boolean} options.busy - a member of a grid run
 * @param {(slot: Slot) => boolean} options.inGrid - a member of a run that fanned out
 * @param {(slot: Slot, message: any, entry: Entry) => import('./gridRun.js').Run | null} options.openRun
 */
export const createPool = ({ state, slotOps, post, answerError, busy, inGrid, openRun }) => {
  const idle = (slot) => slot !== state.active && !busy(slot)

  // Sent without a transfer list: a mirrored message is kept for the next worker.
  const request = (slot, message, onAnswer, setup) => {
    slot.worker.postMessage({ ...message, id: slotOps.track(slot, { method: message.method, onAnswer, setup }) })
  }

  const start = ({ replay }) => {
    const slot = slotOps.start()
    state.slots.push(slot)
    if (replay) for (const message of state.mirrored) request(slot, message, ignore, message)
    return slot
  }

  const tryStart = () => {
    try {
      return start({ replay: true })
    } catch {
      return null
    }
  }

  const remove = (slot) => {
    state.slots = state.slots.filter((s) => s !== slot)
  }

  // An idle worker that already holds the current script needs no reload.
  const pickIdle = () => {
    const free = state.slots.filter(idle)
    return free.find((slot) => slot.script === state.lastScript) ?? free[0] ?? null
  }

  // With a run's members that makes poolSize + 1 workers at most.
  const ensureSpare = () => {
    if (state.slots.some(idle) || state.slots.length > state.poolSize) return
    tryStart()
  }

  const mirror = (message) => {
    for (const slot of state.slots) if (slot !== state.active) request(slot, message, ignore, message)
  }

  // Setup the app sent the retired worker went to the promoted one too, so the
  // promoted worker's answer stands in for it.
  const handOver = (from, to) => {
    for (const [workerId, pending] of from.pending) {
      if (pending.onAnswer || !pending.setup) continue
      const copy = [...to.pending.values()].find((r) => r.setup === pending.setup)
      const answer = to.setupAnswers.get(pending.setup)
      if (!copy && !answer) continue
      clearTimeout(pending.timer)
      from.pending.delete(workerId)
      if (copy) Object.assign(copy, { appId: pending.appId, onAnswer: undefined })
      else post({ ...answer, id: pending.appId })
    }
  }

  // For a trapped WebAssembly instance or a superseded run. The app is not
  // told: the promoted worker already holds its setup and reloads the script on demand.
  const retire = (slot, reason) => {
    remove(slot)
    if (slot === state.active) {
      state.active = pickIdle() ?? tryStart()
      if (state.active) handOver(slot, state.active)
    }
    slotOps.end(slot, null, reason, null)
    if (state.active) ensureSpare()
  }

  const kill = (slot, expiredId, reason, errorName) => {
    const inGridRun = inGrid(slot)
    remove(slot)
    slotOps.end(slot, expiredId, reason, errorName)
    if (slot !== state.active) return
    state.active = pickIdle()
    // A grid run goes on without this worker, so the app has nothing to replay
    if (inGridRun) state.active ??= state.slots[0] ?? tryStart()
    else post({ method: 'frameWorkerTerminated', params: [{ reason }] })
    if (state.active) ensureSpare()
  }

  const dispatch = (slot, message, entry) => {
    if (!entry) {
      slot.worker.postMessage(message, collectBuffers(message))
      return
    }
    const run = openRun(slot, message, entry)
    const out = { ...message, id: slotOps.track(slot, run ? { ...entry, run } : entry) }
    slot.worker.postMessage(out, collectBuffers(out))
  }

  // The app does not know about a retire, so a script it sent meanwhile is the
  // model it expects; reloading lastScript would replace it.
  const needsReload = (slot) => !!state.lastScript && slot.script !== state.lastScript &&
    ![...slot.pending.values()].some((r) => r.method === 'jscadScript' && (!r.onAnswer || r.run))

  // Requests that arrive during the reload wait behind it, so they reach the
  // worker in the order they were sent.
  const relay = (slot, message, entry) => {
    if (slot.queued) slot.queued.push({ message, entry })
    else if (NEEDS_MODEL.has(message.method) && needsReload(slot)) ensureLoaded(slot, message, entry)
    else dispatch(slot, message, entry)
  }

  const release = (slot, error) => {
    const [first, ...rest] = slot.queued
    slot.queued = null
    if (!first) return
    if (!error) dispatch(slot, first.message, first.entry)
    else if (first.entry?.onAnswer) first.entry.onAnswer({ method: RESPONSE, error })
    else if (first.entry) answerError(first.entry.appId, error.name, error.message)
    for (const { message, entry } of rest) relay(slot, message, entry)
  }

  // A worker without the model has the setup but not the script. Export,
  // measure and check read the solids of the last run, so those replay it as
  // well; with no run since the load, the load's own main is that run.
  const ensureLoaded = (slot, message, entry) => {
    slot.queued = [{ message, entry }]
    const script = state.lastScript
    const needsSolids = NEEDS_SOLIDS.has(message.method)
    const steps = [{ method: 'jscadScript', params: [{ ...script, runMain: needsSolids && !state.lastMain }] }]
    if (needsSolids && state.lastMain) {
      steps.push({ method: 'jscadMain', params: [{ ...state.lastMain, stream: false }] })
    }
    const next = () => {
      const step = steps.shift()
      if (!step) return release(slot)
      request(slot, step, (data) => {
        if (data.error) return release(slot, data.error)
        if (step.method === 'jscadScript') slot.script = script
        next()
      })
    }
    next()
  }

  return { start, tryStart, pickIdle, ensureSpare, mirror, retire, kill, relay }
}
