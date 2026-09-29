import { measureArray, wrapOne } from './array-geom.js'
import { analyzeMesh, outlinesClosed, weldedTriangles } from './mesh.js'
import { findSelfIntersections } from './self-intersect.js'

const SOLID_NOTE = 'wall thickness and overhangs: run jscad-work dfm'
const OUTLINE_NOTE = 'watertight and manifold apply to 3D solids; closed covers 2D outlines'
const INSIDE_OUT_NOTE =
  'solid is inside out (volume < 0); a 2D outline given clockwise usually causes this; reverse its points'

export const BEDS = {
  mk3: [250, 210, 210],
  mk4: [250, 210, 220],
  mini: [180, 180, 180],
  x1: [256, 256, 256],
  p1: [256, 256, 256],
  a1mini: [180, 180, 180],
  ender3: [220, 220, 250],
}

const isDimsArray = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
const isXyzObject = (v) => v && typeof v === 'object' && ['x', 'y', 'z'].every((k) => typeof v[k] === 'number')

// Accepts a real [x, y, z] array, an {x, y, z} object, or a JSON string
// parsing to either (the model tool wire format sometimes stringifies args).
const asDims = (bed) => {
  if (isDimsArray(bed)) return [...bed]
  if (isXyzObject(bed)) return [bed.x, bed.y, bed.z]
  if (typeof bed === 'string' && /^[[{]/.test(bed.trim())) {
    try {
      const parsed = JSON.parse(bed)
      if (isDimsArray(parsed)) return parsed
      if (isXyzObject(parsed)) return [parsed.x, parsed.y, parsed.z]
    } catch {
      // fall through: not valid JSON, treat as a bed name below
    }
    return null
  }
  return null
}

const resolveBed = (bed) => {
  if (!bed) return bed
  const dims = asDims(bed)
  if (dims) return dims
  const name = typeof bed === 'string' ? BEDS[bed.toLowerCase()] : undefined
  if (!name) {
    const shown = typeof bed === 'string' ? bed : JSON.stringify(bed)
    throw new Error(`unknown bed ${shown}: use one of ${Object.keys(BEDS).join(', ')} or [x, y, z] in mm`)
  }
  return name
}

const fitsBed = (dimensions, bed) => {
  const resolved = resolveBed(bed)
  return !resolved || !dimensions ? true : dimensions.every((d, i) => d <= resolved[i])
}

const classify = (g) => {
  if (g && typeof g === 'object' && 'polygons' in g) return 'geom3'
  if (g && typeof g === 'object' && 'sides' in g) return 'geom2'
  return 'unknown'
}

const extent = (geom, bed) => {
  const dimensions = geom.measureDimensions()
  return { fitsBed: fitsBed(dimensions, bed), bbox: geom.measureBoundingBox(), dimensions }
}

const checkSolid = (geom, bed) => {
  const polygons = geom.toPolygons()
  if (polygons.length === 0) {
    return {
      empty: true,
      watertight: null,
      manifold: null,
      openEdges: 0,
      nonManifoldEdges: 0,
      nonManifoldVertices: 0,
      consistentNormals: null,
      selfIntersecting: null,
      ...extent(geom, bed),
      notes: [SOLID_NOTE],
    }
  }
  const mesh = analyzeMesh(polygons)
  const insideOut = geom.measureVolume() < 0
  return {
    empty: false,
    watertight: mesh.openEdges === 0 && !insideOut,
    manifold: mesh.nonManifoldEdges === 0 && mesh.nonManifoldVertices === 0,
    insideOut,
    ...mesh,
    ...findSelfIntersections(weldedTriangles(polygons)),
    ...extent(geom, bed),
    notes: insideOut ? [SOLID_NOTE, INSIDE_OUT_NOTE] : [SOLID_NOTE],
  }
}

const checkOutline = (geom, bed) => {
  const sides = geom.sides ?? []
  const closed = outlinesClosed(sides)
  return {
    empty: sides.length === 0,
    closed,
    outlines: closed ? geom.toOutlines().length : null,
    watertight: null,
    manifold: null,
    ...extent(geom, bed),
    notes: [OUTLINE_NOTE],
  }
}

const allOf = (values) => {
  const known = values.filter((v) => v !== null && v !== undefined)
  return known.length ? known.every(Boolean) : null
}

const anyOf = (values) => {
  const known = values.filter((v) => v !== null && v !== undefined)
  return known.length ? known.some(Boolean) : null
}

const checkArray = (arr, bed) => {
  const items = arr.map((item, index) => {
    const geomType = classify(item)
    if (geomType === 'unknown') {
      return { index, geomType, empty: true, notes: ['not a geom2 or geom3'] }
    }
    return { index, geomType, ...checkGeom(wrapOne(item), geomType, bed) }
  })
  const measurable = arr.filter((_, i) => items[i].geomType !== 'unknown')
  const { boundingBox, dimensions } = measureArray(measurable)
  const notes = [...new Set(items.flatMap((it) => it.notes))]
  return {
    empty: items.every((it) => it.empty),
    watertight: allOf(items.map((it) => it.watertight)),
    manifold: allOf(items.map((it) => it.manifold)),
    selfIntersecting: anyOf(items.map((it) => it.selfIntersecting)),
    insideOut: anyOf(items.map((it) => it.insideOut)),
    openEdges: items.reduce((n, it) => n + (it.openEdges ?? 0), 0),
    fitsBed: fitsBed(dimensions, bed),
    bbox: boundingBox,
    dimensions,
    entityCount: items.length,
    items: items.map(({ notes: _, ...it }) => it),
    notes,
  }
}

export const checkGeom = (geom, geomType, bed) => {
  if (geomType === 'array') return checkArray(geom, bed)
  if (geomType === 'geom3') return checkSolid(geom, bed)
  if (geomType === 'geom2') return checkOutline(geom, bed)
  return { empty: true, watertight: null, manifold: null, notes: ['not a geom2 or geom3'] }
}

export const check = (geometry, options = {}) =>
  checkGeom(
    Array.isArray(geometry) ? geometry : wrapOne(geometry),
    Array.isArray(geometry) ? 'array' : classify(geometry),
    options.bed,
  )