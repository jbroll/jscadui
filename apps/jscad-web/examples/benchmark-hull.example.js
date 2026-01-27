"use strict"
/**
 * Benchmark: Hull Operations
 * Tests convex hull computation with many random points/spheres.
 *
 * 30 points: Lite (default) ~20ms
 * 100 points: Moderate ~200ms
 * 300 points: Heavy ~5s
 * 500+ points: Brutal (minutes)
 *
 * Hull is a different algorithm from boolean CSG operations,
 * computing the convex envelope of input geometries.
 */

const jscad = require('@jscad/modeling')
const { sphere } = jscad.primitives
const { hull } = jscad.hulls
const { translate } = jscad.transforms

/**
 * Simple seeded PRNG (Linear Congruential Generator)
 */
function seededRandom(seed) {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

const main = (params) => {
  params._type = 'Hull'
  params.points = { type: 'slider', default: 30, min: 10, max: 1000, step: 10, label: 'Number of points' }
  params.spread = { type: 'slider', default: 50, min: 20, max: 100, step: 10, label: 'Spread' }
  params.pointSize = { type: 'slider', default: 2, min: 1, max: 5, step: 0.5, label: 'Point size' }
  params.segments = { type: 'slider', default: 8, min: 4, max: 32, step: 2, label: 'Sphere segments' }
  params.seed = { type: 'int', default: 42, min: 1, label: 'Random seed' }

  const points = params.points
  const spread = params.spread
  const pointSize = params.pointSize
  const segments = params.segments
  const seed = params.seed

  const rand = seededRandom(seed)
  const spheres = []

  for (let i = 0; i < points; i++) {
    const x = (rand() - 0.5) * spread
    const y = (rand() - 0.5) * spread
    const z = (rand() - 0.5) * spread

    spheres.push(translate([x, y, z], sphere({
      radius: pointSize,
      segments: segments
    })))
  }

  return hull(spheres)
}

module.exports = { main }
