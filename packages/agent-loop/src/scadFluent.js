// cleanExports' RESERVED: members that are not library parts.
const RESERVED = new Set(['main', 'getParameterDefinitions', 'fn', 'vars', '$meta', '$scad'])

const isTreeNode = (value) => value?.isTreeNode === true

/**
 * A .scad part as fluent geometry: geom3 or a dim-3 tree node becomes a
 * FluentGeom3, geom2 or a dim-2 node a FluentGeom2, an array is mapped.
 * @param {unknown} value
 * @param {object} jf the jscad-fluent module
 */
export const toFluent = (value, jf) => {
  if (Array.isArray(value)) return value.map((item) => toFluent(item, jf))
  if (value === null || typeof value !== 'object') return value
  if (isTreeNode(value) ? value.dim === 3 : jf.isGeom3(value)) return new jf.FluentGeom3(value)
  if (isTreeNode(value) ? value.dim === 2 : jf.isGeom2(value)) return new jf.FluentGeom2(value)
  return value
}

/**
 * A copy of transpiled .scad exports whose modules and functions return
 * fluent geometry. Other members keep their descriptors, so getters stay lazy.
 * @param {object} exports
 * @param {object} jf the jscad-fluent module
 */
export const wrapScadExports = (exports, jf) => {
  const wrapped = {}
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(exports))) {
    const { value } = descriptor
    if (typeof value === 'function' && !RESERVED.has(name)) {
      Object.defineProperty(wrapped, name, { ...descriptor, value: (...args) => toFluent(value(...args), jf) })
    } else if (value === exports) {
      Object.defineProperty(wrapped, name, { ...descriptor, value: wrapped })
    } else {
      Object.defineProperty(wrapped, name, descriptor)
    }
  }
  return wrapped
}

/**
 * The wrapper require's setScadExportsWrapper takes: fluent code gets one
 * wrapped copy per exports object, modeling code the exports themselves. The
 * style is read on every require because cached exports outlive a style change.
 * @param {{ getApi: () => string, getFluent: () => object }} options
 */
export const createScadExportsWrapper = ({ getApi, getFluent }) => {
  const copies = new WeakMap()
  return (exports) => {
    if (getApi() !== 'fluent') return exports
    let copy = copies.get(exports)
    if (!copy) {
      copy = wrapScadExports(exports, getFluent())
      copies.set(exports, copy)
    }
    return copy
  }
}
