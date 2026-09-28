import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '@jscadui/agent-loop/src/optionChecks.js'
import { OPTION_TABLES } from '@jscadui/agent-loop/api/optionTable.js'

const FLUENT = '@jbroll/jscad-fluent'
const tableFor = (name) => OPTION_TABLES[name === '@jscad/modeling-for-anchors' ? '@jscad/modeling' : name]

export const installOptionWarnings = ({ setUserModuleWrapper, setRunWarnings }) => {
  const warnings = createWarningCollector()
  setRunWarnings(warnings)
  setUserModuleWrapper((name, api) => {
    const table = tableFor(name)
    // Fluent's classes are not exported, so their methods are checked on the
    // shared prototypes, for every caller in the worker.
    if (name === FLUENT) wrapFluentMethods(api, table, warnings.warn)
    return withOptionChecks(api, table, warnings.warn)
  })
  return warnings
}
