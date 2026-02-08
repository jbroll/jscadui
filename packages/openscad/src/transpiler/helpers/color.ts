/**
 * Color helper generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build color helper based on usage
 */
export function buildColorHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  if (ctx.usedColors) {
    imports.push(`
const _color = (color, alpha, geo) => {
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
}`)
  }

  return imports
}
