import jscad from '@jscad/modeling'
import { partIndexes } from './measure.js'

const { booleans, geometries, measurements } = jscad

export const INTERFERENCE_EPSILON = 0.001
export const MAX_INTERSECTIONS = 300
// One plain-jscad intersection of two 8192-polygon spheres takes about 2.3 s.
export const INTERFERENCE_BUDGET_MS = 5000
const MAX_PAIRS = 20

const round4 = (n) => Math.round(n * 1e4) / 1e4 + 0
const isGeom3 = (g) => !!g && typeof g === 'object' && 'polygons' in g
const isGeometry = (g) => isGeom3(g) || (!!g && typeof g === 'object' && 'sides' in g)
const solid = (g) => (geometries.geom3.isA(g) ? g : geometries.geom3.create(g.polygons))

// In the app frame '@jscad/modeling' is the lazy model tree: intersect returns
// a node, which the bundle's sync evaluator resolves to geometry.
const intersect = (a, b) => {
  const shared = booleans.intersect(a, b)
  return shared?.isTreeNode ? jscad.evaluateSync(shared).solids[0] : shared
}

const boxesOverlap = ([aLo, aHi], [bLo, bHi]) => [0, 1, 2].every((k) => aLo[k] < bHi[k] && bLo[k] < aHi[k])
const boxOverlapVolume = ([aLo, aHi], [bLo, bHi]) =>
  [0, 1, 2].reduce((v, k) => v * (Math.min(aHi[k], bHi[k]) - Math.max(aLo[k], bLo[k])), 1)

// Returns { reason, allow? (as written), allowed: Set<number> } or { error }.
const readTag = (tag, items, index) => {
  const fail = (message) => ({ error: `part ${index}: ${message}` })
  const object = typeof tag === 'string' ? { reason: tag } : tag
  if (!object || typeof object !== 'object' || typeof object.reason !== 'string' || object.reason.trim() === '') {
    return fail('reference needs a reason')
  }
  const { reason, allow } = object
  if (allow === undefined) return { reason, allowed: new Set(), selectors: [] }
  const asSelector = (s) => (Number.isInteger(s) && s >= 0 ? String(s) : s)
  if (!Array.isArray(allow) || !allow.every((s) => typeof asSelector(s) === 'string')) {
    return fail('allow must be a list of part selectors')
  }
  const allowed = new Set()
  const selectors = []
  for (const selector of allow) {
    try {
      const indexes = partIndexes(items, asSelector(selector))
      indexes.forEach((i) => allowed.add(i))
      selectors.push({ selector, indexes })
    } catch (err) {
      return fail(`allow ${selector}: ${err.message}`)
    }
  }
  if (allowed.has(index)) return fail('reference allows itself')
  return { reason, allow, allowed, selectors }
}

// Every pair of solids sharing more than INTERFERENCE_EPSILON, allowed or not.
// `allowedBy` lists the reference parts whose tag allows the pair.
export const sharedPairs = (items, { now = () => performance.now() } = {}) => {
  const tagErrors = []
  const tags = new Map()
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || item.previewOnly) return
    if (item.reference === undefined || item.reference === null || item.reference === false) return
    const tag = readTag(item.reference, items, index)
    if (tag.error) tagErrors.push(tag.error)
    else if (isGeometry(item)) tags.set(index, tag)
  })

  const parts = items.map((item) => (isGeom3(item) && !item.previewOnly ? solid(item) : null))
  const boxes = parts.map((g) => (g ? measurements.measureBoundingBox(g) : null))
  const shared = []
  const uncheckedPairs = []

  const candidates = []
  for (let a = 0; a < parts.length; a++) {
    if (!parts[a]) continue
    for (let b = a + 1; b < parts.length; b++) {
      if (parts[b] && boxesOverlap(boxes[a], boxes[b])) candidates.push({ a, b, boxOverlap: boxOverlapVolume(boxes[a], boxes[b]) })
    }
  }
  // The likely offenders first, so the cap and the budget leave out the small ones.
  candidates.sort((x, y) => y.boxOverlap - x.boxOverlap)

  const start = now()
  candidates.forEach(({ a, b }, n) => {
    if (n >= MAX_INTERSECTIONS || now() - start >= INTERFERENCE_BUDGET_MS) {
      uncheckedPairs.push([a, b])
      return
    }
    // A boolean can reject a part (Manifold throws on a non-manifold import);
    // that pair goes unchecked rather than failing the whole check.
    let common, volume
    try {
      common = intersect(parts[a], parts[b])
      volume = measurements.measureVolume(common)
    } catch {
      uncheckedPairs.push([a, b])
      return
    }
    if (!(volume > INTERFERENCE_EPSILON)) return
    shared.push({
      a,
      b,
      volume: round4(volume),
      size: measurements.measureDimensions(common).map(round4),
      allowedBy: [a, b].filter((i) => tags.get(i)?.allowed.has(i === a ? b : a)),
    })
  })

  // An exemption must name a real overlap. A pair left unchecked is no evidence either way.
  const touching = (i) => (j) =>
    shared.some((s) => (s.a === i && s.b === j) || (s.a === j && s.b === i)) ||
    uncheckedPairs.some(([a, b]) => (a === i && b === j) || (a === j && b === i))
  for (const [index, { selectors }] of tags) {
    for (const { selector, indexes } of selectors) {
      if (!indexes.some(touching(index))) tagErrors.push(`part ${index}: allow ${selector} shares no volume with it; remove it from allow`)
    }
  }
  return { shared, tags, tagErrors, unchecked: uncheckedPairs.length }
}

export const interference = (items, options) => {
  const { shared, tags, tagErrors, unchecked } = sharedPairs(items, options)
  const overlapsOf = new Map([...tags.keys()].map((i) => [i, []]))
  const found = []
  for (const { a, b, volume, size, allowedBy } of shared) {
    if (allowedBy.length === 0) found.push({ a: String(a), b: String(b), volume, size })
    for (const i of allowedBy) overlapsOf.get(i).push({ part: String(i === a ? b : a), volume })
  }
  for (const overlaps of overlapsOf.values()) overlaps.sort((x, y) => y.volume - x.volume)

  found.sort((x, y) => y.volume - x.volume)
  const references = [...tags].map(([index, { reason, allow }]) => ({
    part: String(index),
    reason,
    ...(allow ? { allow } : {}),
    overlaps: overlapsOf.get(index),
  }))
  return {
    ...(found.length ? { interference: { pairs: found.slice(0, MAX_PAIRS), total: found.length, volume: round4(found.reduce((sum, p) => sum + p.volume, 0)) } } : {}),
    ...(references.length ? { references } : {}),
    ...(tagErrors.length ? { tagErrors } : {}),
    ...(unchecked ? { interferenceUnchecked: unchecked } : {}),
  }
}
