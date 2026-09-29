import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstSentence, parseBlock } from './jsdoc.js'

const FLUENT = '@jbroll/jscad-fluent'
const CLASSES = ['FluentGeom2', 'FluentGeom3', 'FluentPath2', 'FluentGeometryArray', 'FluentGeom2Array', 'FluentGeom3Array', 'FluentPath2Array']

const read = (file) => readFileSync(file, 'utf8')
const squash = (text) => text.replace(/\s+/g, ' ').trim()
const lcfirst = (s) => s[0].toLowerCase() + s.slice(1)

// Splits a type-literal or class body on the semicolons at its own depth,
// keeping each member's leading JSDoc.
export const members = (body) => {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (body.startsWith('/*', i)) {
      i = body.indexOf('*/', i) + 1
      continue
    }
    if ('({['.includes(c)) depth += 1
    else if (')}]'.includes(c)) depth -= 1
    else if (c === ';' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  return out.map((text) => {
    const doc = /^\s*\/\*\*([\s\S]*?)\*\/\s*/.exec(text)
    const raw = doc ? text.slice(doc[0].length) : text
    return { doc: doc ? parseBlock(doc[1]) : null, raw, text: squash(raw) }
  }).filter((m) => m.text)
}

const bodyAfter = (source, marker) => {
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`fluent types: no "${marker}"`)
  const open = source.indexOf('{', at + marker.length - 1)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`fluent types: unbalanced "${marker}"`)
}

const closeParen = (text, open) => {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

// A method with no modeling counterpart (appendArc) documents its options in
// modeling's `[options.name=default]` JSDoc form.
const docOptions = (doc) => {
  const options = (doc?.params ?? []).filter((p) => /^options\.[A-Za-z_$][\w$]*$/.test(p.name))
  if (!options.length) return null
  return {
    optionsFirst: true,
    options: options.map((p) => ({ name: p.name.slice('options.'.length), type: p.type, default: p.default, description: p.description })),
  }
}

const method = (text) => {
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text)
  if (!m) return null
  const open = m[0].length - 1
  const close = closeParen(text, open)
  return { name: m[1], params: text.slice(open + 1, close).trim(), returns: text.slice(close + 1).replace(/^\s*:\s*/, '').trim() }
}

export const fluentEntries = (distDir, modeling) => {
  const modelingFn = new Map()
  for (const e of modeling) {
    if (e.kind !== 'function') continue
    const bare = e.name.slice(e.name.lastIndexOf('.') + 1)
    if (!modelingFn.has(bare)) modelingFn.set(bare, e)
  }
  const byName = new Map(modeling.map((e) => [e.name, e]))
  const sameAs = (target) => ({ sameAs: target.name, ...(target.optionsFirst ? { optionsFirst: true } : {}) })

  // A destructuring pattern names its own keys; an inline `options: {...}` or
  // a named *Options type passes through to the modeling function.
  const optionsOf = (name, params) => {
    if (params.startsWith('{')) {
      const keys = /^\{([^}]*)\}/.exec(params)[1].split(',').map((k) => k.trim()).filter(Boolean)
      return { optionsFirst: true, options: keys.map((k) => ({ name: k, type: '', default: null, description: '' })) }
    }
    const typed = /^(\w+)\s*:\s*(\w+)?/.exec(params)
    if (!typed) return {}
    const [, param, type] = typed
    const named = type && /^(\w+)Options$/.exec(type)
    const target = named ? modelingFn.get(lcfirst(named[1])) : param === 'options' ? modelingFn.get(name) : null
    return target ? sameAs(target) : {}
  }

  const fromModeling = (bare) => {
    const target = modelingFn.get(bare)
    return target ? firstSentence(target.description) : ''
  }

  const index = read(join(distDir, 'index.d.ts'))
  const declared = new Map()
  for (const m of index.matchAll(/^declare function ([A-Za-z_$][\w$]*)(\([^\n]*);$/gm)) {
    if (!declared.has(m[1])) declared.set(m[1], method(`${m[1]}${m[2]}`))
  }

  const cylinderSource = read(join(distDir, 'cylinder.d.ts'))
  const flex = members(bodyAfter(cylinderSource, 'interface FlexCylinderOptions {'))
  const cylinderDoc = parseBlock(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*export declare function cylinder/.exec(cylinderSource)[1])

  const factory = (prefix, { doc, text }) => {
    const typeofRef = /^([A-Za-z_$][\w$]*)\s*:\s*typeof\s+([\w.]+)$/.exec(text)
    if (typeofRef) {
      const [, name, ref] = typeofRef
      const qualified = `${prefix}.${name}`
      if (ref === 'cylinder') {
        return {
          name: qualified, pkg: FLUENT, kind: 'function',
          signature: 'cylinder(options: FlexCylinderOptions) → FluentGeom3',
          description: cylinderDoc.description,
          optionsFirst: true,
          options: flex.map((m) => ({
            name: /^(\w+)/.exec(m.text)[1], type: squash(m.text.replace(/^\w+\??\s*:\s*/, '')), default: null, description: m.doc?.description ?? '',
          })),
          ...(cylinderDoc.example ? { example: cylinderDoc.example } : {}),
        }
      }
      const fn = declared.get(ref)
      if (fn) return { name: qualified, pkg: FLUENT, kind: 'function', signature: `${name}(${fn.params}) → ${fn.returns}`, description: doc?.description || fromModeling(name) }
      const target = byName.get(ref)
      if (target) {
        return {
          name: qualified, pkg: FLUENT, kind: target.kind, signature: target.signature.replace(/^\w+/, name),
          description: doc?.description || target.description, sameAs: target.name,
        }
      }
      return { name: qualified, pkg: FLUENT, kind: 'value', signature: name, description: doc?.description ?? '' }
    }
    const m = method(text)
    if (!m) return null
    return {
      name: `${prefix}.${m.name}`, pkg: FLUENT, kind: 'function',
      signature: `${m.name}(${squash(m.params)}) → ${m.returns}`,
      description: doc?.description || fromModeling(m.name),
      ...optionsOf(m.name, m.params),
    }
  }

  const namespace = (name, description, body) => {
    const entries = []
    const list = []
    for (const member of members(body)) {
      const nested = /^([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(member.text)
      if (nested) {
        const inner = member.raw.slice(member.raw.indexOf('{') + 1, member.raw.lastIndexOf('}'))
        const sub = namespace(`${name}.${nested[1]}`, member.doc?.description ?? '', inner)
        list.push({ name: nested[1], summary: firstSentence(sub[0].description) })
        entries.push(...sub)
        continue
      }
      const entry = factory(name, member)
      if (!entry) continue
      list.push({ name: entry.name.slice(name.length + 1), summary: firstSentence(entry.description) })
      entries.push(entry)
    }
    return [{ name, pkg: FLUENT, kind: 'namespace', description, members: list }, ...entries]
  }

  const jfDoc = /\/\*\*([\s\S]*?)\*\/\s*declare const jscadFluent/.exec(index)
  const entries = namespace('jf', jfDoc ? parseBlock(jfDoc[1]).description : '', bodyAfter(index, 'declare const jscadFluent: {'))

  for (const cls of CLASSES) {
    const source = read(join(distDir, 'gen', `${cls}.d.ts`))
    const head = new RegExp(`export declare class ${cls}(?:<[^>]*>)?(?: extends (\\w+)(?:<[^>]*>)?)?[^{]*\\{`).exec(source)
    const methodEntries = members(bodyAfter(source, head[0]))
      .filter(({ text }) => !/^(private|readonly|static|constructor)\b/.test(text))
      .map(({ doc, text }) => ({ doc, m: method(text) }))
      .filter(({ m }) => m)
      .map(({ doc, m }) => {
        const shared = optionsOf(m.name, m.params)
        return {
          name: `${cls}.${m.name}`, pkg: FLUENT, kind: 'function',
          signature: `${m.name}(${squash(m.params)}) → ${m.returns}`,
          description: doc?.description || fromModeling(m.name),
          ...(shared.sameAs ? shared : docOptions(doc) ?? shared),
          ...(doc?.example ? { example: doc.example } : {}),
        }
      })
    entries.push(
      {
        name: cls, pkg: FLUENT, kind: 'class',
        description: `Methods of a fluent ${cls.replace(/^Fluent/, '')}; each returns a new object, so calls chain.`,
        ...(head[1] ? { extends: head[1] } : {}),
        members: methodEntries.map((e) => ({ name: e.name.slice(cls.length + 1), summary: firstSentence(e.description) })),
      },
      ...methodEntries,
    )
  }
  return entries
}
