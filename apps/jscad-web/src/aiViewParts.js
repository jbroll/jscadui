// Resolves a `view` spec's look-at aim to the [x, y, z] point the camera
// frames: a raw point, or a hierarchical part name turned into that part's
// anchor-frame origin. The frames are injected as a `Map<string, [x, y, z]>`
// the caller builds from a build's `measure({anchors: true})` result, so this
// module never touches geometry, the worker or the app.
//
// A part-name aim resolves through auto-attached anchors (see the view design's
// Provenance section): the build stamps each part-path on the primitive it
// creates, and the frames survive booleans and transforms. An index mapping was
// disproven on the real hierarchical car (11 typed paths vs 13 geometry items)
// and is not used.
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
    `${JSON.stringify(name)} matches ${matches.length} parts (${matches.join(', ')}); name the full dotted path`,
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

const asFrameMap = (anchorFrames) => {
  if (anchorFrames instanceof Map) return anchorFrames
  return new Map(Object.entries(anchorFrames || {}))
}

// The origin of the one frame the name picks, or the ambiguity/not-found error.
const frameOrigin = (part, anchorFrames) => {
  const nameSegments = segmentsOf(part)
  if (!nameSegments) throw notFound(part)
  const frames = asFrameMap(anchorFrames)
  if (frames.has(part)) return triple(frames.get(part), `the anchor for ${JSON.stringify(part)}`)
  const partial = [...frames.keys()].filter((name) => typeof name === 'string' && endsWithSegments(name, nameSegments))
  if (partial.length > 1) throw ambiguous(part, partial)
  if (partial.length === 1) return triple(frames.get(partial[0]), `the anchor for ${JSON.stringify(partial[0])}`)
  throw notFound(part)
}

/**
 * The [x, y, z] point a look-at aim frames.
 *
 * A `{kind: 'lookAt', point}` spec returns its point after finite-number
 * validation; a `{kind: 'lookAtPart', part}` spec resolves the name against
 * `ctx.anchorFrames` and returns that frame's origin.
 * @param {{kind: string, point?: unknown, part?: string}} spec a normalized ViewSpec
 * @param {{anchorFrames?: Map<string, [number, number, number]> | Object}} ctx the build's part-name -> origin frames
 * @returns {[number, number, number]}
 * @throws {Error} a named `ArgumentsError`, `PartNotFoundError` or `AmbiguousPartError`
 */
export const resolveLookAt = (spec, ctx = {}) => {
  if (!isPlainObject(spec)) throw named('ArgumentsError', 'a look-at spec must be an object with kind lookAt or lookAtPart')
  if (spec.kind === 'lookAt') return triple(spec.point, 'lookAt point')
  if (spec.kind !== 'lookAtPart') {
    throw named('ArgumentsError', `resolveLookAt got a ${JSON.stringify(spec.kind)} spec; it resolves lookAt and lookAtPart aims only`)
  }
  return frameOrigin(spec.part, ctx.anchorFrames)
}
