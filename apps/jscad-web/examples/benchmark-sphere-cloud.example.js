"use strict"
/**
 * Benchmark: Sphere Union Cloud
 * Tests union scaling and BSP polygon splits.
 *
 * 50 spheres: Lite (default) ~1s
 * 150 spheres: Moderate ~5s
 * 300 spheres: Heavy ~15s
 * 500+ spheres: Brutal (minutes)
 */

const jscad = require('@jscad/modeling')
const { sphere } = jscad.primitives
const { union } = jscad.booleans
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
  params._type = 'Sphere Cloud'
  params.count = { type: 'slider', default: 50, min: 10, max: 2000, step: 10, label: 'Number of spheres' }
  params.sphereRadius = { type: 'slider', default: 6, min: 1, max: 20, step: 1, label: 'Sphere radius' }
  params.sphereSegments = { type: 'slider', default: 16, min: 8, max: 48, step: 4, label: 'Sphere segments' }
  params.cloudSize = { type: 'slider', default: 80, min: 20, max: 200, step: 10, label: 'Cloud size' }
  params.seed = { type: 'int', default: 42, min: 1, label: 'Random seed' }

  const count = params.count
  const sphereRadius = params.sphereRadius
  const sphereSegments = params.sphereSegments
  const cloudSize = params.cloudSize
  const seed = params.seed

  const rand = seededRandom(seed)
  const spheres = []

  for (let i = 0; i < count; i++) {
    spheres.push(translate(
      [(rand() - 0.5) * cloudSize, (rand() - 0.5) * cloudSize, (rand() - 0.5) * cloudSize],
      sphere({ radius: sphereRadius, segments: sphereSegments })
    ))
  }

  return union(spheres)
}

module.exports = { main }
