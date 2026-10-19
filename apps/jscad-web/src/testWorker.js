import { createSlots } from '../src_frame/workerSlot.js'
import { runTestFiles } from '../src_frame/testRun.js'

/**
 * The budget for one test run. A hang resolves `{ok:false,
 * error:{name:'TimeoutError'}}` instead of freezing the viewer.
 */
export const TEST_WORKER_TIMEOUT_MS = 15000

const RESPONSE = '__RESPONSE__'

// The test worker bundle, same origin as the app (emitted by build.js into
// build/). Kept as a literal basename: the production hash pass rewrites it
// to the hashed leaf inside main.js, dev uses it as is.
const TEST_WORKER_BUNDLE = 'build/bundle.test-worker.js'

const timeoutResult = (timeoutMs) => ({
  ok: false,
  passed: 0,
  failed: 0,
  failures: [],
  assertsByPart: {},
  console: [],
  error: { name: 'TimeoutError', message: `tests exceeded ${timeoutMs} ms` },
})

// Without an injected, overridden or bundled worker there is nothing to post
// to: run on this thread. This branch is chosen explicitly for environments
// without a browser Worker (Node, vitest, eval) — never silently in the
// browser, where a synchronous hang would block the viewer.
const runLocal = (files, api) => runTestFiles(files, { api })

// A real browser Worker exists only where both exist: Node's worker_threads
// provide Worker but no page location to resolve the bundle URL from.
const hasBrowserWorker = () =>
  typeof globalThis.Worker !== 'undefined' && typeof globalThis.location?.href === 'string'

/**
 * The worker factory production writes run tests on: the bundled test worker
 * beside the app, or an injected URL. Null where no browser Worker exists
 * (Node, vitest, eval) — there the caller runs in-thread instead. Never null
 * in a real browser, so browser writes never take the in-thread fallback
 * whose synchronous hang would freeze the viewer.
 * @param {{workerUrl?: string|URL}} [deps] bundled worker URL override
 * @returns {(() => Worker) | null} the factory, or null without a browser Worker
 */
export const defaultCreateWorker = (deps) => {
  if (deps.workerUrl) return () => new globalThis.Worker(deps.workerUrl, { type: 'module' })
  if (hasBrowserWorker()) return () => new globalThis.Worker(new URL(TEST_WORKER_BUNDLE, globalThis.location.href))
  return null
}

/**
 * Run a project's `test/` `.js` files on a separate worker and collect the
 * result. The geometry worker is untouched: only test files run, never
 * `notes/` or model sources. In the browser the worker is the test bundle
 * build.js emits beside the app, so a hang burns the kill timer instead of
 * freezing the viewer; environments without a browser Worker (Node, vitest,
 * eval) run in-thread instead. A worker that never answers is terminated on
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
  const createWorker = deps.createWorker ?? defaultCreateWorker(deps)
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
