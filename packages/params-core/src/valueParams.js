import { createParamsProxy, createProxyState } from './createParamsProxy.js'

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// The proxy's UI values are flat, keyed by dotted path.
const flatten = (values, prefix = '', out = {}) => {
  for (const [key, value] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) flatten(value, path, out)
    else out[path] = value
  }
  return out
}

/**
 * The params a build hands main(), with `values` set as a user's edits are:
 * each one wins over the definition main() assigns, and every other
 * parameter takes its default.
 * @param {object} [values]
 */
export const paramsFromValues = (values = {}) => {
  const flat = isPlainObject(values) ? flatten(values) : {}
  return createParamsProxy(createProxyState(flat, new Set(Object.keys(flat)), { mode: 'hierarchical' }))
}

/**
 * main, taking plain values the way a build's params proxy would carry them.
 * @param {Function} main
 */
export const withValueParams = (main) =>
  function (params, ...rest) {
    const given = params?._isParamsProxy === true || (params != null && !isPlainObject(params)) ? params : paramsFromValues(params ?? {})
    return main.call(this, given, ...rest)
  }

const isProjectSpec = (spec) => typeof spec === 'string' && /^\.{0,2}\//.test(spec)

/**
 * A require whose project modules hand back their main() wrapped by
 * withValueParams, in a copy, so the loader's cached exports stay as they are.
 * @param {(spec: string) => unknown} require
 */
export const withProjectMains = (require) => (spec) => {
  const exports = require(spec)
  if (!isProjectSpec(spec)) return exports
  if (typeof exports === 'function') return Object.assign(withValueParams(exports), exports)
  if (exports === null || typeof exports !== 'object' || typeof exports.main !== 'function') return exports
  const copy = { ...exports, main: withValueParams(exports.main) }
  if (exports.default === exports) copy.default = copy
  return copy
}
