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
 * Handles glyphs with multiple outer contours (e.g. 'i': dot + stroke) and
 * inner holes (e.g. 'O': outer circle + inner cutout).
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

  // Process each contour: apply flip, strip duplicate close, translate, classify.
  // After flip: outer contours are CCW (area < 0 in our CW-positive formula).
  //             holes are CW (area > 0).
  const processed = validContours.map(contour => {
    const origArea = signedArea(contour)
    let pts = flipAll ? [...contour].reverse() : contour
    // Strip duplicate closing point
    const first = pts[0], last = pts[pts.length - 1]
    if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) {
      pts = pts.slice(0, -1)
    }
    const translated = pts.map(([px, py]) => [px + x, py + y])
    // Holes have positive original area when flipAll (originally CW-outer → flipped → CCW outer,
    // originally CCW-hole → flipped → CW hole). For CFF (flipAll=false): holes already CW (area>0).
    const isHole = flipAll ? origArea < 0 : origArea > 0
    return { pts: translated, isHole }
  })

  const outers = processed.filter(c => !c.isHole)
  const holes = processed.filter(c => c.isHole)

  if (outers.length === 0) return null

  // Build polygon(s): each outer contour with its contained holes.
  // Multiple outer contours (e.g. 'i': dot + stroke) are unioned.
  const makeOuterPolygon = (outer, innerHoles) => {
    if (innerHoles.length === 0) {
      return jscad.primitives.polygon({ points: outer.pts })
    }
    // Use polygon paths: first path = outer (CCW), remaining = holes (CW).
    // The JSCAD/Manifold polygon treats path[0] as outer and path[1+] as holes.
    const allPts = [...outer.pts, ...innerHoles.flatMap(h => h.pts)]
    const outerPath = outer.pts.map((_, i) => i)
    let offset = outer.pts.length
    const holePaths = innerHoles.map(h => {
      const p = h.pts.map((_, i) => offset + i)
      offset += h.pts.length
      return p
    })
    return jscad.primitives.polygon({ points: allPts, paths: [outerPath, ...holePaths] })
  }

  // Simple case: single outer + holes → one polygon call
  if (outers.length === 1) {
    try {
      return makeOuterPolygon(outers[0], holes)
    } catch (err) {
      console.warn('jscad-text: failed to create polygon for glyph contour:', err.message)
      return null
    }
  }

  // Multiple outer contours: assign holes to their containing outer, then union.
  const results = []
  for (const outer of outers) {
    const myHoles = holes.filter(hole => {
      // Check if hole's first point is inside the outer contour
      const [hx, hy] = hole.pts[0]
      let inside = false
      const pts = outer.pts
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i][1] > hy) !== (pts[j][1] > hy) &&
            hx < (pts[j][0] - pts[i][0]) * (hy - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) {
          inside = !inside
        }
      }
      return inside
    })
    try {
      const geom = makeOuterPolygon(outer, myHoles)
      if (geom) results.push(geom)
    } catch (err) {
      console.warn('jscad-text: failed to create polygon for glyph contour:', err.message)
    }
  }

  if (results.length === 0) return null
  if (results.length === 1) return results[0]
  return jscad.booleans.union(...results)
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
