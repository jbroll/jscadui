import { APIS, DEFAULT_API } from './api.js'
import { editDistance } from './editDistance.js'
import { explainThrow, explainWarning } from './hints.js'

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

const TAU = Math.PI * 2
const EPS = 1e-9

const kindOf = (value) => (Array.isArray(value) ? 'array' : typeof value === 'number' ? 'number' : null)

const degreeLike = (angle) => [angle].flat().find((a) => typeof a === 'number' && Math.abs(a) > TAU + EPS)

// A mistyped option or an overlarge roundRadius often makes the function throw
// a message that names neither; the error then carries the hint too.
const annotate = (error, hints) => {
  try {
    if (typeof error?.message !== 'string') return
    const added = [...new Set(hints)].filter((hint) => hint && !error.message.includes(hint))
    if (added.length) error.message = `${error.message}\n${added.join('\n')}`
  } catch {
    // A frozen error goes out as it came.
  }
}

/**
 * @param {string} fnName
 * @param {Function} fn
 * @param {{ known?: string[], types?: Record<string, string>, angle?: boolean }} spec
 * @param {(fact: object) => ({ hint?: string } | void)} warn
 */
const checked = (fnName, fn, spec, warn) => {
  const allowed = spec.known && new Set(spec.known)
  return function (...args) {
    const hints = []
    const report = (fact) => {
      const warning = warn(fact)
      if (warning?.hint) hints.push(warning.hint)
    }
    // A hostile or revoked options argument, or a throwing warn, must never
    // stop the wrapped call: warnings are reported, never thrown.
    try {
      const [first] = args
      if ((allowed || spec.types) && isPlainObject(first)) {
        for (const option of Object.keys(first)) {
          if (allowed && !allowed.has(option)) {
            report({ fn: fnName, option, suggestions: suggestOptions(option, spec.known) })
            continue
          }
          const expected = spec.types?.[option]
          const got = kindOf(first[option])
          if (expected && got && got !== expected) report({ fn: fnName, option, expected, got })
        }
      }
      if (spec.angle) {
        const value = degreeLike(first)
        if (value !== undefined) report({ fn: fnName, option: 'angle', value })
      }
    } catch {
      // Ignored — the original call below still runs.
    }
    try {
      return fn.apply(this, args)
    } catch (error) {
      annotate(error, [...hints, explainThrow(error?.message ?? '', args[0])])
      throw error
    }
  }
}

const specsOf = (table) => {
  /** @type {Map<string, { known?: string[], types?: Record<string, string>, angle?: boolean }>} */
  const specs = new Map()
  const spec = (path) => {
    if (!specs.has(path)) specs.set(path, {})
    return specs.get(path)
  }
  for (const [path, known] of Object.entries(table.options ?? {})) spec(path).known = known
  for (const [path, types] of Object.entries(table.types ?? {})) spec(path).types = types
  for (const path of table.angles ?? []) spec(path).angle = true
  return specs
}

const methodSpecsOf = (table) => {
  /** @type {Map<string, Map<string, { known?: string[], types?: Record<string, string>, angle?: boolean }>>} */
  const classes = new Map()
  const spec = (cls, name) => {
    if (!classes.has(cls)) classes.set(cls, new Map())
    const methods = classes.get(cls)
    if (!methods.has(name)) methods.set(name, {})
    return methods.get(name)
  }
  for (const [cls, methods] of Object.entries(table.methods ?? {})) {
    for (const [name, known] of Object.entries(methods)) spec(cls, name).known = known
  }
  for (const [cls, methods] of Object.entries(table.methodTypes ?? {})) {
    for (const [name, types] of Object.entries(methods)) spec(cls, name).types = types
  }
  for (const [cls, names] of Object.entries(table.methodAngles ?? {})) {
    for (const name of names) spec(cls, name).angle = true
  }
  return classes
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
  for (const [path, spec] of specsOf(table)) {
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
      const wrapped = checked(table.prefix + path, original[last], spec, warn)
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
  if (!table || jf === null || typeof jf !== 'object') return
  const protos = fluentPrototypes(jf)
  for (const [cls, methods] of methodSpecsOf(table)) {
    const proto = protos[cls]
    if (!proto) continue
    for (const [name, spec] of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)
      if (typeof descriptor?.value !== 'function' || descriptor.value[WRAPPED]) continue
      const wrapped = checked(`${cls}.${name}`, descriptor.value, spec, reportMethod)
      wrapped[WRAPPED] = true
      Object.defineProperty(proto, name, { ...descriptor, value: wrapped })
    }
  }
}

// The collector knows the chat's API style, so it turns each fact the checks
// report into the warning the model sees; warn returns it for the thrown-error hint.
export const createWarningCollector = (cap = MAX_WARNINGS) => {
  let seen = new Set()
  let list = []
  let api = DEFAULT_API
  return {
    warn: (fact) => {
      const warning = explainWarning(fact, api)
      const key = `${warning.fn}\u0000${warning.option}`
      if (seen.has(key) || list.length >= cap) return warning
      seen.add(key)
      list.push(warning)
      return warning
    },
    setApi: (next) => {
      api = APIS.includes(next) ? next : DEFAULT_API
    },
    reset: () => {
      seen = new Set()
      list = []
    },
    list: () => [...list],
  }
}
