/**
 * Color helpers for OpenSCAD compatibility
 */

import { NO_CHILD } from './primitives.js'

// JSCAD colors - injected at init time
let colorize, cssColors

export const initColor = (jscad) => {
  colorize = jscad.colors.colorize
  cssColors = jscad.colors.cssColors
}

// Color helper - handles CSS names, RGB, and RGBA
export const _color = (color, alpha, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  let rgba
  if (typeof color === 'string') {
    // CSS color name
    const rgb = cssColors[color] || [0.5, 0.5, 0.5]
    rgba = [...rgb, alpha ?? 1]
  } else if (Array.isArray(color)) {
    // RGB or RGBA array
    rgba = color.length === 3 ? [...color, alpha ?? 1] : color
  } else {
    rgba = [0.5, 0.5, 0.5, 1]
  }
  return colorize(rgba, geo)
}
