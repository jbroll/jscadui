// Geometry resolution shared by the `geometries.*` readers (nodes.js) and the
// measurement fast path (measurements.js). Both resolve a deferred node to real
// geometry during a build and record it under the cache contract
// `memoFromSpecials` reads: `specials` holds `{ node, geometry, value }` by
// identity, `memo` holds the geometry for the evaluator's enumeration index.

import { eagerEvaluate } from './context.js'

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)

// A real value or `literal` leaf is already geometry. Anything else is replayed
// on the caller's stack via `syncEvaluate(value, memo)`, which throws
// `AsyncLeafError` when the subtree reaches a thenable.
export const resolveGeometry = (value, ctx, syncEvaluate) => {
  if (!isTreeNode(value)) return value
  if (value.op === 'literal') return value.value
  const cached = ctx.specials.get(value)
  if (cached && cached.geometry !== undefined) return cached.geometry
  const { solids } = syncEvaluate(value, ctx.memo)
  const geometry = solids.length === 1 ? solids[0] : solids
  ctx.specials.set(value, { node: value, geometry, value: undefined })
  ctx.memo.set(value, geometry)
  return geometry
}

// The async twin: the one path that can replay an async leaf. Same cache writes.
export const resolveGeometryAsync = async (value, ctx) => {
  if (!isTreeNode(value)) return value
  if (value.op === 'literal') return value.value
  const cached = ctx.specials.get(value)
  if (cached && cached.geometry !== undefined) return cached.geometry
  const geometry = await eagerEvaluate(value)
  ctx.specials.set(value, { node: value, geometry, value: undefined })
  ctx.memo.set(value, geometry)
  return geometry
}
