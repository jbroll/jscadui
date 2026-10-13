import { DEFAULT_API } from './api.js'
import { docsTool } from './docs.js'
import { explainWarning } from './hints.js'
import { suggestOptions } from './optionChecks.js'

export const MAX_DIAGNOSTICS = 20

// Bare calls the model is expected to have without declaring them.
const GLOBALS = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Function', 'Infinity', 'JSON',
  'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'Reflect',
  'RegExp', 'Set', 'String', 'Symbol', 'TypeError', 'WeakMap', 'WeakSet',
  'console', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'require', 'undefined',
])

const tables = new WeakMap()

// The names the model writes: a modeling function's last segment after a
// destructure, a jf.<name> factory as written, and every full entry name.
const tablesFor = (index) => {
  if (tables.has(index)) return tables.get(index)
  const byName = new Map()
  for (const entry of index) byName.set(entry.name, entry)
  const callables = new Map()
  for (const entry of index) {
    if (entry.kind !== 'function') continue
    if (entry.name.startsWith('jf.')) {
      callables.set(entry.name, entry)
      continue
    }
    const dot = entry.name.lastIndexOf('.')
    if (dot <= 0) continue
    if (!entry.name.slice(0, dot).includes('.')) callables.set(entry.name.slice(dot + 1), entry)
  }
  const table = { byName, callables }
  tables.set(index, table)
  return table
}

const optionsOf = (t, entry) => {
  const resolved = entry.sameAs ? t.byName.get(entry.sameAs) : entry
  return resolved?.options ?? null
}

const unquote = (text) => (text.length >= 2 && (text[0] === '"' || text[0] === "'") ? text.slice(1, -1) : text)

const firstArg = (argList) => {
  for (let node = argList.firstChild; node; node = node.nextSibling) {
    if (node.type.name === '(' || node.type.name === ',') continue
    return node
  }
  return null
}

// The keys of an object literal: an identifier or string key is checked, a
// computed, spread or method key is left alone. `text` is the source, since a
// Lezer node's name is its type name, not its text.
const objectKeys = (object, text) => {
  const keys = []
  for (let property = object.firstChild; property; property = property.nextSibling) {
    if (property.type.name !== 'Property') continue
    const key = property.firstChild
    if (key?.type.name === 'PropertyDefinition') keys.push({ name: text.slice(key.from, key.to), from: key.from, to: key.to })
    else if (key?.type.name === 'String') keys.push({ name: unquote(text.slice(key.from, key.to)), from: key.from, to: key.to })
  }
  return keys
}

const resolveCallee = (t, callee, text) => {
  if (!callee) return null
  if (callee.type.name === 'VariableName') return t.callables.get(text.slice(callee.from, callee.to)) ?? null
  if (callee.type.name === 'MemberExpression') {
    const object = callee.firstChild
    const property = callee.lastChild
    if (object?.type.name === 'VariableName' && property?.type.name === 'PropertyName') {
      const entry = t.byName.get(`${text.slice(object.from, object.to)}.${text.slice(property.from, property.to)}`)
      if (entry?.kind === 'function') return entry
    }
  }
  return null
}

/** @param {Array<object>} index @param {string} name */
export const lookupName = (index, name) => {
  if (!name) return null
  const t = tablesFor(index)
  return t.callables.get(name) ?? t.byName.get(name) ?? null
}

const collectDeclared = (tree, text) => {
  const names = new Set()
  const cursor = tree.cursor()
  do {
    if (cursor.name === 'VariableDefinition') names.add(text.slice(cursor.from, cursor.to))
    else if (cursor.name === 'PropertyName' && cursor.node.parent?.type.name === 'PatternProperty') names.add(text.slice(cursor.from, cursor.to))
  } while (cursor.next())
  return names
}

const withLocation = (diagnostic, text) => {
  if (typeof text !== 'string') return diagnostic
  let line = 1
  let lineStart = 0
  for (let i = 0; i < diagnostic.from && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lineStart = i + 1
    }
  }
  return { ...diagnostic, line, column: diagnostic.from - lineStart + 1 }
}

const lintCall = (t, call, text, declared, api, push) => {
  const callee = call.firstChild
  const argList = call.getChild('ArgList')
  if (!callee || !argList) return
  const first = firstArg(argList)
  const entry = resolveCallee(t, callee, text)
  if (entry) {
    if (first?.type.name !== 'ObjectExpression') return
    const options = optionsOf(t, entry)
    if (!options?.length) return
    const known = options.map((option) => option.name)
    for (const key of objectKeys(first, text)) {
      if (known.includes(key.name)) continue
      const suggestions = suggestOptions(key.name, known)
      const explained = explainWarning({ fn: entry.name, option: key.name, suggestions }, api)
      push({
        from: key.from,
        to: key.to,
        severity: 'warning',
        source: 'jscad',
        message: explained.hint ?? `unknown option ${key.name}`,
        fn: entry.name,
        option: key.name,
        suggestions: explained.suggestions ?? suggestions,
      })
    }
    return
  }
  if (callee.type.name !== 'VariableName') return
  const name = text.slice(callee.from, callee.to)
  if (declared.has(name) || GLOBALS.has(name)) return
  if (first?.type.name !== 'ObjectExpression') return
  push({ from: callee.from, to: callee.to, severity: 'warning', source: 'jscad', message: `unknown function ${name}; it is not in the API index`, fn: name })
}

/**
 * @param {Array<object>} index api/index.json
 * @param {import('@lezer/common').Tree} tree
 * @param {{ api?: string, text?: string }} [options]
 */
export const lintTree = (index, tree, { api = DEFAULT_API, text = '' } = {}) => {
  const t = tablesFor(index)
  const declared = collectDeclared(tree, text)
  const diagnostics = []
  const push = (diagnostic) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(withLocation(diagnostic, text))
  }
  const cursor = tree.cursor()
  do {
    if (cursor.type.isError) {
      push({ from: cursor.from, to: Math.max(cursor.to, cursor.from + 1), severity: 'error', source: 'jscad', message: 'Syntax error' })
    } else if (cursor.name === 'CallExpression') {
      lintCall(t, cursor.node, text, declared, api, push)
    }
  } while (cursor.next())
  return diagnostics
}

/**
 * @param {Array<object>} index
 * @param {string} source
 * @param {{ api?: string }} [options]
 */
export const lintSource = async (index, source, options = {}) => {
  const { parser } = await import('@lezer/javascript')
  const text = String(source ?? '')
  return lintTree(index, parser.parse(text), { ...options, text })
}

const optionLine = (option) =>
  `${option.name}${option.type ? `: ${option.type}` : ''}${option.default != null ? ` = ${option.default}` : ''}${option.description ? ` - ${option.description}` : ''}`

const dottedName = (node, text) => {
  const member = node.parent
  if (member?.type.name !== 'MemberExpression') return null
  const object = member.firstChild
  return object?.type.name === 'VariableName' ? `${text.slice(object.from, object.to)}.${text.slice(node.from, node.to)}` : null
}

const optionUnder = (t, node, text) => {
  if (node.type.name !== 'PropertyDefinition') return null
  const object = node.parent?.parent
  if (object?.type.name !== 'ObjectExpression') return null
  const argList = object.parent
  const call = argList?.parent
  if (argList?.type.name !== 'ArgList' || call?.type.name !== 'CallExpression') return null
  const first = firstArg(argList)
  if (!first || first.from !== object.from || first.to !== object.to) return null
  const entry = resolveCallee(t, call.firstChild, text)
  const options = entry ? optionsOf(t, entry) : null
  return options?.find((option) => option.name === text.slice(node.from, node.to)) ?? null
}

/**
 * The docs text for the name or option key at `pos`, or null.
 * @param {Array<object>} index
 * @param {import('@lezer/common').Tree} tree
 * @param {number} pos
 * @param {string} text the document source
 */
export const hoverTarget = (index, tree, pos, text) => {
  const node = tree.resolveInner(pos, -1)
  const name = node.type.name === 'PropertyName' ? dottedName(node, text) : node.type.name === 'VariableName' ? text.slice(node.from, node.to) : null
  const entry = lookupName(index, name)
  if (entry) return { from: node.from, to: node.to, text: docsTool(index, entry.name) }
  const option = optionUnder(tablesFor(index), node, text)
  if (option) return { from: node.from, to: node.to, text: optionLine(option) }
  return null
}
