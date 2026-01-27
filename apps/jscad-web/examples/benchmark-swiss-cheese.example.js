"use strict"
/**
 * Benchmark: Swiss Cheese
 * Tests difference operations with many random sphere subtractions.
 *
 * 20 holes: Lite (default) ~0.8s
 * 100 holes: Moderate ~4s
 * 250 holes: Heavy ~10s
 * 500+ holes: Brutal (minutes)
 *
 * Uses a seeded PRNG for reproducible results.
 */

const jscad = require('@jscad/modeling')
const { cube, sphere } = jscad.primitives
const { subtract, union } = jscad.booleans
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
  params._type = 'Swiss Cheese'
  params.holes = { type: 'slider', default: 20, min: 5, max: 1000, step: 5, label: 'Number of holes' }
  params.cubeSize = { type: 'slider', default: 50, min: 20, max: 100, step: 10, label: 'Cube size' }
  params.holeRadius = { type: 'slider', default: 8, min: 3, max: 20, step: 1, label: 'Hole radius' }
  params.sphereSegments = { type: 'slider', default: 16, min: 8, max: 32, step: 4, label: 'Sphere segments' }
  params.seed = { type: 'int', default: 12345, min: 1, label: 'Random seed' }

  const holes = params.holes
  const cubeSize = params.cubeSize
  const holeRadius = params.holeRadius
  const sphereSegments = params.sphereSegments
  const seed = params.seed

  const rand = seededRandom(seed)
  const body = cube({ size: cubeSize })

  // Generate random hole positions - allow spheres to pierce surface
  const halfSize = cubeSize / 2 + holeRadius * 1.5
  const holeSpheres = []

  for (let i = 0; i < holes; i++) {
    const x = (rand() - 0.5) * 2 * halfSize
    const y = (rand() - 0.5) * 2 * halfSize
    const z = (rand() - 0.5) * 2 * halfSize

    holeSpheres.push(translate([x, y, z], sphere({
      radius: holeRadius,
      segments: sphereSegments
    })))
  }

  return subtract(body, union(holeSpheres))
}

module.exports = { main }
