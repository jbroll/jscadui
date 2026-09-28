import { editDistance } from './editDistance.js'

export const MAX_WARNINGS = 20

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Containment catches radius → roundRadius, which is 5 edits apart.
export const suggestOptions = (option, known) => {
  const lower = option.toLowerCase()
  return known
    .map((name) => ({ name, d: editDistance(lower, name.toLowerCase()) }))
    .filter(({ name, d }) => d <= 3 || name.toLowerCase().includes(lower) || (name.length >= 3 && lower.includes(name.toLowerCase())))
    .sort((a, b) => a.d - b.d)
    .map(({ name }) => name)
}

const checked = (fnName, fn, known, warn) => {
  const allowed = new Set(known)
  return function (...args) {
    // A hostile or revoked options argument, or a throwing warn, must never
    // stop the wrapped call: warnings are reported, never thrown.
    try {
      const [first] = args
      if (isPlainObject(first)) {
        for (const option of Object.keys(first)) {
          if (!allowed.has(option)) warn({ fn: fnName, option, suggestions: suggestOptions(option, known) })
        }
      }
    } catch {
      // Ignored — the original call below still runs.
    }
    return fn.apply(this, args)
  }
}

// esbuild's CJS namespaces export non-configurable getters, so the copy
// re-declares every property configurable before any is replaced.
const copyOf = (node) => {
  const copy = Object.create(Object.getPrototypeOf(node))
  for (const key of Reflect.ownKeys(node)) {
    Object.defineProperty(copy, key, { ...Object.getOwnPropertyDescriptor(node, key), configurable: true })
  }
  return copy
}

const setValue = (target, key, value) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })

export const withOptionChecks = (api, table, warn) => {
  if (!table || api === null || typeof api !== 'object') return api
  const copies = new Map([[api, copyOf(api)]])
  const root = copies.get(api)
  for (const [path, known] of Object.entries(table.options)) {
    const keys = path.split('.')
    const last = keys.pop()
    let original = api
    let copy = root
    for (const key of keys) {
      const child = original?.[key]
      if (child === null || typeof child !== 'object') {
        original = null
        break
      }
      if (!copies.has(child)) copies.set(child, copyOf(child))
      setValue(copy, key, copies.get(child))
      original = child
      copy = copies.get(child)
    }
    if (typeof original?.[last] === 'function') {
      const wrapped = checked(table.prefix + path, original[last], known, warn)
      setValue(copy, last, wrapped)
      // Manifold also re-exports namespaced functions at the top level as the
      // same function object; keep both bindings pointing at one wrapper.
      for (const key of Object.keys(api)) {
        if (api[key] === original[last]) setValue(root, key, wrapped)
      }
    }
  }
  if (api.default === api) setValue(root, 'default', root)
  return root
}

const FLUENT_FACTORIES = {
  FluentGeom2: 'circle',
  FluentGeom3: 'cube',
  FluentPath2: 'arc',
  FluentGeom2Array: 'geom2Array',
  FluentGeom3Array: 'geom3Array',
  FluentPath2Array: 'path2Array',
}

// Fluent exports no classes and its bundles minify their names, so each
// prototype comes from an object a factory makes.
export const fluentPrototypes = (jf) => {
  /** @type {Record<string, object>} */
  const protos = {}
  for (const [cls, factory] of Object.entries(FLUENT_FACTORIES)) {
    if (typeof jf?.[factory] !== 'function') continue
    try {
      const made = jf[factory]()
      if (made !== null && typeof made === 'object') protos[cls] = Object.getPrototypeOf(made)
    } catch {
      // An engine without this primitive leaves the class unchecked.
    }
  }
  const array = protos.FluentGeom2Array ?? protos.FluentGeom3Array ?? protos.FluentPath2Array
  if (array) protos.FluentGeometryArray = Object.getPrototypeOf(array)
  return protos
}

// The prototypes outlive any one copy of this module (another bundle, a test
// file's fresh import), so the mark and the warn target are global.
const WRAPPED = Symbol.for('jscadui.optionChecks.wrapped')
const METHOD_WARN = Symbol.for('jscadui.optionChecks.methodWarn')

export const setMethodWarn = (warn) => {
  globalThis[METHOD_WARN] = warn
}

const reportMethod = (warning) => globalThis[METHOD_WARN]?.(warning)

export const wrapFluentMethods = (jf, table, warn) => {
  setMethodWarn(warn)
  if (!table?.methods || jf === null || typeof jf !== 'object') return
  const protos = fluentPrototypes(jf)
  for (const [cls, methods] of Object.entries(table.methods)) {
    const proto = protos[cls]
    if (!proto) continue
    for (const [name, known] of Object.entries(methods)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)
      if (typeof descriptor?.value !== 'function' || descriptor.value[WRAPPED]) continue
      const wrapped = checked(`${cls}.${name}`, descriptor.value, known, reportMethod)
      wrapped[WRAPPED] = true
      Object.defineProperty(proto, name, { ...descriptor, value: wrapped })
    }
  }
}

export const createWarningCollector = (cap = MAX_WARNINGS) => {
  let seen = new Set()
  let list = []
  return {
    warn: (warning) => {
      const key = `${warning.fn}\u0000${warning.option}`
      if (seen.has(key) || list.length >= cap) return
      seen.add(key)
      list.push(warning)
    },
    reset: () => {
      seen = new Set()
      list = []
    },
    list: () => [...list],
  }
}
