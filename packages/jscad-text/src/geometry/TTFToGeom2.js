/**
 * TTFToGeom2 - convert TTF glyph contours (from TTFLoader) to JSCAD geom2.
 *
 * Contours arrive in Y-up coordinates (TTFLoader negates opentype.js screen Y).
 * TrueType convention (Y-up): outer contours are CW, holes are CCW.
 * CFF convention (Y-up):      outer contours are CCW, holes are CW.
 * JSCAD polygon() needs:      outer contours CCW, holes CW.
 *
 * We detect the font convention by finding the contour with the largest area
 * (the outer boundary). If it is CW (TrueType), we reverse all contours;
 * if it is CCW (CFF), we keep all contours. Either way the result satisfies
 * JSCAD's expectations.
 *
 * The full text geometry is built by:
 * 1. Converting each glyph's contours to polygon(s)
 * 2. Combining all glyph polygons for each line
 * 3. Unioning across lines to produce a single geom2
 */

// Injected JSCAD reference
let jscad = null

export const initTTFToGeom2 = (jscadRef) => {
  jscad = jscadRef
}

/**
 * Compute the signed area via the shoelace formula.
 * Positive = CW in standard Y-up math coordinates.
 * Contours from pathToContours are closed (first point repeated at end),
 * so we iterate i < length-1 to avoid double-counting the closing edge.
 *
 * @param {Array<[number,number]>} contour
 * @returns {number} signed area (positive = CW)
 */
function signedArea(contour) {
  let sum = 0
  for (let i = 0; i < contour.length - 1; i++) {
    sum += (contour[i + 1][0] - contour[i][0]) * (contour[i + 1][1] + contour[i][1])
  }
  return sum
}

/**
 * Convert a set of contours (from one glyph at one position) to a geom2.
 *
 * Outer contours and holes are combined into a single polygon with multiple
 * paths via JSCAD's polygon({ points, paths }) API.
 *
 * @param {Array<Array<[number,number]>>} contours - closed contour arrays (Y-up)
 * @param {number} x - glyph x offset
 * @param {number} y - glyph y offset
 * @returns {geom2 | null}
 */
function contoursToGeom2(contours, x, y) {
  if (!contours || contours.length === 0) return null

  const validContours = contours.filter(c => c.length >= 3)
  if (validContours.length === 0) return null

  // Determine font winding convention from the largest-area contour.
  // TrueType (Y-up): outer=CW  → flip all → outer=CCW, holes=CW  ✓ for JSCAD
  // CFF      (Y-up): outer=CCW → keep all → outer=CCW, holes=CW  ✓ for JSCAD
  let largestAbsArea = 0
  let largestIsCW = false
  for (const contour of validContours) {
    const area = signedArea(contour)
    if (Math.abs(area) > largestAbsArea) {
      largestAbsArea = Math.abs(area)
      largestIsCW = area > 0
    }
  }
  const flipAll = largestIsCW

  const allPoints = []
  const paths = []

  for (const contour of validContours) {
    const startIdx = allPoints.length
    const pts = flipAll ? [...contour].reverse() : contour
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
  } catch (err) {
    console.warn('jscad-text: failed to create polygon for glyph contour:', err.message)
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
