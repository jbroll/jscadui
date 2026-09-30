import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { declarationOf, firstSentence, leadingBlock } from './jsdoc.js'

// maths and geometries come last so a bare name (transform, create) still
// resolves to the modeling operation first.
export const MODELING_NAMESPACES = [
  'primitives', 'booleans', 'transforms', 'extrusions', 'expansions', 'hulls', 'minkowski',
  'modifiers', 'colors', 'measurements', 'curves', 'text', 'utils', 'maths', 'geometries',
]

const MODELING = '@jscad/modeling'
const JSCAD_TEXT = '@jscadui/jscad-text'
const MEMBER = /^\s*([A-Za-z_$][\w$]*)\s*:\s*require\('(\.[^']+)'\)(?:\.([A-Za-z_$][\w$]*))?/gm
const REEXPORT = /^export \{([^}]*)\} from '(\.[^']+)'/gm
const read = (file) => readFileSync(file, 'utf8')

const moduleFile = (dir, rel) => {
  const file = join(dir, `${rel}.js`)
  return existsSync(file) ? file : join(dir, rel, 'index.js')
}

const soleExport = (source) => /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*$/m.exec(source)?.[1]

// maths/constants.js exports an object of values: `module.exports = { EPS, TAU }`.
const objectExport = (source) => {
  const body = /^module\.exports\s*=\s*\{([^}]*)\}/m.exec(source)?.[1]
  return body ? body.split(',').map((name) => name.trim()).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)) : null
}

const valuesNamespace = (source, name) => {
  const entries = objectExport(source).map((member) => {
    const decl = declarationOf(source, member) ?? { kind: 'value', doc: null }
    return functionEntry({ name: `${name}.${member}`, pkg: MODELING, kind: decl.kind, doc: decl.doc })
  })
  const members = entries.map((e) => ({ name: e.name.slice(name.length + 1), summary: firstSentence(e.description) }))
  return [{ name, pkg: MODELING, kind: 'namespace', description: '', members }, ...entries]
}

// Options the function reads from its defaults literal but its JSDoc omits
// (extrudeLinear's repair), so a correct call never draws a warning.
const defaultsOf = (source) => {
  const block = /const defaults = \{\n([\s\S]*?)\n\s*\}/.exec(source)
  if (!block) return []
  return block[1].split('\n').flatMap((line) => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.*?),?\s*$/.exec(line)
    return m ? [{ name: m[1], default: m[2] }] : []
  })
}

export const functionEntry = ({ name, pkg, kind, doc, extraDefaults = [] }) => {
  const short = name.slice(name.lastIndexOf('.') + 1)
  if (kind !== 'function') return { name, pkg, kind, signature: short, description: doc?.description ?? '' }
  const params = doc?.params ?? []
  const top = params.filter((p) => !p.name.includes('.'))
  const options = params
    .filter((p) => /^options\.[A-Za-z_$][\w$]*$/.test(p.name))
    .map((p) => ({ name: p.name.slice('options.'.length), type: p.type, default: p.default, description: p.description }))
  const optionsFirst = top[0]?.name === 'options'
  if (optionsFirst) {
    for (const extra of extraDefaults) {
      if (!options.some((o) => o.name === extra.name)) options.push({ name: extra.name, type: '', default: extra.default, description: '' })
    }
  }
  const args = top.map((p) => (p.type.startsWith('...') ? `...${p.name}` : p.name)).join(', ')
  const entry = {
    name,
    pkg,
    kind,
    signature: `${short}(${args})${doc?.returns ? ` → ${doc.returns}` : ''}`,
    description: doc?.description ?? '',
  }
  if (optionsFirst) entry.optionsFirst = true
  if (options.length) entry.options = options
  // maths params are nearly all `out - the receiving vector`, 22 KB of them.
  const positional = name.startsWith('maths.') ? [] : top.filter((p) => p.name !== 'options' && p.description)
  if (positional.length) entry.params = positional.map((p) => ({ name: p.name, type: p.type, description: p.description }))
  if (doc?.example) entry.example = doc.example
  return entry
}

const namespaceEntries = (indexFile, name) => {
  const source = read(indexFile)
  const dir = dirname(indexFile)
  const members = []
  const entries = []
  for (const [, member, rel, prop] of source.matchAll(MEMBER)) {
    const file = moduleFile(dir, rel)
    const qualified = `${name}.${member}`
    if (file.endsWith('index.js') && !prop) {
      const nested = namespaceEntries(file, qualified)
      members.push({ name: member, summary: firstSentence(nested[0].description) })
      entries.push(...nested)
      continue
    }
    const fileSource = read(file)
    if (!prop && !soleExport(fileSource) && objectExport(fileSource)) {
      const nested = valuesNamespace(fileSource, qualified)
      members.push({ name: member, summary: '' })
      entries.push(...nested)
      continue
    }
    const local = prop ?? soleExport(fileSource) ?? member
    const decl = declarationOf(fileSource, local) ?? { kind: 'function', doc: null }
    const extraDefaults = !prop && soleExport(fileSource) ? defaultsOf(fileSource) : []
    const entry = functionEntry({ name: qualified, pkg: MODELING, kind: decl.kind, doc: decl.doc, extraDefaults })
    members.push({ name: member, summary: firstSentence(entry.description) })
    entries.push(entry)
  }
  const doc = leadingBlock(source)
  return [{ name, pkg: MODELING, kind: 'namespace', description: doc?.description ?? '', members }, ...entries]
}

export const modelingEntries = (srcDir) => {
  const root = read(join(srcDir, 'index.js'))
  const files = new Map([...root.matchAll(MEMBER)].map(([, member, rel]) => [member, moduleFile(srcDir, rel)]))
  return MODELING_NAMESPACES.flatMap((ns) => namespaceEntries(files.get(ns), ns))
}

export const jscadTextEntries = (srcDir) => {
  const indexSource = read(join(srcDir, 'index.js'))
  const found = [...indexSource.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)]
    .map(([, name]) => ({ name, local: name, source: indexSource }))
  for (const [, list, rel] of indexSource.matchAll(REEXPORT)) {
    const source = read(join(srcDir, rel))
    for (const item of list.split(',')) {
      const [local, alias] = item.trim().split(/\s+as\s+/)
      if (local) found.push({ name: alias ?? local, local, source })
    }
  }
  const entries = found.flatMap(({ name, local, source }) => {
    const decl = declarationOf(source, local)
    if (decl?.kind !== 'function' || !decl.doc) return []
    return [functionEntry({ name: `jscadText.${name}`, pkg: JSCAD_TEXT, kind: 'function', doc: decl.doc })]
  })
  const description = 'Text as 2D geometry: Hershey stroke fonts and TTF/OTF outline fonts. text2d needs no init: the runtime sets jscad-text up with @jscad/modeling.'
  const members = entries.map((e) => ({ name: e.name.slice('jscadText.'.length), summary: firstSentence(e.description) }))
  return [{ name: 'jscadText', pkg: JSCAD_TEXT, kind: 'namespace', description, members }, ...entries]
}
