import { checkApi, DEFAULT_API } from './api.js'
import { editDistance } from './editDistance.js'

export const MAX_ANSWER = 3000
const TRUNCATED = '\n[truncated: query a qualified name for less]'

const cap = (text) => (text.length <= MAX_ANSWER ? text : text.slice(0, MAX_ANSWER - TRUNCATED.length) + TRUNCATED)
const lastSegment = (name) => name.slice(name.lastIndexOf('.') + 1)

const optionLine = (o) =>
  `  ${o.name}${o.type ? `: ${o.type}` : ''}${o.default != null ? ` = ${o.default}` : ''}${o.description ? ` - ${o.description}` : ''}`

const memberLine = (m) => `  ${m.name}${m.summary ? ` - ${m.summary}` : ''}`

// A fluent entry borrows a modeling function's options through sameAs; the
// answer lists them without naming the modeling function.
const renderFunction = (entry, byName) => {
  const lines = [`${entry.name} (${entry.pkg})`, entry.signature]
  if (entry.description) lines.push(entry.description)
  const source = entry.sameAs ? byName.get(entry.sameAs) : entry
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

const FLUENT = '@jbroll/jscad-fluent'
const MODELING = '@jscad/modeling'
const TEXT = '@jscadui/jscad-text'
const API_PACKAGE = { fluent: FLUENT, modeling: MODELING }
const OTHER = { fluent: 'modeling', modeling: 'fluent' }

// A query equal to a package name resolves to that package's top entry, or
// (for @jscad/modeling, which has no single top entry) a namespace listing.
const PACKAGE_TOP = { [FLUENT]: 'jf', [TEXT]: 'jscadText' }

// Where a name has no same-named or sameAs counterpart in the other API.
const EQUIVALENT = {
  fluent: {
    [MODELING]: 'jf',
    primitives: 'jf',
    colors: 'jf.colors',
    booleans: 'FluentGeom3',
    transforms: 'FluentGeom3',
    hulls: 'FluentGeom3',
    expansions: 'FluentGeom3',
    measurements: 'FluentGeom3',
    extrusions: 'FluentGeom2',
    'minkowski.minkowskiSum': 'FluentGeom3.minkowski',
    text: 'jscadText',
    'text.vectorText': 'jscadText.text2d',
  },
  modeling: { [FLUENT]: MODELING, jf: 'primitives', 'jf.colors': 'colors' },
}

// The one modeling function a fluent model may import: fluent has no helical
// extrusion, and threads and springs need one.
const FLUENT_EXCEPTIONS = {
  'extrusions.extrudeHelical': (name) =>
    `${name} is not part of the fluent API, and fluent has no helical extrusion. It is the one @jscad/modeling function a fluent model may use: ` +
    "`const { extrudeHelical } = require('@jscad/modeling').extrusions`, then `new jf.FluentGeom3(extrudeHelical(options, outline))` to chain on the result.",
}

// Order among same-named fluent entries: the factory, then the 3D, 2D and
// path methods, then the array classes.
const FLUENT_RANK = ['jf.', 'FluentGeom3.', 'FluentGeom2.', 'FluentPath2.']
const fluentRank = (name) => {
  const i = FLUENT_RANK.findIndex((prefix) => name.startsWith(prefix))
  return i === -1 ? FLUENT_RANK.length : i
}
const byFluentRank = (entries) => entries.map((e, i) => ({ e, i })).sort((a, b) => fluentRank(a.e.name) - fluentRank(b.e.name) || a.i - b.i).map(({ e }) => e)

const packageListing = (index, pkg) => {
  const namespaces = index.filter((e) => e.pkg === pkg && e.kind === 'namespace' && !e.name.includes('.'))
  return [`${pkg} namespaces:`, ...namespaces.map((e) => `  ${e.name} - ${e.description}`)].join('\n')
}

const packageAnswer = (index, byName, pkg) => {
  if (pkg === MODELING) return packageListing(index, pkg)
  return render(byName.get(PACKAGE_TOP[pkg]), byName)
}

const isDirectModelingFunction = (e) => e.pkg === MODELING && e.kind === 'function' && e.name.split('.').length === 2

// The entry in `api` that does what `entry` (from the other API) does.
const equivalentOf = (entry, own, byName, api) => {
  const mapped = EQUIVALENT[api][entry.name]
  if (mapped) return byName.get(mapped) ?? null
  const bare = lastSegment(entry.name)
  if (api === 'fluent') {
    if (!isDirectModelingFunction(entry)) return null
    const sameAs = own.filter((e) => e.sameAs === entry.name)
    const named = own.filter((e) => e.kind === 'function' && lastSegment(e.name) === bare)
    return byFluentRank([...sameAs, ...named])[0] ?? null
  }
  if (entry.sameAs) return byName.get(entry.sameAs) ?? null
  return own.find((e) => isDirectModelingFunction(e) && lastSegment(e.name) === bare) ?? null
}

// A query that only the other API answers gets a pointer, never that API's entry.
const redirect = (byName, own, hits, query, api) => {
  const name = hits.length === 1 ? hits[0].name : query
  if (api === 'fluent' && FLUENT_EXCEPTIONS[name]) return `${FLUENT_EXCEPTIONS[name](name)}\n\n${render(byName.get(name), byName)}`
  const target = hits.map((e) => equivalentOf(e, own, byName, api)).find(Boolean)
  if (!target) return `${name} is not available in the ${api} API.`
  return `${name} is not part of the ${api} API; the ${api} form is ${target.name}.\n\n${render(target, byName)}`
}

const preferred = (hits, api) => {
  if (api === 'fluent') {
    const ranked = byFluentRank(hits)
    const best = ranked.filter((e) => fluentRank(e.name) === fluentRank(ranked[0].name))
    return best.length === 1 ? best[0] : null
  }
  const modeling = hits.filter((e) => e.pkg === MODELING)
  return modeling.length === 1 ? modeling[0] : null
}

/**
 * @param {Array<object>} index api/index.json
 * @param {string} query
 * @param {{api?:'fluent'|'modeling'}} [options] the API to answer from; @jscadui/jscad-text is in both
 */
export const lookupDocs = (index, query, { api = DEFAULT_API } = {}) => {
  checkApi(api)
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) return { ok: false, error: { name: 'QueryError', message: 'docs needs a query: a function, class or namespace name' } }
  const byName = new Map(index.map((e) => [e.name, e]))
  const ownPackage = API_PACKAGE[api]
  const own = index.filter((e) => e.pkg === ownPackage || e.pkg === TEXT)
  const other = index.filter((e) => e.pkg === API_PACKAGE[OTHER[api]])

  if (q === ownPackage || q === TEXT) return { ok: true, text: cap(packageAnswer(index, byName, q)) }
  if (q === API_PACKAGE[OTHER[api]]) {
    const target = EQUIVALENT[api][q]
    const answer = target === MODELING ? packageListing(index, MODELING) : render(byName.get(target), byName)
    return { ok: true, text: cap(`${q} is not part of the ${api} API; the ${api} form is ${target}.\n\n${answer}`) }
  }

  const hits = matches(own, q)
  if (hits.length === 1) return { ok: true, text: cap(render(hits[0], byName)) }
  if (hits.length > 1) {
    const best = preferred(hits, api)
    if (best) {
      const others = hits.filter((e) => e !== best).map((e) => e.name)
      return { ok: true, text: cap(`${render(best, byName)}\nAlso: ${others.join(', ')}`) }
    }
    return { ok: true, text: cap(`${q} matches several entries; query one of: ${hits.map((e) => e.name).join(', ')}`) }
  }

  const elsewhere = matches(other, q)
  if (elsewhere.length) return { ok: true, text: cap(redirect(byName, own, elsewhere, q, api)) }
  return { ok: false, error: { name: 'NotFoundError', message: `no entry ${q}; closest: ${closest(own, q).join(', ')}` } }
}

export const docsTool = (index, query, options) => {
  const result = lookupDocs(index, query, options)
  return result.ok ? result.text : JSON.stringify(result)
}
