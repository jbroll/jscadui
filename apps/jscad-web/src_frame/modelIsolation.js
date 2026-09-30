// Library modules that keep state for the model that set it up, each with
// saveState, restoreState and reset.
const STATEFUL = new Set(['@jscadui/jscad-text'])

/**
 * The worker's setModelIsolation hook. The loader hands every module a
 * project file requires to `seen` (through the user module wrapper), which
 * keeps the stateful ones.
 */
export const createModelIsolation = () => {
  const modules = new Set()
  return {
    /** @param {string} name @param {unknown} api */
    seen: (name, api) => {
      if (STATEFUL.has(name) && typeof api?.reset === 'function') modules.add(api)
    },
    isolate: () => {
      const saved = new Map([...modules].map((module) => [module, module.saveState()]))
      for (const module of modules) module.reset()
      return () => {
        for (const module of modules) {
          if (saved.has(module)) module.restoreState(saved.get(module))
          else module.reset()
        }
      }
    },
  }
}
