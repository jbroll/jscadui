// Library modules that keep state for the model that set it up, each with
// saveState, restoreState and reset.
const STATEFUL = new Set(['@jscadui/jscad-text'])

/**
 * The worker's setModelIsolation hook. The loader hands every module a
 * project file requires to `seen` (through the user module wrapper), which
 * keeps the stateful ones. `setUp` names what a module gets before any model
 * sees it: when first required and after every reset.
 * @param {{ setUp?: Record<string, (api: any) => void> }} [options]
 */
export const createModelIsolation = ({ setUp = {} } = {}) => {
  /** @type {Map<any, string>} */
  const modules = new Map()
  const fresh = (module) => {
    module.reset()
    setUp[modules.get(module)]?.(module)
  }
  return {
    /** @param {string} name @param {unknown} api */
    seen: (name, api) => {
      if (!STATEFUL.has(name) || typeof api?.reset !== 'function' || modules.has(api)) return
      modules.set(api, name)
      setUp[name]?.(api)
    },
    isolate: () => {
      const saved = new Map([...modules.keys()].map((module) => [module, module.saveState()]))
      for (const module of modules.keys()) fresh(module)
      return () => {
        for (const module of modules.keys()) {
          if (saved.has(module)) module.restoreState(saved.get(module))
          else fresh(module)
        }
      }
    },
  }
}
