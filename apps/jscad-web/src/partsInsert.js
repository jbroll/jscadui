/**
 * @typedef {{ call: string, require: string, scadIncludes: string[], insertArgs?: unknown[] }} CatalogEntry
 * @typedef {{ from: number, to?: number, insert: string }} ChangeSpec
 */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isIdentifier = (s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)

const isScadPath = (path) => /\.scad($|[?#])/i.test(path)

/** Line containing `pos`, and whether it is empty or whitespace-only. */
const lineAt = (doc, pos) => {
  const start = doc.lastIndexOf('\n', pos - 1) + 1
  const end = doc.indexOf('\n', pos) === -1 ? doc.length : doc.indexOf('\n', pos)
  const text = doc.slice(start, end)
  return { text, isBlank: /^\s*$/.test(text) }
}

/** The call lands in place on a blank line, else on its own line; `endOffset` is where the call text ends in `insert`. */
const callChangeAt = (doc, cursor, callText) => {
  const { text, isBlank } = lineAt(doc, cursor)
  if (isBlank) {
    return { change: { from: cursor, to: cursor, insert: callText }, endOffset: callText.length }
  }
  const indent = (text.match(/^\s*/) || [''])[0]
  const insert = `\n${indent}${callText}\n${indent}`
  return { change: { from: cursor, to: cursor, insert }, endOffset: 1 + indent.length + callText.length }
}

/** Position of `origPos` after applying `changes` (each independent, in original-doc offsets). */
const mapOffset = (origPos, changes) =>
  changes.reduce((pos, c) => {
    const to = c.to ?? c.from
    return c.from <= origPos ? pos + c.insert.length - (to - c.from) : pos
  }, origPos)

/** Every `const { a, b: c } = require('...')` binding in the doc: bound name -> require path. */
const existingBindings = (doc) => {
  const bound = new Map()
  const re = /const\s*\{([^}]*)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g
  let m = re.exec(doc)
  while (m) {
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const alias = part.split(':').map((s) => s.trim())
      bound.set(alias.length === 2 ? alias[1] : alias[0], m[2])
    }
    m = re.exec(doc)
  }
  return bound
}

/** `call` plus the lowest free numeric suffix (2, 3, ...) when `call` is already bound, else null. */
const freeAlias = (doc, call) => {
  const bound = existingBindings(doc)
  if (!bound.has(call)) return null
  let n = 2
  while (bound.has(`${call}${n}`)) n++
  return `${call}${n}`
}

/** End of the line holding the `require('<path>')`, so a new require can sit beneath it. */
const requireLineEnd = (doc, path) => {
  const match = new RegExp(`require\\(['"]${escapeRegExp(path)}['"]\\)`).exec(doc)
  if (!match) return 0
  const nl = doc.indexOf('\n', match.index)
  return nl === -1 ? doc.length : nl + 1
}

const jsRequireChange = (doc, entry, size) => {
  // Alias only when the call name is already bound from a different require:
  // the same require can simply gain the missing name below.
  const boundTo = existingBindings(doc).get(entry.call)
  const alias = boundTo && boundTo !== entry.require ? freeAlias(doc, entry.call) : null
  const bindName = (name) => (name === entry.call && alias ? `${name}: ${alias}` : name)
  const needed = isIdentifier(size) ? [entry.call, size] : [entry.call]

  const re = new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*require\\(['"]${escapeRegExp(entry.require)}['"]\\)`, 'd')
  const match = re.exec(doc)

  if (!match) {
    const at = alias ? requireLineEnd(doc, boundTo) : 0
    return { from: at, to: at, insert: `const { ${needed.map(bindName).join(', ')} } = require('${entry.require}')\n`, alias }
  }

  const group = match[1]
  const existing = group
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const missing = needed.filter((n) => !existing.includes(n))
  if (missing.length === 0) return undefined

  // Insert before the closing brace rather than rebuilding the group, so a
  // multi-line destructuring (or a trailing comma) keeps its own formatting.
  const core = group.replace(/[\s,]+$/, '')
  const tail = group.slice(core.length)
  const [start, end] = match.indices[1]
  return { from: start, to: end, insert: `${core}, ${missing.map(bindName).join(', ')}${tail}`, alias }
}

/** Whether `include`/`use <inc>` is already present, tolerant of spacing around `<...>`. */
const scadDirectivePresent = (doc, inc) => new RegExp(`(include|use)\\s*<\\s*${escapeRegExp(inc)}\\s*>`).test(doc)

const scadIncludesChange = (doc, entry) => {
  const missing = entry.scadIncludes.filter((inc) => !scadDirectivePresent(doc, inc))
  if (missing.length === 0) return undefined
  return { from: 0, to: 0, insert: missing.map((inc) => `include <${inc}>\n`).join('') }
}

/**
 * @param {{ doc: string, cursor: number, path: string, entry: CatalogEntry, size: string }} args `size` is call argument text
 * @returns {{ changes: ChangeSpec[], cursor: number }}
 */
export const planInsert = ({ doc, cursor, path, entry, size }) => {
  const scad = isScadPath(path)
  const args = [size, ...(entry.insertArgs ?? []).map((a) => JSON.stringify(a))].join(', ')
  const prefixChange = scad ? scadIncludesChange(doc, entry) : jsRequireChange(doc, entry, size)
  const callName = prefixChange?.alias ?? entry.call
  const callText = scad ? `${callName}(${args});` : `${callName}(${args})`
  const { change: callChange, endOffset } = callChangeAt(doc, cursor, callText)

  if (!prefixChange) {
    return { changes: [callChange], cursor: callChange.from + endOffset }
  }

  // CodeMirror concatenates same-offset inserts in array order; one merged change states that order outright.
  const prefixIsInsert = (prefixChange.to ?? prefixChange.from) === prefixChange.from
  if (prefixIsInsert && prefixChange.from === callChange.from) {
    const insert = prefixChange.insert + callChange.insert
    return {
      changes: [{ from: prefixChange.from, to: prefixChange.from, insert }],
      cursor: prefixChange.from + prefixChange.insert.length + endOffset,
    }
  }

  const changes = [prefixChange, callChange].sort((a, b) => a.from - b.from)
  const cursorPos = mapOffset(cursor, [prefixChange]) + endOffset
  return { changes, cursor: cursorPos }
}
