import { initMessaging } from '@jscadui/postmessage'
import { runTestFiles } from './testRun.js'

/**
 * The worker-side entry for `jscadRunTests`: runs the project's `test/`
 * files and answers `{ok, passed, failed, failures, assertsByPart,
 * console}` under the caller's id, the geometry frame worker's
 * method-dispatch shape. Geometry never loads here: only `runTestFiles`
 * runs, never a model build.
 * @param {{files?: Record<string, string|ArrayBuffer>, api?: string}} [input]
 *   the project files and the api style the run was requested with
 */
export const jscadRunTests = async ({ files = {}, api } = {}) => runTestFiles(files, { api })

// A classic worker script (built iife): wire the dispatcher to messages.
// Guarded so Node (vitest) can import the handler without a worker global.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  const { listener } = initMessaging(self, { jscadRunTests })
  self.onmessage = listener
}
