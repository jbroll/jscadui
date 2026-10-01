import { manifoldToGeom3 } from '@jscadui/openscad/run'

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

export function toRenderParts(geometry, ctx) {
  const solids = Array.isArray(geometry) ? geometry : [geometry]
  return solids.map((solid) => {
    const positions = []
    for (const polygon of toPolygons(solid, ctx)) {
      for (const triangle of fanTriangulate(polygon.vertices)) {
        for (const vertex of triangle) positions.push(...vertex)
      }
    }
    return { color: solid.color ?? null, positions: Float32Array.from(positions) }
  })
}
