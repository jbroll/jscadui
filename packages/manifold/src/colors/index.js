/**
 * Color operations for geometries.
 *
 * Colors are stored on the ManifoldGeom3/ManifoldGeom2 wrapper.
 * Utility functions are re-exported from JSCAD.
 */

import { ManifoldGeom3, isManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2, isManifoldGeom2 } from '../geometries/ManifoldGeom2.js'
import * as jscad from '@jscad/modeling-core'

// Re-export color utility functions from JSCAD
export const { hexToRgb, hslToRgb, hsvToRgb, rgbToHex, rgbToHsl, rgbToHsv, colorNameToRgb, cssColors } = jscad.colors

/**
 * Apply a color to geometries.
 *
 * @param {Array|string} color - Color as [r, g, b, a], [r, g, b], or CSS color string
 * @param {...Object} geometries - Geometries to color
 * @returns {Object|Array} Colored geometry/geometries
 */
export const colorize = (color, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  // Normalize color to [r, g, b, a]
  const rgba = normalizeColor(color)

  const results = geoms.map((geom) => {
    if (isManifoldGeom3(geom)) {
      const colored = geom.clone()
      colored.color = rgba
      return colored
    }
    if (isManifoldGeom2(geom)) {
      const colored = geom.clone()
      colored.color = rgba
      return colored
    }
    // Convert to ManifoldGeom3 and apply color
    const manifold = toManifold(geom)
    const wrapped = new ManifoldGeom3(manifold)
    wrapped.color = rgba
    return wrapped
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Normalize color to [r, g, b, a] format (0-1 range).
 *
 * @param {Array|string} color - Input color
 * @returns {Array} [r, g, b, a] in 0-1 range
 */
const normalizeColor = (color) => {
  if (Array.isArray(color)) {
    const [r, g, b, a = 1] = color
    // Check if values are 0-255 range
    if (r > 1 || g > 1 || b > 1) {
      return [r / 255, g / 255, b / 255, a > 1 ? a / 255 : a]
    }
    return [r, g, b, a]
  }

  // Parse CSS color string
  if (typeof color === 'string') {
    return cssColorToRGBA(color)
  }

  return [1, 1, 1, 1] // Default white
}

/**
 * Parse CSS color string to RGBA.
 *
 * @param {string} str - CSS color string
 * @returns {Array} [r, g, b, a] in 0-1 range
 */
const cssColorToRGBA = (str) => {
  // Named colors
  const namedColors = {
    red: [1, 0, 0, 1],
    green: [0, 0.5, 0, 1],
    blue: [0, 0, 1, 1],
    white: [1, 1, 1, 1],
    black: [0, 0, 0, 1],
    yellow: [1, 1, 0, 1],
    cyan: [0, 1, 1, 1],
    magenta: [1, 0, 1, 1],
    orange: [1, 0.647, 0, 1],
    purple: [0.5, 0, 0.5, 1],
    gray: [0.5, 0.5, 0.5, 1],
    grey: [0.5, 0.5, 0.5, 1]
  }

  if (namedColors[str.toLowerCase()]) {
    return namedColors[str.toLowerCase()]
  }

  // Hex color
  if (str.startsWith('#')) {
    const hex = str.slice(1)
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16) / 255
      const g = parseInt(hex[1] + hex[1], 16) / 255
      const b = parseInt(hex[2] + hex[2], 16) / 255
      return [r, g, b, 1]
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      return [r, g, b, 1]
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      const a = parseInt(hex.slice(6, 8), 16) / 255
      return [r, g, b, a]
    }
  }

  // rgb() or rgba() format
  const rgbMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]) / 255
    const g = parseInt(rgbMatch[2]) / 255
    const b = parseInt(rgbMatch[3]) / 255
    const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1
    return [r, g, b, a]
  }

  return [1, 1, 1, 1] // Default white
}

export default {
  colorize,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  colorNameToRgb,
  cssColors
}
