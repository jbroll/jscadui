import { anchors } from './anchors.js'
import { measureArray, wrapOne } from './array-geom.js'
import { axisRelation, symmetryAxis } from './axis.js'
import { INSIDE_OUT_NOTE, isInsideOut } from './check.js'
import { sectionOutline } from './section.js'

export const measureGeom = (geom, geomType) => {
  if (geomType === 'array') return measureArray(geom)
  const out = {
    boundingBox: geom.measureBoundingBox(),
    dimensions: geom.measureDimensions(),
    center: geom.measureCenter(),
  }
  if (geomType === 'geom3') {
    out.volume = geom.measureVolume()
    out.polygonCount = geom.toPolygons().length
    if (isInsideOut(out.volume, out.dimensions)) {
      out.insideOut = true
      out.notes = [INSIDE_OUT_NOTE]
    }
  } else if (geomType === 'geom2') {
    out.area = geom.measureArea()
    out.polygonCount = geom.toOutlines().length
  }
  return out
}

const classify = (g) => {
  if (g && typeof g === 'object' && 'polygons' in g) return 'geom3'
  if (g && typeof g === 'object' && 'sides' in g) return 'geom2'
  return 'unknown'
}

// Index the array as the model returns it, the same items `check` numbers.
const itemsOf = (geom, geomType) => (geomType === 'array' ? geom : [geom])

const SELECTOR_FORMAT = /^\d+(-\d+)?$/

export const selectorRange = (selector, length) => {
  if (typeof selector !== 'string' || !SELECTOR_FORMAT.test(selector)) {
    throw new Error(
      `part ${JSON.stringify(selector)} must be an index like "0" or a range like "1-3" — parts are indexes into the array main() returns`,
    )
  }
  const [from, to = from] = selector.split('-').map(Number)
  if (to >= length) {
    const count = `${length} item${length === 1 ? '' : 's'}`
    throw new Error(`part ${selector} is out of range; the model has ${count} (0-${length - 1})`)
  }
  return [from, to]
}

const selectItems = (items, selector) => {
  const [from, to] = selectorRange(selector, items.length)
  const picked = items.slice(from, to + 1).flat(Infinity)
  const bad = picked.find((g) => classify(g) === 'unknown')
  if (bad !== undefined)
    throw new Error(`part ${selector} includes an item that is not a geom2 or geom3`)
  return picked
}

const measureSelection = (items, selector) => {
  const picked = selectItems(items, selector)
  if (picked.length !== 1) return measureArray(picked)
  return measureGeom(wrapOne(picked[0]), classify(picked[0]))
}

// `selectors` is "all" or a list of "N" and "N-M" strings.
export const measureParts = (geom, geomType, selectors) => {
  const items = itemsOf(geom, geomType)
  const list = selectors === 'all' ? items.map((_, i) => String(i)) : selectors
  return list.map((part) => ({ part, ...measureSelection(items, part) }))
}

const roundMicron = (n) => Math.round(n * 1e6) / 1e6 + 0

const roundFrame = ({ origin, z, x }) => ({
  origin: origin.map(roundMicron),
  z: z.map(roundMicron),
  x: x.map(roundMicron),
})

const anchorsOf = (item, i) => {
  try {
    return anchors(item)
  } catch (err) {
    throw new Error(`part ${i}: ${err.message.replace(/^anchors: /, '')}`)
  }
}

export const measureAnchors = (geom, geomType) =>
  itemsOf(geom, geomType).map((item, i) => ({
    part: String(i),
    anchors: Array.isArray(item)
      ? null
      : Object.fromEntries(
          Object.entries(anchorsOf(item, i)).map(([name, frame]) => [name, roundFrame(frame)]),
        ),
  }))

const axisOf = (items, selector) =>
  symmetryAxis(
    selectItems(items, selector)
      .filter((g) => classify(g) === 'geom3')
      .map((g) => wrapOne(g).toPolygons()),
  )

export const measureBetween = (geom, geomType, [a, b]) => {
  const items = itemsOf(geom, geomType)
  const ma = measureSelection(items, a)
  const mb = measureSelection(items, b)
  const [axisA, axisB] = [axisOf(items, a), axisOf(items, b)]
  const [[aLo, aHi], [bLo, bHi]] = [ma.boundingBox, mb.boundingBox]
  // Rounding keeps boolean noise (1e-14) from reading touching faces as overlap.
  const gap = [0, 1, 2].map((k) => roundMicron(Math.max(bLo[k] - aHi[k], aLo[k] - bHi[k])))
  return {
    a,
    b,
    gap,
    boxesOverlap: gap.every((g) => g < 0),
    distance: Math.hypot(...gap.map((g) => Math.max(g, 0))),
    centerOffset: mb.center.map((c, k) => roundMicron(c - ma.center[k])),
    axes: { a: axisA.axis, b: axisB.axis, ...axisRelation(axisA, axisB) },
  }
}

const PARTS_ERROR =
  'parts must be "all" or a selector like "0" or "1-3" (indexes into the array main() returns), an array of them, or a JSON array string'
const BETWEEN_ERROR = 'between needs exactly two part selectors like "0" or "1-3", e.g. ["0", "1"]'

const asSelector = (s) => (Number.isInteger(s) && s >= 0 ? String(s) : s)

// Tool-call arguments sometimes arrive stringified, as check's bed does.
const jsonArray = (text) => {
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

// A bare selector reads more naturally than a one-element array; "all" stays a string.
const normalizeParts = (parts) => {
  if (parts === undefined) return undefined
  if (parts === 'all') return parts
  const list = typeof parts === 'string' && parts.trim().startsWith('[') ? jsonArray(parts) : parts
  if (Array.isArray(list)) return list.map(asSelector)
  if (typeof list === 'string' || Number.isInteger(list)) return [asSelector(list)]
  throw new Error(PARTS_ERROR)
}

const normalizeBetween = (between) => {
  if (!Array.isArray(between) || between.length !== 2) throw new Error(BETWEEN_ERROR)
  const pair = between.map(asSelector)
  if (pair.includes('all')) throw new Error(`${BETWEEN_ERROR}; "all" works only in parts`)
  if (!pair.every((s) => typeof s === 'string')) throw new Error(BETWEEN_ERROR)
  return pair
}

const SECTION_FORMAT = /^([xyz])(?:=(-?[\d.]+(?:e-?\d+)?))?$/i
const SECTION_ERROR = 'section must be an axis "x", "y", "z", or an offset like "z=5"'
const VALID_AXES = new Set(['x', 'y', 'z'])

const normalizeSection = (section) => {
  if (section && typeof section === 'object' && 'axis' in section) {
    const { axis, offset } = section
    if (VALID_AXES.has(axis) && (offset === undefined || (typeof offset === 'number' && Number.isFinite(offset)))) {
      return section
    }
    throw new Error(SECTION_ERROR)
  }
  if (typeof section === 'string') {
    const m = SECTION_FORMAT.exec(section.trim())
    if (m) return { axis: m[1].toLowerCase(), offset: m[2] === undefined ? undefined : Number(m[2]) }
  }
  throw new Error(SECTION_ERROR)
}

export const measure = (geometry, options = {}) => {
  const wrapped = Array.isArray(geometry) ? geometry : wrapOne(geometry)
  const geomType = Array.isArray(geometry) ? 'array' : classify(geometry)
  const { parts, between, anchors: wantAnchors, section } = options
  const out = measureGeom(wrapped, geomType)
  if (geomType === 'array') {
    const insideOut = wrapped.flatMap((item, i) => (classify(item) === 'geom3' && measureGeom(wrapOne(item), 'geom3').insideOut ? [i] : []))
    if (insideOut.length) {
      out.insideOut = true
      out.notes = insideOut.map((i) => `part ${i}: ${INSIDE_OUT_NOTE}`)
    }
  }
  if (parts !== undefined) out.parts = measureParts(wrapped, geomType, normalizeParts(parts))
  if (between !== undefined) out.between = measureBetween(wrapped, geomType, normalizeBetween(between))
  if (wantAnchors) out.anchors = measureAnchors(wrapped, geomType)
  if (section !== undefined) out.section = sectionOutline(wrapped, geomType, normalizeSection(section))
  return out
}