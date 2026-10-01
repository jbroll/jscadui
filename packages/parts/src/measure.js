import { toSolids } from './solids.js'

export function boundingSize(geometry, ctx) {
  const solids = toSolids(geometry)
  if (solids.length === 0) return [0, 0, 0]
  const bbox = ctx.jscadModeling.measurements.measureAggregateBoundingBox(...solids)
  return [bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1], bbox[1][2] - bbox[0][2]]
}

export function isEmpty(geometry, ctx) {
  const solids = toSolids(geometry)
  if (solids.length === 0) return true
  return solids.every((solid) => ctx.jscadModeling.measurements.measureIsEmpty(solid))
}
