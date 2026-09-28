import { editDistance } from './editDistance.js'

export const MAX_ANSWER = 3000
const TRUNCATED = '\n[truncated: query a qualified name for less]'

const cap = (text) => (text.length <= MAX_ANSWER ? text : text.slice(0, MAX_ANSWER - TRUNCATED.length) + TRUNCATED)
const lastSegment = (name) => name.slice(name.lastIndexOf('.') + 1)

const optionLine = (o) =>
  `  ${o.name}${o.type ? `: ${o.type}` : ''}${o.default != null ? ` = ${o.default}` : ''}${o.description ? ` - ${o.description}` : ''}`

const memberLine = (m) => `  ${m.name}${m.summary ? ` - ${m.summary}` : ''}`

const renderFunction = (entry, byName) => {
  const lines = [`${entry.name} (${entry.pkg})`, entry.signature]
  if (entry.description) lines.push(entry.description)
  const source = entry.sameAs ? byName.get(entry.sameAs) : entry
  if (entry.sameAs) lines.push(`Same options as ${entry.sameAs}.`)
  if (source?.options?.length) lines.push('Options:', ...source.options.map(optionLine))
  if (entry.example) lines.push('Example:', ...entry.example.split('\n').map((l) => `  ${l}`))
  return lines.join('\n')
}

const renderMembers = (entry, byName) => {
  const lines = [`${entry.name} (${entry.pkg}) ${entry.kind}`]
  if (entry.description) lines.push(entry.description)
  lines.push('Members:', ...entry.members.map(memberLine))
  const parent = entry.extends && byName.get(entry.extends)
  if (parent) lines.push(`Inherited from ${parent.name}:`, ...parent.members.map(memberLine))
  return lines.join('\n')
}

const render = (entry, byName) => (entry.members ? renderMembers(entry, byName) : renderFunction(entry, byName))

// FluentGeom3Array.translate lives on FluentGeometryArray.
const inherited = (index, query) => {
  const dot = query.lastIndexOf('.')
  const owner = dot === -1 ? null : index.find((e) => e.name === query.slice(0, dot) && e.extends)
  return owner ? index.filter((e) => e.name === `${owner.extends}.${query.slice(dot + 1)}`) : []
}

const matches = (index, query) => {
  const exact = index.filter((e) => e.name === query)
  if (exact.length) return exact
  const parent = inherited(index, query)
  if (parent.length) return parent
  const suffix = index.filter((e) => e.name.endsWith(`.${query}`))
  if (suffix.length) return suffix
  const lower = query.toLowerCase()
  return index.filter((e) => e.name.toLowerCase() === lower || e.name.toLowerCase().endsWith(`.${lower}`))
}

const closest = (index, query) => {
  const q = query.toLowerCase()
  return index
    .map((e, i) => ({ name: e.name, i, d: Math.min(editDistance(q, e.name.toLowerCase()), editDistance(q, lastSegment(e.name).toLowerCase())) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, 3)
    .map((c) => c.name)
}

export const lookupDocs = (index, query) => {
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) return { ok: false, error: { name: 'QueryError', message: 'docs needs a query: a function, class or namespace name' } }
  const hits = matches(index, q)
  if (!hits.length) return { ok: false, error: { name: 'NotFoundError', message: `no entry ${q}; closest: ${closest(index, q).join(', ')}` } }
  const byName = new Map(index.map((e) => [e.name, e]))
  if (hits.length === 1) return { ok: true, text: cap(render(hits[0], byName)) }
  const modeling = hits.filter((e) => e.pkg === '@jscad/modeling')
  if (modeling.length === 1) {
    const others = hits.filter((e) => e !== modeling[0]).map((e) => e.name)
    return { ok: true, text: cap(`${render(modeling[0], byName)}\nAlso: ${others.join(', ')}`) }
  }
  return { ok: true, text: cap(`${q} matches several entries; query one of: ${hits.map((e) => e.name).join(', ')}`) }
}

export const docsTool = (index, query) => {
  const result = lookupDocs(index, query)
  return result.ok ? result.text : JSON.stringify(result)
}
