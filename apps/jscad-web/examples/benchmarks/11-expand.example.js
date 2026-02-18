"use strict"
/**
 * Benchmark: 3D Expand (Offset)
 * Tests the expand operation which offsets a solid outward with
 * rounded corners.
 *
 * Expand creates a shell around the geometry at a specified distance,
 * with configurable corner treatment (round, chamfer, edge).
 *
 * Cube 8 segments: Lite ~100ms
 * Cube 16 segments: Moderate (default) ~400ms
 * Sphere 16 segments: Heavy ~2s
 * Sphere 24 segments: Brutal ~10s
 */

const jscad = require('@jscad/modeling')
const { cube, sphere } = jscad.primitives
const { expand } = jscad.expansions

const main = (params) => {
  params._type = 'Expand'
  params.shape = { type: 'choice', default: 'cube', options: ['cube', 'sphere'], label: 'Base shape' }
  params.size = { type: 'slider', default: 20, min: 10, max: 50, step: 5, label: 'Size' }
  params.delta = { type: 'slider', default: 2, min: 0.5, max: 5, step: 0.5, label: 'Expand delta' }
  params.segments = { type: 'slider', default: 12, min: 4, max: 32, step: 2, label: 'Corner segments' }
  params.corners = { type: 'choice', default: 'round', options: ['round', 'chamfer', 'edge'], label: 'Corner type' }
  params.shapeSegments = { type: 'slider', default: 16, min: 8, max: 48, step: 4, label: 'Shape segments (sphere)' }

  const shape = params.shape
  const size = params.size
  const delta = params.delta
  const segments = params.segments
  const corners = params.corners
  const shapeSegments = params.shapeSegments

  // Create base geometry
  let geometry
  if (shape === 'cube') {
    geometry = cube({ size })
  } else {
    geometry = sphere({ radius: size / 2, segments: shapeSegments })
  }

  // Expand with rounded corners
  return expand({ delta, corners, segments }, geometry)
}

module.exports = { main }
