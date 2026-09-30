import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '@jscadui/agent-loop/src/optionChecks.js'
import { OPTION_TABLES } from '@jscadui/agent-loop/api/optionTable.js'
import { readFileWeb, require as jscadRequire, requireCache } from '@jscadui/require'
import { PROJECT_BASE } from './fileMap.js'

const FLUENT = '@jbroll/jscad-fluent'
const tableFor = (name) => OPTION_TABLES[name === '@jscad/modeling-for-anchors' ? '@jscad/modeling' : name]

// fluentPrototypes probes fluent's factories to find its classes' prototypes.
// Manifold-backed factories throw until the modeling bundle's WASM finishes
// loading, so a probe that runs before then finds nothing and wraps nothing.
// Fluent requires the modeling bundle itself before this wrapper runs, so its
// ready promise, if any, is already in the cache to wait on.
const modelingReady = () => {
  const url = requireCache.bundleAlias['@jscad/modeling']
  if (!url) return null
  try {
    return jscadRequire(url, null, readFileWeb)?.ready ?? null
  } catch {
    return null
  }
}

export const installOptionWarnings = ({ setUserModuleWrapper, setRunWarnings }) => {
  const warnings = createWarningCollector({ base: PROJECT_BASE })
  setRunWarnings(warnings)
  setUserModuleWrapper((name, api) => {
    const table = tableFor(name)
    // Fluent's classes are not exported, so their methods are checked on the
    // shared prototypes, for every caller in the worker.
    if (name === FLUENT) {
      const ready = modelingReady()
      if (ready instanceof Promise) ready.then(() => wrapFluentMethods(api, table, warnings.warn)).catch(() => {})
      else wrapFluentMethods(api, table, warnings.warn)
    }
    return withOptionChecks(api, table, warnings.warn)
  })
  return warnings
}
