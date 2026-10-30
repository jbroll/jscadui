// Resolves a `view` spec's look-at aim to the [x, y, z] point the camera
// frames: a raw point, a part index or index range (as measure and check number
// the array main() returns) turned into that selection's bounding-box center,
// or a hierarchical part name turned into that part's anchor-frame origin. The
// caller injects the build's frames (a `Map<string, [x, y, z]>` from
// `measure({anchors: true})`), its part count and the measured index centers,
// so this module never touches geometry, the worker, the app or the eval.
//
// A part name resolves through auto-attached anchors (see the view design's
// Provenance section); the name-to-index mapping through proxyState.types was
// disproven on the real hierarchical car and is not used. Name matching is
// model-tools' (exact dotted path, else a unique whole-segment suffix), the
// same rule measure applies, so a name one tool takes the other takes too.

import { isIndexSelector, matchPartName, partRefForms } from '@jscadui/model-tools/src/partRefs.js'

// Named errors, as the view request spec's violations are (viewSpec.js). The name is repeated in the message so
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

const notFound = (part, ctx) =>
  named(
    'PartNotFoundError',
    `no part ${JSON.stringify(part)} in this build; lookAt takes ${partRefForms(ctx.partCount ?? 0, asFrameMap(ctx.anchorFrames).keys())}, or an [x, y, z] point`,
  )

const ambiguous = (name, matches) =>
  named(
    'AmbiguousPartError',
    `${JSON.stringify(name)} matches ${matches.length} parts (${matches.join(', ')}); name the full dotted path`,
  )

const asFrameMap = (anchorFrames) => {
  if (anchorFrames instanceof Map) return anchorFrames
  return new Map(Object.entries(anchorFrames || {}))
}

/**
 * Whether an index aim names parts the build has; a range is in range when its
 * last index is. Throws the not-found error listing the forms a lookAt takes.
 * @param {string} part an index selector such as "3" or "1-3"
 * @param {{partCount?: number, anchorFrames?: Map<string, [number, number, number]> | Object}} ctx
 */
export const checkPartIndex = (part, ctx) => {
  const [from, to = from] = part.split('-').map(Number)
  if (from > to || to >= (ctx.partCount ?? 0)) throw notFound(part, ctx)
}

// The origin of the one frame the name picks, or the ambiguity/not-found error.
const frameOrigin = (part, ctx) => {
  const frames = asFrameMap(ctx.anchorFrames)
  const matches = matchPartName(part, frames.keys())
  if (matches.length > 1) throw ambiguous(part, matches)
  if (matches.length === 0) throw notFound(part, ctx)
  return triple(frames.get(matches[0]), `the anchor for ${JSON.stringify(matches[0])}`)
}

/**
 * The [x, y, z] point a look-at aim frames.
 *
 * A `{kind: 'lookAt', point}` spec returns its point after finite-number
 * validation. A `{kind: 'lookAtPart', part}` spec that is an index or range
 * returns `ctx.partCenters`' center for it; any other part is a name resolved
 * against `ctx.anchorFrames` to that frame's origin.
 * @param {{kind: string, point?: unknown, part?: string}} spec a normalized ViewSpec
 * @param {{
 *   anchorFrames?: Map<string, [number, number, number]> | Object,
 *   partCount?: number,
 *   partCenters?: Map<string, [number, number, number]>,
 * }} ctx the build's part-name -> origin frames, part count and index-selector -> center
 * @returns {[number, number, number]}
 * @throws {Error} a named `ArgumentsError`, `PartNotFoundError` or `AmbiguousPartError`
 */
export const resolveLookAt = (spec, ctx = {}) => {
  if (!isPlainObject(spec)) throw named('ArgumentsError', 'a look-at spec must be an object with kind lookAt or lookAtPart')
  if (spec.kind === 'lookAt') return triple(spec.point, 'lookAt point')
  if (spec.kind !== 'lookAtPart') {
    throw named('ArgumentsError', `resolveLookAt got a ${JSON.stringify(spec.kind)} spec; it resolves lookAt and lookAtPart aims only`)
  }
  if (!isIndexSelector(spec.part)) return frameOrigin(spec.part, ctx)
  checkPartIndex(spec.part, ctx)
  return triple(ctx.partCenters?.get(spec.part), `the center of part ${spec.part}`)
}
