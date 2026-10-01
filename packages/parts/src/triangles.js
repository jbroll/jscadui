import { manifoldToGeom3 } from '@jscadui/openscad/run'
import { toSolids } from './solids.js'

// A manifold mesh is already triangulated (triVerts), so the fan below
// degenerates to the single triangle manifoldToGeom3 produced.
const fanTriangulate = (vertices) => {
  const triangles = []
  for (let i = 1; i < vertices.length - 1; i++) triangles.push([vertices[0], vertices[i], vertices[i + 1]])
  return triangles
}

const toPolygons = (solid, ctx) => {
  const geom3 = solid.isManifoldGeom3 ? manifoldToGeom3(solid.manifold) : solid
  return ctx.jscadModeling.geometries.geom3.toPolygons(geom3)
}

// Matches eval/mesh.js's colorOf: RGB only, clamped to [0, 1], null when unset or invalid.
const colorOf = (color) =>
  Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every((c) => typeof c === 'number' && Number.isFinite(c))
    ? color.slice(0, 3).map((c) => Math.min(1, Math.max(0, c)))
    : null

export function toRenderParts(geometry, ctx) {
  return toSolids(geometry).map((solid) => {
    const positions = []
    for (const polygon of toPolygons(solid, ctx)) {
      for (const triangle of fanTriangulate(polygon.vertices)) {
        for (const vertex of triangle) positions.push(...vertex)
      }
    }
    return { color: colorOf(solid.color), positions: Float32Array.from(positions) }
  })
}
