"use strict"
/**
 * Benchmark: Vase (Lathe/ExtrudeRotate)
 * Tests extrudeRotate which revolves a 2D profile around the Z axis.
 *
 * This creates a vase shape by rotating a profile curve, similar to
 * lathe operations in traditional CAD.
 *
 * 16 segments: Lite ~20ms
 * 32 segments: Moderate (default) ~50ms
 * 64 segments: Heavy ~150ms
 * 128 segments: Brutal ~500ms
 */

const jscad = require('@jscad/modeling')
const { polygon } = jscad.primitives
const { extrudeRotate } = jscad.extrusions

const main = (params) => {
  params._type = 'Vase'
  params.segments = { type: 'slider', default: 32, min: 8, max: 128, step: 4, label: 'Rotation segments' }
  params.height = { type: 'slider', default: 35, min: 20, max: 60, step: 5, label: 'Height' }
  params.baseRadius = { type: 'slider', default: 10, min: 5, max: 20, step: 1, label: 'Base radius' }
  params.neckRadius = { type: 'slider', default: 6, min: 3, max: 15, step: 1, label: 'Neck radius' }
  params.lipRadius = { type: 'slider', default: 10, min: 5, max: 20, step: 1, label: 'Lip radius' }
  params.wallThickness = { type: 'slider', default: 1.5, min: 0.5, max: 4, step: 0.5, label: 'Wall thickness' }

  const segments = params.segments
  const height = params.height
  const baseRadius = params.baseRadius
  const neckRadius = params.neckRadius
  const lipRadius = params.lipRadius
  const wallThickness = params.wallThickness

  // Create vase profile (outer and inner contours)
  // Profile points go counterclockwise from bottom-left
  const h1 = height * 0.0   // base
  const h2 = height * 0.15  // base curve
  const h3 = height * 0.45  // belly
  const h4 = height * 0.70  // neck start
  const h5 = height * 0.85  // neck
  const h6 = height * 1.0   // lip

  // Outer profile
  const outerPoints = [
    [0, h1],
    [baseRadius, h1],
    [baseRadius + 2, h2],
    [baseRadius + 3, h3],      // belly bulge
    [neckRadius, h4],
    [neckRadius - 1, h5],
    [lipRadius, h6],
    [lipRadius - wallThickness, h6],  // lip inner
  ]

  // Inner profile (offset by wall thickness)
  const innerPoints = [
    [neckRadius - 1 - wallThickness, h5],
    [neckRadius - wallThickness, h4],
    [baseRadius + 3 - wallThickness, h3],
    [baseRadius + 2 - wallThickness, h2],
    [baseRadius - wallThickness, h1 + wallThickness * 2],  // base floor
    [0, h1 + wallThickness * 2],
  ]

  // Combine into closed profile
  const profile = polygon({ points: [...outerPoints, ...innerPoints] })

  return extrudeRotate({ segments }, profile)
}

module.exports = { main }
