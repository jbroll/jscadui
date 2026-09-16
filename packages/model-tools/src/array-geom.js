import jscad from '@jscad/modeling'

const { geometries, measurements } = jscad

const { geom2, geom3 } = geometries
const { measureArea, measureBoundingBox, measureCenter, measureDimensions, measureVolume } =
  measurements

// Modeling geometry is plain data; the reference jscad-fluent wrappers added these methods.
const methods3 = (g) => ({
  measureBoundingBox: () => measureBoundingBox(g),
  measureDimensions: () => measureDimensions(g),
  measureCenter: () => measureCenter(g),
  measureVolume: () => measureVolume(g),
  toPolygons: () => geom3.toPolygons(g),
})

const methods2 = (g) => ({
  measureBoundingBox: () => measureBoundingBox(g),
  measureDimensions: () => measureDimensions(g),
  measureCenter: () => measureCenter(g),
  measureArea: () => measureArea(g),
  toOutlines: () => geom2.toOutlines(g),
})

export const wrapOne = (g) => {
  if (!g || typeof g.measureBoundingBox === 'function') return g
  if (geom3.isA(g))
    return {
      polygons: g.polygons,
      transforms: g.transforms,
      color: g.color,
      anchors: g.anchors,
      ...methods3(g),
    }
  if (geom2.isA(g))
    return {
      sides: g.sides,
      transforms: g.transforms,
      color: g.color,
      anchors: g.anchors,
      ...methods2(g),
    }
  if (g && typeof g === 'object' && 'polygons' in g)
    return { anchors: g.anchors, ...methods3(geom3.create(g.polygons)) }
  if (g && typeof g === 'object' && 'sides' in g)
    return { anchors: g.anchors, ...methods2(geom2.create(g.sides)) }
  return g
}

const normalizeItems = (arr) => arr.map(wrapOne)

const combinedBox = (items) => {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const it of items) {
    const bb = it.measureBoundingBox()
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], bb[0][i])
      hi[i] = Math.max(hi[i], bb[1][i])
    }
  }
  return [lo, hi]
}

export const measureArray = (arr) => {
  const items = normalizeItems(arr)
  if (items.length === 0) {
    return {
      boundingBox: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      dimensions: [0, 0, 0],
      center: [0, 0, 0],
      volume: 0,
      polygonCount: 0,
      entityCount: 0,
    }
  }
  const [lo, hi] = combinedBox(items)
  let volume = 0
  let polygonCount = 0
  for (const it of items) {
    if (typeof it.measureVolume === 'function') volume += it.measureVolume()
    if (typeof it.toPolygons === 'function') polygonCount += it.toPolygons().length
  }
  return {
    boundingBox: [lo, hi],
    dimensions: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    volume,
    polygonCount,
    entityCount: items.length,
  }
}