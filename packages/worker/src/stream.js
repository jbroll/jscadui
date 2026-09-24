import { JscadToCommon } from '@jscadui/format-jscad'

import { toRefs } from './meshRefs.js'

// Later batches and kept solids can reuse these arrays, so each batch transfers copies
const withCopies = (entities) => {
  const copies = new Map()
  const copyOf = (view) => {
    if (!copies.has(view)) copies.set(view, view.slice())
    return copies.get(view)
  }
  const out = entities.map(entity => {
    const copy = { ...entity }
    for (const [key, value] of Object.entries(copy)) {
      if (ArrayBuffer.isView(value)) copy[key] = copyOf(value)
    }
    return copy
  })
  return { entities: out, transfer: [...copies.values()].map(view => view.buffer) }
}

/**
 * The hook an ALL.js grid finds on globalThis.__jscadStream: each emitted
 * cell goes to the app at once instead of waiting for main to return.
 * @param {{post: (message: object, transfer?: Transferable[]) => void, userInstances?: boolean, runId?: unknown, held?: Set<string>}} options
 *   runId is echoed on every batch so the app can drop batches of a run it has moved past
 */
export const createStreamHook = ({ post, userInstances, runId, held = new Set() }) => {
  let emitted = false
  const hook = {
    emit(geoms) {
      const solids = [geoms].flat(Infinity)
      for (const solid of solids) {
        if (solid?.isManifoldGeom3) solid.manifold.numTri()
      }
      const { entities, transfer } = withCopies(toRefs(JscadToCommon.prepare(solids, undefined, userInstances).all, held, []))
      JscadToCommon.clearCache()
      emitted = true
      post({ method: 'jscadCells', params: [{ entities, runId }] }, transfer)
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
