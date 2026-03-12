"use strict"
/**
 * Benchmark: Thin Wall + Grazing Cylinder
 * Tests near-coplanar edge cases that break BSP-based CSG.
 *
 * 32 segments: Lite (default) ~12ms
 * 128 segments: Moderate ~50ms
 * 512 segments: Heavy ~800ms
 * 2000+ segments: Brutal (minutes)
 *
 * Note: This benchmark tests numerical robustness more than
 * raw performance. Even at high segments, it completes quickly.
 * A thin-walled box is cut by a cylinder at a grazing angle.
 */

const jscad = require('@jscad/modeling')
const { cuboid, cylinder } = jscad.primitives
const { subtract } = jscad.booleans
const { rotateY } = jscad.transforms

const main = (params) => {
  params._type = 'Thin Wall'
  params.wallThickness = { type: 'slider', default: 1, min: 0.1, max: 5, step: 0.1, label: 'Wall thickness' }
  params.boxSize = { type: 'slider', default: 80, min: 20, max: 200, step: 10, label: 'Box size' }
  params.grazingAngle = { type: 'slider', default: 1, min: 0.1, max: 10, step: 0.1, label: 'Grazing angle (deg)' }
  params.cylinderRadius = { type: 'slider', default: 5, min: 1, max: 20, step: 1, label: 'Cylinder radius' }
  params.cylinderSegments = { type: 'slider', default: 32, min: 16, max: 4096, step: 16, label: 'Cylinder segments' }

  const wallThickness = params.wallThickness
  const boxSize = params.boxSize
  const grazingAngle = params.grazingAngle
  const cylinderRadius = params.cylinderRadius
  const cylinderSegments = params.cylinderSegments

  const depth = boxSize * 0.125

  // Create thin-walled box (hollow) - use cuboid for rectangular boxes
  const outerBox = cuboid({ size: [boxSize, boxSize, depth] })
  const innerBox = cuboid({
    size: [
      boxSize - wallThickness * 2,
      boxSize - wallThickness * 2,
      depth - wallThickness * 2
    ]
  })
  const wall = subtract(outerBox, innerBox)

  // Create cutting cylinder at grazing angle
  const angleRad = grazingAngle * Math.PI / 180
  const cutter = rotateY(angleRad, cylinder({
    height: boxSize * 1.5,
    radius: cylinderRadius,
    segments: cylinderSegments
  }))

  return subtract(wall, cutter)
}

module.exports = { main }
