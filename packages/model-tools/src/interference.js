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
  if (!object || typeof object !== 'object' || typeof object.reason !== 'string' || object.reason === '') {
    return fail('reference needs a reason')
  }
  const { reason, allow } = object
  if (allow === undefined) return { reason, allowed: new Set() }
  const asSelector = (s) => (Number.isInteger(s) && s >= 0 ? String(s) : s)
  if (!Array.isArray(allow) || !allow.every((s) => typeof asSelector(s) === 'string')) {
    return fail('allow must be a list of part selectors')
  }
  const allowed = new Set()
  for (const selector of allow) {
    try {
      partIndexes(items, asSelector(selector)).forEach((i) => allowed.add(i))
    } catch (err) {
      return fail(`allow ${selector}: ${err.message}`)
    }
  }
  if (allowed.has(index)) return fail('reference allows itself')
  return { reason, allow, allowed }
}

export const interference = (items, { now = () => performance.now() } = {}) => {
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
  const overlapsOf = new Map([...tags.keys()].map((i) => [i, []]))
  const found = []
  let unchecked = 0

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
      unchecked++
      return
    }
    // A boolean can reject a part (Manifold throws on a non-manifold import);
    // that pair goes unchecked rather than failing the whole check.
    let shared, volume
    try {
      shared = intersect(parts[a], parts[b])
      volume = measurements.measureVolume(shared)
    } catch {
      unchecked++
      return
    }
    if (!(volume > INTERFERENCE_EPSILON)) return
    const allowedBy = [a, b].filter((i) => tags.get(i)?.allowed.has(i === a ? b : a))
    if (allowedBy.length === 0) {
      found.push({ a: String(a), b: String(b), volume, size: measurements.measureDimensions(shared).map(round4) })
    }
    for (const i of allowedBy) overlapsOf.get(i).push({ part: String(i === a ? b : a), volume })
  })
  for (const overlaps of overlapsOf.values()) overlaps.sort((x, y) => y.volume - x.volume)

  found.sort((x, y) => y.volume - x.volume)
  const references = [...tags].map(([index, { reason, allow }]) => ({
    part: String(index),
    reason,
    ...(allow ? { allow } : {}),
    overlaps: overlapsOf.get(index),
  }))
  return {
    ...(found.length ? { interference: { pairs: found.slice(0, MAX_PAIRS), total: found.length } } : {}),
    ...(references.length ? { references } : {}),
    ...(tagErrors.length ? { tagErrors } : {}),
    ...(unchecked ? { interferenceUnchecked: unchecked } : {}),
  }
}
