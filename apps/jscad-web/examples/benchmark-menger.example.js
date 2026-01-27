"use strict"
/**
 * Benchmark: Menger Sponge
 * Tests recursive unions and tree depth.
 *
 * Depth 2: Lite (default) ~50ms
 * Depth 3: Moderate ~1s
 * Depth 4: Heavy ~20s
 * Depth 5+: Brutal (minutes, may crash)
 */

const jscad = require('@jscad/modeling')
const { cube } = jscad.primitives
const { union } = jscad.booleans
const { translate } = jscad.transforms

/**
 * Recursively build a Menger sponge
 */
function menger(size, depth) {
  if (depth === 0) return cube({ size })

  const s = size / 3
  const parts = []

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const zeros = (x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0)
        if (zeros <= 1) {
          parts.push(translate([x * s, y * s, z * s], menger(s, depth - 1)))
        }
      }
    }
  }
  return union(parts)
}

const main = (params) => {
  params._type = 'Menger Sponge'
  params.depth = { type: 'slider', default: 2, min: 1, max: 6, step: 1, label: 'Recursion depth' }
  params.size = { type: 'slider', default: 60, min: 10, max: 200, step: 10, label: 'Size' }

  return menger(params.size, params.depth)
}

module.exports = { main }
