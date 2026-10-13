import { readFileWeb, require, requireCache } from '@jscadui/require'

// The engine-bound evaluator lives in the active modeling bundle, which
// @jscadui/model-tree builds per engine at bundle time. The bundle URL only
// exists inside a real worker, so Node/vitest gets no evaluator and the worker
// passes geometry through untouched.
export const loadBoundEvaluate = () => {
  const url = requireCache.bundleAlias['@jscad/modeling']
  if (!url) return undefined
  try {
    return require(url, null, readFileWeb)?.evaluate
  } catch (err) {
    console.warn('modeling bundle could not be required for the tree evaluator:', err)
    return undefined
  }
}
