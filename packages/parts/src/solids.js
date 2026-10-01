import { exportedGeometry } from '@jscadui/openscad/run'

// buildPart returns one solid or a nested array with %/# previewOnly ghosts; measuring and drawing want it flat, ghosts dropped.
export const toSolids = (geometry) => {
  const flattened = exportedGeometry(geometry)
  if (flattened == null) return []
  return Array.isArray(flattened) ? flattened : [flattened]
}
