// Per-run build context. `specials` is the identity-keyed store of eager
// reads (measurements, overlay links); `memo` is the iterable geometry map a
// build context exposes to the evaluator via `memoFromSpecials`. WeakMap
// cannot be enumerated, so measured geometry is recorded in `memo` as the
// enumeration index while `specials` remains the entry store.

const defaultEager = () => {
  throw new Error('eagerEvaluate: no evaluator bound')
}

export const createBuildContext = (engine) => ({
  engine,
  specials: new WeakMap(),
  memo: new Map(),
  eager: defaultEager,
})

export const withBuildContext = async (ctx, run) => {
  const previous = globalThis.__jscadBuild
  globalThis.__jscadBuild = ctx
  try {
    return await run()
  } finally {
    globalThis.__jscadBuild = previous
  }
}

export const eagerEvaluate = (node) => {
  const ctx = globalThis.__jscadBuild
  if (!ctx) throw new Error('measure* outside build context')
  return ctx.eager(node)
}

// Overlay snapshots stay in `specials`, so the memo a caller hands the
// evaluator carries the store by reference: the build context is gone by the
// time a streamed part is evaluated, but its snapshots must still resolve.
export const SPECIALS = Symbol('buildSpecials')

// The only specials -> memo path: geometries captured by eager reads during
// the build, by node object identity. Overlay-link specials carry snapshots
// rather than geometry and are skipped.
export const memoFromSpecials = (ctx) => {
  const memo = new Map()
  for (const [node, geometry] of ctx.memo) {
    const entry = ctx.specials.get(node)
    if (entry && entry.geometry !== undefined) memo.set(node, geometry)
  }
  memo[SPECIALS] = ctx.specials
  return memo
}
