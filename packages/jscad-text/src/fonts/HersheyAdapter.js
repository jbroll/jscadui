/**
 * HersheyAdapter - wraps JSCAD's vectorText/vectorChar to produce
 * a uniform glyph layout structure compatible with text2d().
 *
 * Hershey fonts are stroke fonts - each character is a set of polylines.
 * These need to be expanded to filled outlines before they can be used as geom2.
 *
 * The returned layout uses units where size=10 corresponds to cap-height ≈ 10.
 * The Hershey font internally uses height=21 (uppercase height). We scale
 * everything so that `size` matches OpenSCAD's size convention.
 */

// Injected JSCAD reference
let jscad = null

export const initHershey = (jscadRef) => {
  jscad = jscadRef
}

/**
 * Hershey font metrics (from @jscad/modeling vectorParams defaults)
 * The default height is 21 (uppercase cap height in internal units).
 * vectorChar returns { width, height, segments } where height=21 always.
 */
const HERSHEY_HEIGHT = 21

/**
 * Get the glyph layout for the given text using the Hershey simplex font.
 *
 * Returns an array of GlyphLine objects:
 *   { segments: Array<Array<[x,y]>>, width: number, y: number }
 *
 * Each `segments` entry is a polyline (array of [x,y] points).
 * The coordinate system is: x grows right, y grows up, baseline at y=0.
 *
 * @param {string} text - the text to lay out
 * @param {object} opts
 * @param {number} opts.size - font size (OpenSCAD convention: cap height)
 * @param {number} [opts.spacing=1] - character spacing multiplier
 * @param {string} [opts.halign='left'] - 'left'|'center'|'right'
 * @param {number} [opts.lineSpacing=1.4] - line height multiplier
 * @returns {{ lines: GlyphLine[], totalWidth: number, totalHeight: number, capHeight: number, descender: number }}
 */
export function layoutHershey(text, { size = 10, spacing = 1, halign = 'left', lineSpacing = 1.4 } = {}) {
  if (!jscad) throw new Error('HersheyAdapter: call initHershey(jscad) first')

  const scale = size / HERSHEY_HEIGHT

  // We need to implement our own layout for alignment support,
  // since vectorText's align doesn't map to OpenSCAD halign exactly
  // (vectorText aligns across lines of different width - that's what we want)
  const vectorChar = jscad.text.vectorChar

  // Parse lines
  const textLines = text.split('\n')
  const lines = []
  let totalWidth = 0

  for (const lineText of textLines) {
    let x = 0
    const lineSegments = []

    for (const char of lineText) {
      const { width, segments } = vectorChar({ height: HERSHEY_HEIGHT, xOffset: x, yOffset: 0 }, char)
      const charWidth = width * spacing
      // Collect segments (polylines), skipping spaces which have no segments
      for (const seg of segments) {
        lineSegments.push(seg)
      }
      x += charWidth
    }

    const lineWidth = x * scale
    totalWidth = Math.max(totalWidth, lineWidth)
    lines.push({ rawSegments: lineSegments, width: lineWidth, scale })
  }

  // Apply halign offset to each line
  const alignedLines = lines.map((line, i) => {
    let dx = 0
    if (halign === 'center') dx = -line.width / 2
    else if (halign === 'right') dx = -line.width

    // Apply scale and x-offset to each segment
    const y = -i * size * lineSpacing  // lines go downward
    const segments = line.rawSegments.map(seg =>
      seg.map(([px, py]) => [px * scale + dx, py * scale + y])
    )
    return { segments, width: line.width, y }
  })

  return {
    lines: alignedLines,
    totalWidth,
    capHeight: size,
    descender: size * 0.3,   // approximate: Hershey has descenders ~30% below baseline
    lineSpacing: size * lineSpacing,
  }
}
