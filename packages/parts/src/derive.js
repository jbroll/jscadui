export const signature = (exports, call) => {
  const entry = exports.$meta.findLast((e) => e.name === call && e.kind === 'module') ?? exports.$meta.findLast((e) => e.name === call && e.kind === 'function')
  if (!entry) throw new Error(`${call} is not exported`)
  return { params: entry.params ?? [] }
}

export const sizeNames = (exports, sizes) => {
  if (sizes.values) return [...sizes.values]
  if (sizes.names) return [...sizes.names]
  const list = exports.vars[sizes.list]
  if (!Array.isArray(list)) throw new Error(`${sizes.list} is not a list`)
  const names = Object.keys(exports.vars).filter((k) => k !== sizes.list && list.includes(exports.vars[k]))
  return names.sort((a, b) => list.indexOf(exports.vars[a]) - list.indexOf(exports.vars[b]))
}
