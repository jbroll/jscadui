import { exportedGeometry } from '@jscadui/openscad/run'

// Shared by measure.js and triangles.js: buildPart's raw result (one solid, or
// a possibly-nested array carrying %/# previewOnly ghosts) needs the same
// ghost-dropping, flattening normalization everywhere it's measured or drawn.
export const toSolids = (geometry) => {
  const flattened = exportedGeometry(geometry)
  if (flattened == null) return []
  return Array.isArray(flattened) ? flattened : [flattened]
}
