// Resolves a `view` spec's look-at aim to the [x, y, z] point the camera
// frames: a raw point, or a hierarchical part name turned into that part's
// measured center. The part index map and the measurement call are injected,
// so this module never touches geometry, the worker or the app: the caller
// builds `partPaths` from `proxyState` plus the build's geometry order and
// supplies `measurePart(index) -> [x, y, z]`.
//
// No caller supplies that provenance today: a build reports neither which
// geometry item belongs to which typed part path nor any name for its items, so
// the app refuses a part-name aim outright (`src/aiView.js`) and drives only the
// point form. The part branch stays the agreed resolution contract, ready for a
// build that names its own geometry.
//
// Matching never guesses. An exact dotted-path match wins; failing that, only
// whole dot-separated segment suffixes match (`left` for `front.left`), and
// more than one of those is ambiguous. Character-level substring matching is
// never done, so `left` does not match `front.leftover`. A name that cannot be
// a path at all (empty segments, `/`, `..`) reads as not found rather than
// matching something surprising.

// Named errors, as the view request spec's violations are
// (packages/agent-loop/src/viewSpec.js). The name is repeated in the message so
// a tool result reads `PartNotFoundError: ...` and message-matching callers see
// the name too.
const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Three finite numbers, copied so the result never aliases the caller's array —
// the same rule the request spec applies to the points it accepts.
const triple = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw named('ArgumentsError', `${label} must be three finite numbers [x, y, z]`)
  }
  return [value[0], value[1], value[2]]
}

const notFound = (part) =>
  named('PartNotFoundError', `no part named ${JSON.stringify(part)}; name a dotted param path such as front.left`)

const ambiguous = (name, matches) =>
  named(
    'AmbiguousPartError',
    `${JSON.stringify(name)} matches ${matches.length} parts (${matches.map((match) => match.path).join(', ')}); name the full dotted path`,
  )

// The dot-separated segments of a typed name, or null when it cannot name a
// part: the empty string, empty segments, `/` and `..` are all rejected here.
const segmentsOf = (name) => {
  if (typeof name !== 'string' || name === '' || name.includes('/')) return null
  const segments = name.split('.')
  return segments.every((segment) => segment !== '' && segment !== '..') ? segments : null
}

// Whole-segment suffix match, so `left` names the `left` child of `front` but
// `front.leftover` is not a match.
const endsWithSegments = (path, nameSegments) => {
  const pathSegments = path.split('.')
  if (nameSegments.length > pathSegments.length) return false
  const offset = pathSegments.length - nameSegments.length
  return nameSegments.every((segment, i) => pathSegments[offset + i] === segment)
}

// The index of the one part the name picks, or the ambiguity/not-found error.
const partIndex = (part, partPaths) => {
  const nameSegments = segmentsOf(part)
  if (!nameSegments) throw notFound(part)
  const parts = Array.isArray(partPaths) ? partPaths : []
  const exact = parts.filter((entry) => entry?.path === part)
  if (exact.length > 1) throw ambiguous(part, exact)
  if (exact.length === 1) return exact[0].index
  const partial = parts.filter((entry) => typeof entry?.path === 'string' && endsWithSegments(entry.path, nameSegments))
  if (partial.length > 1) throw ambiguous(part, partial)
  if (partial.length === 1) return partial[0].index
  throw notFound(part)
}

/**
 * The [x, y, z] point a look-at aim frames.
 *
 * A `{kind: 'lookAt', point}` spec returns its point after finite-number
 * validation; a `{kind: 'lookAtPart', part}` spec resolves the name against
 * `ctx.partPaths` and returns `ctx.measurePart(index)`.
 * @param {{kind: string, point?: unknown, part?: string}} spec a normalized ViewSpec
 * @param {{partPaths?: Array<{path: string, index: number}>, measurePart: (index: number) => [number, number, number]}} ctx
 * @returns {Promise<[number, number, number]>}
 * @throws {Error} a named `ArgumentsError`, `PartNotFoundError` or `AmbiguousPartError`
 */
export const resolveLookAt = async (spec, ctx = {}) => {
  if (!isPlainObject(spec)) throw named('ArgumentsError', 'a look-at spec must be an object with kind lookAt or lookAtPart')
  if (spec.kind === 'lookAt') return triple(spec.point, 'lookAt point')
  if (spec.kind !== 'lookAtPart') {
    throw named('ArgumentsError', `resolveLookAt got a ${JSON.stringify(spec.kind)} spec; it resolves lookAt and lookAtPart aims only`)
  }
  return ctx.measurePart(partIndex(spec.part, ctx.partPaths))
}
