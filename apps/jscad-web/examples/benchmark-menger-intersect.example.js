"use strict"
/**
 * Benchmark: Menger Sponge via Intersection
 * Alternative technique: extrude 2D Sierpinski carpet, intersect 3 rotated copies.
 *
 * This tests intersection performance (vs union in standard Menger).
 *
 * Depth 2: Lite (default) ~100ms
 * Depth 3: Moderate ~2s
 * Depth 4: Heavy ~30s
 */

const jscad = require('@jscad/modeling')
const { square } = jscad.primitives
const { union, intersect } = jscad.booleans
const { translate, rotateX, rotateY } = jscad.transforms
const { extrudeLinear } = jscad.extrusions

/**
 * Recursively build a 2D Sierpinski carpet
 */
function sierpinskiCarpet(size, depth) {
  if (depth === 0) return square({ size })

  const s = size / 3
  const parts = []

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      // Skip the center square
      if (x === 0 && y === 0) continue
      parts.push(translate([x * s, y * s, 0], sierpinskiCarpet(s, depth - 1)))
    }
  }
  return union(parts)
}

const main = (params) => {
  params._type = 'Menger Intersect'
  params.depth = { type: 'slider', default: 2, min: 1, max: 5, step: 1, label: 'Recursion depth' }
  params.size = { type: 'slider', default: 60, min: 20, max: 120, step: 10, label: 'Size' }

  const depth = params.depth
  const size = params.size

  // Build 2D Sierpinski carpet
  const carpet = sierpinskiCarpet(size, depth)

  // Extrude to full height (size * 2 to ensure overlap)
  const height = size * 2
  const extruded = extrudeLinear({ height }, carpet)

  // Center the extrusion
  const centered = translate([0, 0, -height / 2], extruded)

  // Intersect three orthogonal copies
  return intersect(
    centered,
    rotateY(Math.PI / 2, centered),
    rotateX(Math.PI / 2, centered)
  )
}

module.exports = { main }
