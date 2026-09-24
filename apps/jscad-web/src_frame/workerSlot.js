/**
 * One worker and the requests it holds, each with its own kill timer.
 *
 * `pending` is keyed by the id the worker sees. Model code shares the worker
 * with the code that answers, so a sequential id would let it answer the next
 * request itself and cancel that request's timer. An entry with `onAnswer` is
 * the frame's own request; its answer never reaches the app.
 * @typedef {{appId?: unknown, method: string, options?: object, onAnswer?: (data: any) => void,
 *   setup?: object, script?: object, run?: import('./gridRun.js').Run}} Entry
 * @typedef {Entry & {startedAt: number, arm: () => ReturnType<typeof setTimeout>,
 *   timer: ReturnType<typeof setTimeout>}} Pending
 * @typedef {{worker: Worker, pending: Map<string, Pending>, script: object | undefined,
 *   queued: {message: any, entry: Entry | null}[] | null, setupAnswers: WeakMap<object, object>,
 *   heap: number}} Slot - heap is the WASM heap size its last claim reported
 */

/**
 * @param {object} options
 * @param {() => Worker} options.createWorker
 * @param {() => string} options.randomId
 * @param {() => number} options.timeoutMs
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 * @param {(slot: Slot, data: any) => void} options.onMessage
 * @param {(slot: Slot, expiredId: string | null, reason: string, errorName: string) => void} options.onKill
 * @param {(slot: Slot, errorName: string | null) => void} options.onEnd - the worker is gone
 */
export const createSlots = ({ createWorker, randomId, timeoutMs, answerError, onMessage, onKill, onEnd }) => {
  const start = () => {
    /** @type {Slot} */
    const slot = { worker: createWorker(), pending: new Map(), script: undefined, queued: null, setupAnswers: new WeakMap(), heap: 0 }
    const { worker } = slot
    worker.onmessage = (event) => onMessage(slot, event.data)
    // Without these a bundle that fails to load surfaces as "model exceeded
    // N ms" one timeout later, naming the model instead of the load.
    worker.onerror = (event) => {
      event.preventDefault?.()
      onKill(slot, null, event.message ?? 'worker failed to load', 'WorkerError')
    }
    worker.onmessageerror = () => {
      onKill(slot, null, 'worker sent a message that could not be deserialized', 'DataCloneError')
    }
    return slot
  }

  /**
   * @param {Slot} slot
   * @param {Entry} entry
   * @returns {string} the id the worker sees
   */
  const track = (slot, entry) => {
    const workerId = randomId()
    const arm = () => setTimeout(() => {
      onKill(slot, workerId, `model exceeded ${timeoutMs()} ms`, 'TimeoutError')
    }, timeoutMs())
    slot.pending.set(workerId, { ...entry, startedAt: Date.now(), arm, timer: arm() })
    return workerId
  }

  // A cell, a claim or a progress beat shows the model is still advancing, so
  // the budget becomes the longest one step may take.
  const restartTimers = (slot) => {
    for (const request of slot.pending.values()) {
      clearTimeout(request.timer)
      request.timer = request.arm()
    }
  }

  // The worker is gone, so it will never answer: every app request it was
  // holding must reject now, not at the proxy's own 5-minute timeout. A grid
  // run that fanned out answers for itself once its other workers finish.
  const end = (slot, expiredId, reason, errorName) => {
    slot.worker.terminate()
    for (const [workerId, { appId, onAnswer, run, timer }] of slot.pending) {
      clearTimeout(timer)
      if (onAnswer || run?.fanned) continue
      if (workerId === expiredId) answerError(appId, errorName, reason)
      else answerError(appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.pending.clear()
    for (const { entry } of slot.queued ?? []) {
      if (entry && !entry.onAnswer) answerError(entry.appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.queued = null
    onEnd(slot, errorName)
  }

  return { start, track, restartTimers, end }
}
