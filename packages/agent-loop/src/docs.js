import { firstSentence } from '../api/jsdoc.js'
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
  lines.push('Members:', ...(entry.members ?? byName.get(entry.sameAs)?.members ?? []).map(memberLine))
  const parent = entry.extends && byName.get(entry.extends)
  if (parent) lines.push(`Inherited from ${parent.name}:`, ...parent.members.map(memberLine))
  return lines.join('\n')
}

const render = (entry, byName) => (entry.members || entry.kind === 'namespace' ? renderMembers(entry, byName) : renderFunction(entry, byName))

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
    maths: 'jf.maths',
    geometries: 'jf',
    'geometries.geom2': 'FluentGeom2',
    'geometries.geom3': 'FluentGeom3',
    'geometries.path2': 'FluentPath2',
    'geometries.geom2.fromPoints': 'jf.polygon',
    'geometries.geom3.fromPoints': 'jf.polyhedron',
    'geometries.path2.fromPoints': 'jf.path',
    'geometries.geom2.reverse': 'FluentGeom2.invert',
    'geometries.geom2.isA': 'jf.isGeom2',
    'geometries.geom3.isA': 'jf.isGeom3',
    'geometries.path2.isA': 'jf.isPath2',
  },
  modeling: {
    [FLUENT]: MODELING,
    jf: 'primitives',
    'jf.colors': 'colors',
    'jf.path': 'geometries.path2.fromPoints',
    'FluentGeom2.invert': 'geometries.geom2.reverse',
    'jf.isGeom2': 'geometries.geom2.isA',
    'jf.isGeom3': 'geometries.geom3.isA',
    'jf.isPath2': 'geometries.path2.isA',
  },
}

// Names neither API has, with the reason.
const MISSING = {
  'maths.vec1': '@jscad/modeling has no vec1 functions; a vec1 is a plain number',
}

// A fluent class method and the geometries namespace of its type.
const CLASS_TYPE = { FluentGeom2: 'geom2', FluentGeom3: 'geom3', FluentPath2: 'path2' }
const TYPE_CLASS = Object.fromEntries(Object.entries(CLASS_TYPE).map(([cls, type]) => [type, cls]))

// Order among same-named fluent entries: the factory, then the 3D, 2D and
// path methods, then the array classes and the jf.maths-style helpers.
const FLUENT_RANK = ['jf.', 'FluentGeom3.', 'FluentGeom2.', 'FluentPath2.']
const fluentRank = (name) => {
  if (/^jf\.[\w$]+\./.test(name)) return FLUENT_RANK.length
  const i = FLUENT_RANK.findIndex((prefix) => name.startsWith(prefix))
  return i === -1 ? FLUENT_RANK.length : i
}
const byFluentRank = (entries) => entries.map((e, i) => ({ e, i })).sort((a, b) => fluentRank(a.e.name) - fluentRank(b.e.name) || a.i - b.i).map(({ e }) => e)

// A modeling operation (transforms.scale) before a maths or geometries helper
// of the same name, and both before jscad-text.
const modelingRank = (e) => (e.pkg !== MODELING ? 2 : e.name.split('.').length === 2 ? 0 : 1)

const packageListing = (index, pkg) => {
  const namespaces = index.filter((e) => e.pkg === pkg && e.kind === 'namespace' && !e.name.includes('.'))
  return [`${pkg} namespaces:`, ...namespaces.map((e) => `  ${e.name} - ${firstSentence(e.description)}`)].join('\n')
}

// jf.maths.vec3 names modeling's maths.vec3 instead of copying it; each of its
// functions answers under the fluent name.
const aliasEntries = (index, byName) =>
  index
    .filter((e) => e.pkg === FLUENT && e.kind === 'namespace' && e.sameAs)
    .flatMap((ns) =>
      index
        .filter((e) => e.name.startsWith(`${ns.sameAs}.`))
        .map((e) => {
          const name = `${ns.name}${e.name.slice(ns.sameAs.length)}`
          if (byName.has(name)) return null
          const { options: _options, ...rest } = e
          return { ...rest, name, pkg: FLUENT, sameAs: e.name }
        })
        .filter(Boolean),
    )

const expanded = new WeakMap()

const withAliases = (index) => {
  if (!expanded.has(index)) {
    const byName = new Map(index.map((e) => [e.name, e]))
    const all = [...index, ...aliasEntries(index, byName)]
    expanded.set(index, { all, byName: new Map(all.map((e) => [e.name, e])) })
  }
  return expanded.get(index)
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
    const sameAs = own.filter((e) => e.sameAs === entry.name)
    const named = isDirectModelingFunction(entry) ? own.filter((e) => e.kind === 'function' && lastSegment(e.name) === bare) : []
    const geometry = /^geometries\.(\w+)\.[\w$]+$/.exec(entry.name)
    const method = geometry && TYPE_CLASS[geometry[1]] ? [byName.get(`${TYPE_CLASS[geometry[1]]}.${bare}`)].filter(Boolean) : []
    return byFluentRank([...sameAs, ...named, ...method])[0] ?? null
  }
  if (entry.sameAs) return byName.get(entry.sameAs) ?? null
  const named = own.find((e) => isDirectModelingFunction(e) && lastSegment(e.name) === bare)
  if (named) return named
  const type = CLASS_TYPE[entry.name.slice(0, entry.name.indexOf('.'))]
  return (type && byName.get(`geometries.${type}.${bare}`)) || null
}

// A query that only the other API answers gets a pointer, never that API's entry.
const redirect = (byName, own, hits, query, api) => {
  const name = hits.length === 1 ? hits[0].name : query
  const target = hits.map((e) => equivalentOf(e, own, byName, api)).find(Boolean)
  if (!target) return `${name} is not available in the ${api} API.`
  return `${name} is not part of the ${api} API; the ${api} form is ${target.name}.\n\n${render(target, byName)}`
}

const rankOf = (api) => (api === 'fluent' ? (e) => fluentRank(e.name) : modelingRank)

const preferred = (hits, api) => {
  const rank = rankOf(api)
  const top = Math.min(...hits.map(rank))
  const best = hits.filter((e) => rank(e) === top)
  return best.length === 1 ? best[0] : null
}

const CLASS_OWNER = /^Fluent\w+\.[\w$]+$/
const classMethods = (own, name) => byFluentRank(own.filter((e) => e.kind === 'function' && lastSegment(e.name) === name && CLASS_OWNER.test(e.name)))

// jf.rotateX is a method, and FluentGeom3.extrudeLinear lives on FluentGeom2.
const misplacedMethod = (own, byName, q) => {
  const dot = q.lastIndexOf('.')
  if (dot === -1) return null
  const owner = q.slice(0, dot)
  const name = q.slice(dot + 1)
  if (owner !== 'jf' && byName.get(owner)?.kind !== 'class') return null
  const methods = classMethods(own, name)
  if (!methods.length) return null
  const head = owner === 'jf'
    ? `${q} is a method, not a jf function: call shape.${name}(...).`
    : `${owner} has no ${name}; it is a method of ${methods.map((e) => e.name.slice(0, e.name.indexOf('.'))).join(', ')}.`
  return `${head}\n\n${render(methods[0], byName)}`
}

const MAX_PREFIX = 12

// FluentGeom lists FluentGeom2, FluentGeom3, ...: names one segment past the query.
const prefixed = (own, q) => own.filter((e) => e.name.startsWith(q) && e.name.length > q.length && !e.name.slice(q.length).includes('.'))

const missing = (q, api) => {
  const key = q.startsWith('jf.') ? q.slice(3) : q
  return MISSING[key] ? `${q} is not available in the ${api} API: ${MISSING[key]}.` : null
}

/**
 * @param {Array<object>} index api/index.json
 * @param {string} query
 * @param {{api?:'fluent'|'modeling'}} [options] the API to answer from; @jscadui/jscad-text is in both
 */
export const lookupDocs = (index, query, { api = DEFAULT_API } = {}) => {
  checkApi(api)
  // "primitives.cylinderElliptic startRadius" looks up its first word.
  const q = typeof query === 'string' ? query.trim().split(/\s+/)[0] : ''
  if (!q) return { ok: false, error: { name: 'QueryError', message: 'docs needs a query: a function, class or namespace name' } }
  const { all, byName } = withAliases(index)
  const ownPackage = API_PACKAGE[api]
  const own = all.filter((e) => e.pkg === ownPackage || e.pkg === TEXT)
  const other = all.filter((e) => e.pkg === API_PACKAGE[OTHER[api]])

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

  const moved = api === 'fluent' && misplacedMethod(own, byName, q)
  if (moved) return { ok: true, text: cap(moved) }
  const elsewhere = matches(other, q)
  if (elsewhere.length) return { ok: true, text: cap(redirect(byName, own, elsewhere, q, api)) }
  const reason = missing(q, api)
  if (reason) return { ok: true, text: reason }
  const starts = prefixed(own, q)
  if (starts.length === 1) return { ok: true, text: cap(render(starts[0], byName)) }
  if (starts.length) return { ok: true, text: cap(`${q} matches several entries; query one of: ${starts.slice(0, MAX_PREFIX).map((e) => e.name).join(', ')}`) }
  return { ok: false, error: { name: 'NotFoundError', message: `no entry ${q}; closest: ${closest(own, q).join(', ')}` } }
}

export const docsTool = (index, query, options) => {
  const result = lookupDocs(index, query, options)
  return result.ok ? result.text : JSON.stringify(result)
}
