/**
 * TTFToGeom2 - convert TTF glyph contours (from TTFLoader) to JSCAD geom2.
 *
 * TTF glyphs consist of outer contours (CCW winding) and holes (CW winding).
 * Each glyph is converted to a JSCAD polygon with 'paths' for hole support.
 *
 * The full text geometry is built by:
 * 1. Converting each glyph's contours to polygon(s)
 * 2. Combining all glyph polygons for each line
 * 3. Unioning across lines to produce a single geom2
 */

import { isClockwise } from '../fonts/TTFLoader.js'

// Injected JSCAD reference
let jscad = null

export const initTTFToGeom2 = (jscadRef) => {
  jscad = jscadRef
}

/**
 * Convert a set of contours (from one glyph at one position) to a geom2.
 *
 * Outer contours (CCW) and holes (CW) are combined into a single polygon
 * with multiple paths via JSCAD's polygon({ points, paths }) API.
 *
 * @param {Array<Array<[number,number]>>} contours - closed contour arrays
 * @param {number} x - glyph x offset
 * @param {number} y - glyph y offset
 * @returns {geom2 | null}
 */
function contoursToGeom2(contours, x, y) {
  if (!contours || contours.length === 0) return null

  const allPoints = []
  const paths = []

  for (const contour of contours) {
    if (contour.length < 3) continue

    const startIdx = allPoints.length
    const cw = isClockwise(contour)

    // Outer contours (CCW in OpenType) → keep as-is for JSCAD
    // Hole contours (CW in OpenType) → reverse so JSCAD's polygon() interprets them as holes
    const pts = cw ? [...contour].reverse() : contour

    for (const [px, py] of pts) {
      allPoints.push([px + x, py + y])
    }

    const path = []
    for (let i = startIdx; i < allPoints.length; i++) path.push(i)
    paths.push(path)
  }

  if (allPoints.length < 3) return null

  try {
    if (paths.length === 1) {
      return jscad.primitives.polygon({ points: allPoints })
    }
    return jscad.primitives.polygon({ points: allPoints, paths })
  } catch {
    return null
  }
}

/**
 * Convert TTF layout lines to a single geom2.
 *
 * @param {Array<{glyphs: Array<{contours, x, y}>, y: number}>} lines
 * @param {number} [yOffset=0] - vertical offset for valign
 * @returns {geom2 | null}
 */
export function ttfLinesToGeom2(lines, yOffset = 0) {
  if (!jscad) throw new Error('TTFToGeom2: call initTTFToGeom2(jscad) first')

  const allGeoms = []

  for (const line of lines) {
    for (const glyph of line.glyphs) {
      const geom = contoursToGeom2(glyph.contours, glyph.x, glyph.y + yOffset)
      if (geom) allGeoms.push(geom)
    }
  }

  if (allGeoms.length === 0) return null
  if (allGeoms.length === 1) return allGeoms[0]

  return jscad.booleans.union(...allGeoms)
}
