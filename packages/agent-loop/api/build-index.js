import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fluentEntries } from './fluent.js'
import { jscadTextEntries, modelingEntries } from './jsdocEntries.js'
import { buildSheet } from './sheet.js'
import { fontList, STATIC_FONT_MAP } from '@jscadui/jscad-text'
import { APIS } from '../src/api.js'
import { isMainModule } from '../src/mainModule.js'

const require = createRequire(import.meta.url)

// Functions that hand their own options object to another public function.
const PASS_THROUGH = {
  'extrusions.extrudeRectangular': ['expansions.expand', 'extrusions.extrudeLinear'],
}

const addPassThrough = (entries) => {
  const byName = new Map(entries.map((e) => [e.name, e]))
  for (const [name, targets] of Object.entries(PASS_THROUGH)) {
    const entry = byName.get(name)
    for (const target of targets) {
      for (const option of byName.get(target).options ?? []) {
        if (!entry.options.some((o) => o.name === option.name)) entry.options.push(option)
      }
    }
  }
  return entries
}

// Options a function reads via a shared params helper (vectorText/vectorChar
// via vectorParams's defaultsVectorParams), so its own JSDoc never lists them.
const EXTRA_OPTIONS = {
  'text.vectorText': ['font'],
  'text.vectorChar': ['font'],
}

const addExtraOptions = (entries) => {
  for (const entry of entries) {
    for (const name of EXTRA_OPTIONS[entry.name] ?? []) {
      if (!entry.options.some((o) => o.name === name)) entry.options.push({ name, type: '', default: '', description: '' })
    }
  }
  return entries
}

// So a model picks a font by name instead of guessing a URL.
const addFontNames = (entries) => {
  const font = entries.find((e) => e.name === 'jscadText.text2d').options.find((o) => o.name === 'font')
  font.description += ` Font names: ${fontList(Object.keys(STATIC_FONT_MAP))}`
  return entries
}

export const buildIndex = () => {
  const modeling = addExtraOptions(addPassThrough(modelingEntries(dirname(require.resolve('@jscad/modeling')))))
  const fluent = fluentEntries(dirname(require.resolve('@jbroll/jscad-fluent')), modeling)
  const text = addFontNames(jscadTextEntries(fileURLToPath(new URL('../../jscad-text/src', import.meta.url))))
  return [...modeling, ...fluent, ...text]
}

const PACKAGE_PREFIX = { '@jscad/modeling': '', '@jbroll/jscad-fluent': 'jf.' }

const optionsOf = (e, byName) => (e.sameAs ? byName.get(e.sameAs) : e).options ?? []

const optionNames = (e, byName) => optionsOf(e, byName).map((o) => o.name).sort()

// Only a number given for an array, or the reverse, is checked: other JSDoc
// types are too loose to judge a value by.
const typeClass = (type) => {
  if (/^(number|float|integer)$/i.test(type)) return 'number'
  if (/^(array|point\d|vec\d|\[.*\])$/i.test(type)) return 'array'
  return null
}

const optionTypes = (e, byName) => {
  const types = {}
  for (const o of [...optionsOf(e, byName)].sort((a, b) => a.name.localeCompare(b.name))) {
    const type = typeClass(o.type)
    if (type) types[o.name] = type
  }
  return types
}

const ANGLE_FIRST = /^\w+\(angles?\b/

// Data helpers, not modeling operations: wrapping them would only widen the
// sibling hints (arc → appendArc) and the frame bundle.
const UNCHECKED = /^(maths|geometries)\./

export const optionTables = (entries) => {
  const byName = new Map(entries.map((e) => [e.name, e]))
  const classes = new Set(entries.filter((e) => e.kind === 'class').map((e) => e.name))
  const tables = {}
  for (const [pkg, prefix] of Object.entries(PACKAGE_PREFIX)) {
    const options = {}
    const methods = {}
    const types = {}
    const methodTypes = {}
    const angles = []
    const methodAngles = {}
    for (const e of entries) {
      if (e.pkg !== pkg || e.kind !== 'function' || UNCHECKED.test(e.name)) continue
      const dot = e.name.indexOf('.')
      const owner = e.name.slice(0, dot)
      const isMethod = classes.has(owner)
      if (!isMethod && !e.name.startsWith(prefix)) continue
      const method = e.name.slice(dot + 1)
      const path = e.name.slice(prefix.length)
      if (e.optionsFirst) {
        const typed = optionTypes(e, byName)
        if (isMethod) {
          methods[owner] ??= {}
          methods[owner][method] = optionNames(e, byName)
          if (Object.keys(typed).length) {
            methodTypes[owner] ??= {}
            methodTypes[owner][method] = typed
          }
        } else {
          options[path] = optionNames(e, byName)
          if (Object.keys(typed).length) types[path] = typed
        }
      }
      if (ANGLE_FIRST.test(e.signature)) {
        if (isMethod) (methodAngles[owner] ??= []).push(method)
        else angles.push(path)
      }
    }
    tables[pkg] = { prefix, options, methods, types, methodTypes, angles, methodAngles }
  }
  return tables
}

export const formatIndex = (entries) => `[\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`

const rows = (record, indent) => Object.entries(record).map(([key, names]) => `${indent}${JSON.stringify(key)}: ${JSON.stringify(names)},`)

const block = (record, indent) => {
  const lines = rows(record, `${indent}  `)
  return lines.length ? `{\n${lines.join('\n')}\n${indent}}` : '{}'
}

const byClass = (record) => {
  const classes = Object.entries(record).map(([cls, byMethod]) => `      ${JSON.stringify(cls)}: ${block(byMethod, '      ')},`)
  return classes.length ? `{\n${classes.join('\n')}\n    }` : '{}'
}

export const formatOptionTable = (tables) => {
  const packages = Object.entries(tables).map(([pkg, { prefix, options, methods, types, methodTypes, angles, methodAngles }]) => [
    `  ${JSON.stringify(pkg)}: {`,
    `    prefix: ${JSON.stringify(prefix)},`,
    `    options: ${block(options, '    ')},`,
    `    methods: ${byClass(methods)},`,
    `    types: ${block(types, '    ')},`,
    `    methodTypes: ${byClass(methodTypes)},`,
    `    angles: ${JSON.stringify(angles)},`,
    `    methodAngles: ${block(methodAngles, '    ')},`,
    '  },',
  ].join('\n'))
  return `// Generated by api/build-index.js; do not edit. Run: npm run api-index -w @jscadui/agent-loop\nexport const OPTION_TABLES = {\n${packages.join('\n')}\n}\n`
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const entries = buildIndex()
  writeFileSync(new URL('./index.json', import.meta.url), formatIndex(entries))
  writeFileSync(new URL('./optionTable.js', import.meta.url), formatOptionTable(optionTables(entries)))
  for (const api of APIS) writeFileSync(new URL(`../prompt/sheet-${api}.md`, import.meta.url), buildSheet(entries, api))
  console.log(`api-index: ${entries.length} entries`)
}
