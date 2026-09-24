import { buildParamTree, extractDefaults, toParamDefinitions } from '@jscadui/params-core'

/**
 * Each worker of a grid run discovers the params of only the leaves it ran,
 * so the run's answer carries their union. A load's answer also carries the
 * definitions and defaults the worker derives from what it discovered.
 * @param {Array<{proxyState?: {discovered?: {path: string}[], types?: object, classes?: object}} | undefined>} results
 * @param {boolean} isLoad
 */
export const mergeProxyStates = (results, isLoad) => {
  const states = results.map((result) => result?.proxyState).filter(Boolean)
  if (!states.length) return {}
  const byPath = new Map()
  for (const { discovered = [] } of states) {
    for (const param of discovered) if (!byPath.has(param.path)) byPath.set(param.path, param)
  }
  const discovered = [...byPath.values()]
  const types = Object.assign({}, ...states.map((state) => state.types))
  const classes = Object.assign({}, ...states.map((state) => state.classes))
  const tree = buildParamTree(discovered, new Map(Object.entries(types)), new Map(Object.entries(classes)))
  const proxyState = { discovered, types, classes, tree }
  return isLoad ? { proxyState, def: toParamDefinitions(discovered), params: extractDefaults(discovered) } : { proxyState }
}
