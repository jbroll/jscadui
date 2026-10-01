import { exportedGeometry, manifoldToGeom3 } from '@jscadui/openscad/run'
import * as jscadModelingModule from '@jscad/modeling'

// @jscad/modeling ships CJS; Node's ESM interop sometimes lands the real
// exports under .default instead of on the namespace object directly.
const jscadModeling = jscadModelingModule.measurements ? jscadModelingModule : jscadModelingModule.default

const toSolids = (geometry) => {
  const flattened = exportedGeometry(geometry)
  if (flattened == null) return []
  return Array.isArray(flattened) ? flattened : [flattened]
}

const toGeom3 = (solid) => manifoldToGeom3(solid.manifold ?? solid)

export function boundingSize(geometry, ctx) {
  const solids = toSolids(geometry)
  if (solids.length === 0) return [0, 0, 0]
  const measurements = ctx.jscadModeling?.measurements
  const bbox = measurements
    ? measurements.measureAggregateBoundingBox(...solids)
    : jscadModeling.measurements.measureAggregateBoundingBox(...solids.map(toGeom3))
  return [bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1], bbox[1][2] - bbox[0][2]]
}

export function isEmpty(geometry, ctx) {
  const solids = toSolids(geometry)
  if (solids.length === 0) return true
  const measureIsEmpty = ctx.jscadModeling?.measurements?.measureIsEmpty
  if (measureIsEmpty) return solids.every((solid) => measureIsEmpty(solid))
  return solids.every((solid) => toGeom3(solid).polygons.length === 0)
}
