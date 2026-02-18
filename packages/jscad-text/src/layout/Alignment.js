/**
 * Alignment - compute the Y offset for OpenSCAD-compatible valign.
 *
 * OpenSCAD text() valign semantics:
 *   "baseline" (default) - y=0 is the text baseline (bottom of most characters)
 *   "top"       - y=0 is the top of the ascenders
 *   "center"    - y=0 is the vertical center of the text
 *   "bottom"    - y=0 is below the descenders
 *
 * Hershey font metrics:
 *   The glyph segments are already positioned relative to the baseline (y=0).
 *   capHeight: approximate cap height (uppercase letter height)
 *   descender: approximate descender depth below baseline (negative y value)
 */

/**
 * Compute the Y offset to apply to glyph geometry for the requested valign.
 *
 * The offset shifts the geometry so that y=0 aligns with the valign anchor.
 * Add this offset to all glyph y-coordinates after layout.
 *
 * @param {string} valign - 'baseline'|'top'|'center'|'bottom'
 * @param {object} metrics
 * @param {number} metrics.capHeight - height of uppercase letters (above baseline)
 * @param {number} metrics.descender - depth below baseline (as a positive number)
 * @param {number} metrics.totalLines - number of text lines
 * @param {number} metrics.lineSpacing - spacing between lines (in same units as capHeight)
 * @returns {number} Y offset to add to all glyph coordinates
 */
export function computeValignOffset(valign, { capHeight, descender, totalLines, lineSpacing }) {
  switch (valign) {
    case 'baseline':
      // Default: y=0 is at the baseline of the first line.
      // Glyph coordinates are already baseline-relative → no offset
      return 0

    case 'top':
      // y=0 should be at the top of the ascenders
      // Currently top of ascenders is at +capHeight → shift down by capHeight
      return -capHeight

    case 'center': {
      // y=0 at vertical center of the full text block.
      // Block spans from +capHeight (top of line 0) to
      // -(descender + (totalLines-1)*lineSpacing) (bottom of last line).
      // Center = (capHeight - descender - (totalLines-1)*lineSpacing) / 2
      const blockTop = capHeight
      const blockBottom = descender + (totalLines - 1) * lineSpacing
      return -(blockTop - blockBottom) / 2
    }

    case 'bottom':
      // y=0 at the bottom of the lowest descenders
      // Bottom of last line is at -descender - (totalLines-1)*lineSpacing
      return descender + (totalLines - 1) * lineSpacing

    default:
      return 0
  }
}
