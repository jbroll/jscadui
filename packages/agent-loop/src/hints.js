import { OPTION_TABLES } from '../api/optionTable.js'
import { DEFAULT_API } from './api.js'

// Hints name only the chosen API's form (src/api.js), whichever package the
// model code called.
const TABLES = { modeling: OPTION_TABLES['@jscad/modeling'], fluent: OPTION_TABLES['@jbroll/jscad-fluent'] }
const tableFor = (api) => TABLES[api] ?? TABLES[DEFAULT_API]

export const TAPER = {
  modeling: 'a taper (cone) is primitives.cylinderElliptic({ startRadius: [r, r], endRadius: [r, r], height }); start is the -Z end',
  fluent: 'a taper (cone) is jf.cylinder({ radius: [start, end], height }); start is the -Z end',
}
const taperFor = (api) => TAPER[api] ?? TAPER[DEFAULT_API]

const words = (name) => name.split(/(?<=[a-z])(?=[A-Z0-9])|(?<=\d)(?=[A-Za-z])|_+/).map((w) => w.toLowerCase())
const wordKey = (name) => [...words(name)].sort().join(' ')
const baseName = (fn) => fn.slice(fn.lastIndexOf('.') + 1)

const TAPER_WORDS = new Set(['taper', 'cone', 'frustum'])
const RADIUS_WORDS = new Set(['r', 'radius', 'd', 'diameter'])
const END_WORDS = new Set(['start', 'end', 'top', 'bottom', 'base', 'tip', 'upper', 'lower', '1', '2'])

const isTaperOption = (fn, option) => {
  if (baseName(fn) !== 'cylinder') return false
  const ws = words(option)
  return ws.some((w) => TAPER_WORDS.has(w)) || (ws.some((w) => RADIUS_WORDS.has(w)) && ws.some((w) => END_WORDS.has(w)))
}

// Siblings share a name (cylinder, cylinderElliptic) or the stem of their last
// word (cube, cuboid, roundedCuboid).
const related = (a, b) => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.includes(y) || y.includes(x) || words(a).at(-1).slice(0, 3) === words(b).at(-1).slice(0, 3)
}

const siblings = (fn, api) => {
  const table = tableFor(api)
  const base = baseName(fn)
  return Object.keys(table.options)
    .map((path) => ({ path, name: table.prefix + path }))
    .filter(({ path, name }) => name !== fn && related(base, baseName(path)))
}

const explainUnknown = ({ fn, option, suggestions }, api) => {
  if (isTaperOption(fn, option)) return { fn, option, suggestions: [], hint: taperFor(api) }
  const table = tableFor(api)
  const key = wordKey(option)
  const matches = []
  for (const { path, name } of siblings(fn, api)) {
    const known = table.options[path]
    const match = known.find((o) => o === option) ?? known.find((o) => wordKey(o) === key)
    if (match) matches.push({ name, option: match })
  }
  if (!matches.length) return { fn, option, suggestions }
  // radiusStart's in-function suggestion (radius) is wrong advice once a
  // sibling takes the same words in another order (startRadius).
  const reordered = matches.some((m) => m.option !== option)
  const hint = matches.slice(0, 3).map((m) => `${m.name} takes ${m.option}`).join('; ')
  return { fn, option, suggestions: reordered || !suggestions.length ? [] : suggestions, hint }
}

const article = (type) => (type === 'array' ? 'an array' : 'a number')

// The chosen API's function with the called one's name, when it takes the
// option with the same type (jf.cylinder's radius takes an array too).
const counterpart = (fn, option, expected, api) => {
  const table = tableFor(api)
  const [cls, method] = fn.split('.')
  if (table.methodTypes?.[cls]?.[method]?.[option] === expected) return fn
  const base = baseName(fn)
  const path = Object.keys(table.types ?? {}).find((p) => baseName(p) === base && table.types[p][option] === expected)
  return path === undefined ? null : table.prefix + path
}

const typeHint = ({ fn, option, expected, got }, api) => {
  const own = counterpart(fn, option, expected, api)
  const parts = own ? [`${own} takes ${option} as ${article(expected)}`] : []
  if (baseName(fn) === 'cylinder' && option === 'radius' && got === 'array') return [...parts, taperFor(api)].join('; ')
  const table = tableFor(api)
  const sibling = siblings(fn, api).find(({ path }) => table.types?.[path]?.[option] === got)
  if (sibling) parts.push(`for ${article(got)} ${option} use ${sibling.name}`)
  return parts.length ? parts.join('; ') : `${option} takes ${article(expected)}`
}

const angleHint = ({ value }) => `${value} looks like degrees; angles are radians, so use ${value} * Math.PI / 180`

/**
 * The warning a model sees for a fact the option checks found: an unknown
 * option `{ fn, option, suggestions }`, a mistyped one `{ fn, option, expected, got }`
 * or an angle over 2π `{ fn, option, value }`.
 */
export const explainWarning = (fact, api = DEFAULT_API) => {
  const { fn, option } = fact
  if (Array.isArray(fact.suggestions)) return explainUnknown(fact, api)
  if (fact.expected) return { fn, option, hint: typeHint(fact, api) }
  if ('value' in fact) return { fn, option, hint: angleHint(fact) }
  return fact
}

const round = (x) => Number(x.toFixed(6))

const LIMITS = [
  [
    /roundRadius must be smaller than the radius of all dimensions/,
    ({ size, roundRadius }) => {
      if (!Array.isArray(size) || typeof roundRadius !== 'number') return undefined
      const least = Math.min(...size)
      return `roundRadius ${roundRadius} is too big: it must be under half the smallest size, ${least} / 2 = ${round(least / 2)}`
    },
  ],
  [
    /height must be larger than twice roundRadius/,
    ({ height, roundRadius }) => {
      if (typeof height !== 'number' || typeof roundRadius !== 'number') return undefined
      return `roundRadius ${roundRadius} is too big: it must be under half the height, ${height} / 2 = ${round(height / 2)}`
    },
  ],
]

/** The limit a modeling error states only in words, from the options the call was given. */
export const explainThrow = (message, options) => {
  if (options === null || typeof options !== 'object') return undefined
  for (const [pattern, explain] of LIMITS) {
    if (pattern.test(message)) return explain(options)
  }
  return undefined
}

const lookups = new WeakMap()

const lookupFor = (index) => {
  if (lookups.has(index)) return lookups.get(index)
  const classes = new Set(index.filter((e) => e.kind === 'class' && e.pkg === '@jbroll/jscad-fluent').map((e) => e.name))
  /** @type {Map<string, string[]>} */
  const methods = new Map()
  /** @type {Map<string, object[]>} */
  const functions = new Map()
  for (const e of index) {
    if (e.kind !== 'function') continue
    const dot = e.name.lastIndexOf('.')
    if (dot < 0) continue
    const name = e.name.slice(dot + 1)
    const owner = e.name.slice(0, dot)
    if (classes.has(owner)) methods.set(name, [...(methods.get(name) ?? []), owner])
    // Nested helpers (maths.vec3.scale, extrusions.slice.transform) share the operations' names.
    else if (e.pkg === '@jscad/modeling' && !owner.includes('.')) functions.set(name, [...(functions.get(name) ?? []), e])
  }
  const lookup = { methods, functions }
  lookups.set(index, lookup)
  return lookup
}

const callOf = (entry) => {
  const params = /\(([^)]*)\)/.exec(entry.signature)?.[1] ?? ''
  return `${entry.name}(${params.replace(/\.\.\.\w+/g, 'shape')})`
}

const NOT_A_FUNCTION = /(\S+) is not a function/

/**
 * A hint for "X is not a function" when X names a fluent method or a modeling
 * function, in the chosen API's form.
 * @param {string} message
 * @param {{ api?: string, index: Array<object> }} options index is api/index.json
 */
export const explainError = (message, { api = DEFAULT_API, index }) => {
  const match = NOT_A_FUNCTION.exec(message ?? '')
  if (!match || !index) return undefined
  const expr = match[1]
  const dot = expr.lastIndexOf('.')
  const name = expr.slice(dot + 1)
  const receiver = dot < 0 ? null : expr.slice(0, dot)
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined
  if (TAPER_WORDS.has(name.toLowerCase())) return taperFor(api)
  const { methods, functions } = lookupFor(index)
  if (api === 'fluent') {
    const classes = methods.get(name)
    if (!classes) return undefined
    const head = `${name} is a method of ${classes.join(', ')}`
    if (receiver && receiver !== 'jf') {
      return `${head}; plain @jscad/modeling shapes have no methods, so make the shape with jf.* and use shape.${name}(...)`
    }
    return `${head}: use shape.${name}(...)`
  }
  const entries = functions.get(name)
  if (!entries) return undefined
  const use = `use ${entries.map(callOf).join(' or ')}`
  return receiver && receiver !== 'jf' ? `@jscad/modeling shapes have no methods; ${use}` : use
}

/** The message with explainError's hint on a line of its own, added once. */
export const withErrorHint = (message, options) => {
  const hint = explainError(message, options)
  return hint && !message.includes(hint) ? `${message}\n${hint}` : message
}
