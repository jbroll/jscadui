"use strict"
/**
 * Benchmark: High-Resolution Sphere Union
 * Tests boolean union performance with high-polygon spheres.
 *
 * This is a simple but computationally intensive test - just two
 * overlapping spheres with many segments.
 *
 * 32 segments: Lite ~50ms
 * 64 segments: Moderate (default) ~300ms
 * 96 segments: Heavy ~1s
 * 128 segments: Brutal ~3s
 */

const jscad = require('@jscad/modeling')
const { sphere } = jscad.primitives
const { union } = jscad.booleans

const main = (params) => {
  params._type = 'Sphere Union'
  params.segments = { type: 'slider', default: 64, min: 16, max: 128, step: 8, label: 'Sphere segments' }
  params.radius = { type: 'slider', default: 10, min: 5, max: 30, step: 1, label: 'Sphere radius' }
  params.overlap = { type: 'slider', default: 0.8, min: 0.1, max: 1.5, step: 0.1, label: 'Overlap factor' }

  const segments = params.segments
  const radius = params.radius
  const overlap = params.overlap

  // Two overlapping spheres offset by overlap * radius
  const offset = radius * overlap

  const sphereA = sphere({ radius, segments, center: [-offset / 2, 0, 0] })
  const sphereB = sphere({ radius, segments, center: [offset / 2, 0, 0] })

  return union(sphereA, sphereB)
}

module.exports = { main }
