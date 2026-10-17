import { createSlots } from '../src_frame/workerSlot.js'
import { runTestFiles } from '../src_frame/testRun.js'

/**
 * The budget for one test run. A hang resolves `{ok:false,
 * error:{name:'TimeoutError'}}` instead of freezing the viewer.
 */
export const TEST_WORKER_TIMEOUT_MS = 15000

const RESPONSE = '__RESPONSE__'

const timeoutResult = (timeoutMs) => ({
  ok: false,
  passed: 0,
  failed: 0,
  failures: [],
  assertsByPart: {},
  console: [],
  error: { name: 'TimeoutError', message: `tests exceeded ${timeoutMs} ms` },
})

// Without an injected or bundled worker there is nothing to post to (Node,
// tests): run on this thread. A synchronous hang blocks here, so browser
// callers must supply a worker; the slot path below is what keeps the viewer
// live.
const runLocal = (files, api) => Promise.resolve(runTestFiles(files, { api }))

/**
 * Run a project's `test/` `.js` files on a separate worker and collect the
 * result. The geometry worker is untouched: only test files run, never
 * `notes/` or model sources. A worker that never answers is terminated on
 * the kill timer and resolves `{ok:false, error:{name:'TimeoutError'}}`.
 * @param {Record<string, string|ArrayBuffer>} [files] the project files
 * @param {string} [api] the api style the run was requested with
 * @param {{createWorker?: () => Worker, workerUrl?: string|URL, randomId?: () => string, timeoutMs?: number}} [deps]
 *   injected worker factory (tests), bundled worker URL (browser), and budgets
 * @returns {Promise<{ok:boolean, passed:number, failed:number, failures:Array<{file:string, error:object}>,
 *   assertsByPart:Record<number,number>, console?:string[], error?:object}>}
 */
export const runProjectTests = (files = {}, api, deps = {}) => {
  const timeoutMs = deps.timeoutMs ?? TEST_WORKER_TIMEOUT_MS
  const createWorker = deps.createWorker
    ?? (deps.workerUrl && typeof globalThis.Worker !== 'undefined'
      ? () => new globalThis.Worker(deps.workerUrl, { type: 'module' })
      : null)
  if (!createWorker) return runLocal(files, api)
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      try {
        slot.worker.terminate?.()
      } catch {
        // Already gone; the result stands.
      }
      resolve(value)
    }
    const slotOps = createSlots({
      createWorker,
      randomId: deps.randomId ?? (() => globalThis.crypto?.randomUUID?.() ?? String(Math.random())),
      timeoutMs: () => timeoutMs,
      answerError: () => {},
      onMessage: (slot, data) => {
        if (data?.method !== RESPONSE) return
        const pending = slot.pending.get(data.id)
        if (!pending) return
        clearTimeout(pending.timer)
        slot.pending.delete(data.id)
        if (data.error) finish({ ...timeoutResult(timeoutMs), error: data.error })
        else finish(data.params)
      },
      onKill: (slot, _expiredId, reason, errorName) => {
        try {
          slot.worker.terminate?.()
        } catch {
          // Already gone; the result stands.
        }
        slot.pending.clear()
        finish({ ...timeoutResult(timeoutMs), error: { name: errorName, message: reason } })
      },
      onEnd: () => {},
    })
    let slot
    try {
      slot = slotOps.start()
    } catch (error) {
      resolve({ ...timeoutResult(timeoutMs), error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } })
      return
    }
    const workerId = slotOps.track(slot, { method: 'jscadRunTests', onAnswer: () => {} })
    try {
      slot.worker.postMessage({ method: 'jscadRunTests', params: [{ files, api }], id: workerId })
    } catch (error) {
      clearTimeout(slot.pending.get(workerId)?.timer)
      slot.pending.delete(workerId)
      finish({ ...timeoutResult(timeoutMs), error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } })
    }
  })
}
