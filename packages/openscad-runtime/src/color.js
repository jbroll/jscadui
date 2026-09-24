/**
 * Color helpers for OpenSCAD compatibility
 */

import { NO_CHILD } from './primitives.js'
import { consuming } from './consume.js'

// colorize() sets .color on every element it is handed, so a child that drew
// nothing has to go before it gets there. OpenSCAD colours the rest.
const _present = (geo) => {
  if (!Array.isArray(geo)) return geo
  const kept = geo.flat(Infinity).filter(g => g !== undefined && g !== null && g !== NO_CHILD)
  return kept.length === 0 ? undefined : kept
}

// JSCAD colors - injected at init time
let colorize, cssColors

export const initColor = (jscad) => {
  colorize = consuming(jscad.colors.colorize)
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
  const present = _present(geo)
  if (present === undefined || present === null) return undefined
  return colorize(rgba, present)
}
