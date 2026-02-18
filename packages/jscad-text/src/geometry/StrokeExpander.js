/**
 * StrokeExpander - converts stroke polylines (Hershey font segments) to
 * filled 2D geometry (geom2) by expanding each stroke by a given half-width.
 *
 * Uses JSCAD's path2 + expansions.expand() to create filled outlines from
 * open polyline paths. The resulting geom2 objects are then union'd together.
 */

// Injected JSCAD reference
let jscad = null

export const initStrokeExpander = (jscadRef) => {
  jscad = jscadRef
}

/**
 * Convert a single polyline (array of [x,y] points) to a filled geom2 strip.
 *
 * @param {Array<[number, number]>} points - polyline points
 * @param {number} halfWidth - half the desired stroke width
 * @param {number} segments - roundness quality (for end caps)
 * @returns {geom2 | null} filled outline, or null if too few points
 */
function expandPolyline(points, halfWidth, segments) {
  if (points.length < 2) return null

  const path = jscad.geometries.path2.fromPoints({}, points)
  try {
    return jscad.expansions.expand({
      delta: halfWidth,
      corners: 'round',
      segments,
    }, path)
  } catch (err) {
    console.warn('jscad-text: failed to expand stroke polyline:', err.message)
    return null
  }
}

/**
 * Expand a set of stroke polylines to a single filled geom2.
 *
 * @param {Array<Array<[number, number]>>} segments - array of polylines
 * @param {object} opts
 * @param {number} opts.strokeWidth - full stroke width
 * @param {number} [opts.segments=16] - roundness quality for end caps
 * @returns {geom2 | null} union of all expanded strokes, or null if empty
 */
export function expandStrokes(segments, { strokeWidth, segments: segs = 16 } = {}) {
  if (!jscad) throw new Error('StrokeExpander: call initStrokeExpander(jscad) first')

  const halfWidth = strokeWidth / 2
  const geoms = []

  for (const polyline of segments) {
    if (!polyline || polyline.length < 2) continue
    const geom = expandPolyline(polyline, halfWidth, segs)
    if (geom) geoms.push(geom)
  }

  if (geoms.length === 0) return null
  if (geoms.length === 1) return geoms[0]

  return jscad.booleans.union(...geoms)
}

/**
 * Expand multiple lines of glyph segments (from HersheyAdapter.layoutHershey)
 * into a single geom2, applying a y-offset for valign.
 *
 * @param {Array<{segments: Array<Array<[number,number]>>, y: number}>} lines
 * @param {object} opts
 * @param {number} opts.strokeWidth
 * @param {number} [opts.segments=16]
 * @param {number} [opts.yOffset=0] - vertical offset applied after layout (valign)
 * @returns {geom2 | null}
 */
export function expandLines(lines, { strokeWidth, segments: segs = 16, yOffset = 0 } = {}) {
  if (!jscad) throw new Error('StrokeExpander: call initStrokeExpander(jscad) first')

  const allGeoms = []

  for (const line of lines) {
    if (!line.segments || line.segments.length === 0) continue

    // Apply yOffset to all segments
    const offsetSegs = yOffset === 0
      ? line.segments
      : line.segments.map(seg => seg.map(([x, y]) => [x, y + yOffset]))

    const geom = expandStrokes(offsetSegs, { strokeWidth, segments: segs })
    if (geom) allGeoms.push(geom)
  }

  if (allGeoms.length === 0) return null
  if (allGeoms.length === 1) return allGeoms[0]

  return jscad.booleans.union(...allGeoms)
}
