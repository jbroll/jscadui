import { JscadToCommon } from '@jscadui/format-jscad'

/**
 * The hook an ALL.js grid finds on globalThis.__jscadStream: each emitted
 * cell goes to the app at once instead of waiting for main to return.
 * @param {{post: (message: object, transfer?: Transferable[]) => void, userInstances?: boolean, runId?: unknown}} options
 *   runId is echoed on every batch so the app can drop batches of a run it has moved past
 */
export const createStreamHook = ({ post, userInstances, runId }) => {
  let emitted = false
  const hook = {
    emit(geoms) {
      const solids = [geoms].flat(Infinity)
      for (const solid of solids) {
        if (solid?.isManifoldGeom3) solid.manifold.numTri()
      }
      const transferable = []
      const entities = JscadToCommon.prepare(solids, transferable, userInstances).all
      emitted = true
      post({ method: 'jscadCells', params: [{ entities, runId }] }, [...new Set(transferable.map(a => a.buffer || a))])
    },
    progress() {
      post({ method: 'jscadProgress', params: [] })
    },
  }
  return { hook, emitted: () => emitted }
}

/**
 * @template T
 * @param {object | null} hook
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export const withStreamHook = async (hook, run) => {
  globalThis.__jscadStream = hook
  try {
    return await run()
  } finally {
    globalThis.__jscadStream = null
  }
}
