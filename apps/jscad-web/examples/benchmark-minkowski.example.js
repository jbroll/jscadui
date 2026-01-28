"use strict"
/**
 * Benchmark: Minkowski Sum
 * Tests the minkowski sum operation which "inflates" a shape by another shape.
 *
 * Minkowski sum A + B is the set of all points a + b where a in A, b in B.
 * Practically: summing with a sphere rounds all edges, summing with a cube
 * chamfers them.
 *
 * This creates a 3D cross connector (like a pipe fitting) and rounds all
 * its edges uniformly using minkowski sum with a sphere.
 *
 * NOTE: minkowskiSum is a fork-only feature (@jbroll/jscad-modeling).
 *
 * 8 segment sphere: Lite ~100ms
 * 12 segment sphere: Moderate (default) ~300ms
 * 16 segment sphere: Heavy ~800ms
 * 24 segment sphere: Brutal ~3s
 */

const jscad = require('@jscad/modeling')
const { cuboid, sphere } = jscad.primitives
const { union } = jscad.booleans
const { translate, rotateY } = jscad.transforms

// Check if minkowski is available (fork-only feature)
const minkowski = jscad.minkowski

const main = (params) => {
  params._type = 'Minkowski'
  params.shape = { type: 'choice', default: 'cross', options: ['cross', 'star', 'bracket'], label: 'Base shape' }
  params.roundRadius = { type: 'slider', default: 1.5, min: 0.5, max: 4, step: 0.5, label: 'Round radius' }
  params.roundSegments = { type: 'slider', default: 10, min: 4, max: 24, step: 2, label: 'Round segments' }
  params.size = { type: 'slider', default: 30, min: 15, max: 50, step: 5, label: 'Size' }
  params.armWidth = { type: 'slider', default: 8, min: 4, max: 15, step: 1, label: 'Arm width' }

  const shape = params.shape
  const roundRadius = params.roundRadius
  const roundSegments = params.roundSegments
  const size = params.size
  const armWidth = params.armWidth

  if (!minkowski || !minkowski.minkowskiSum) {
    // Fallback message if minkowski not available
    return cuboid({ size: [size, size/4, size/4], center: [0, 0, 0] })
  }

  let baseShape

  if (shape === 'cross') {
    // 3D cross - 6-way pipe connector
    const armLength = size / 2
    baseShape = union(
      cuboid({ size: [armLength * 2, armWidth, armWidth] }),  // X axis
      cuboid({ size: [armWidth, armLength * 2, armWidth] }),  // Y axis
      cuboid({ size: [armWidth, armWidth, armLength * 2] })   // Z axis
    )
  } else if (shape === 'star') {
    // 3D star - 8 diagonal arms from center
    const armLength = size / 2
    const arms = []
    const diag = armLength * 0.7
    // Add main axis arms
    arms.push(cuboid({ size: [armLength * 2, armWidth * 0.7, armWidth * 0.7] }))
    arms.push(cuboid({ size: [armWidth * 0.7, armLength * 2, armWidth * 0.7] }))
    arms.push(cuboid({ size: [armWidth * 0.7, armWidth * 0.7, armLength * 2] }))
    // Add diagonal arms
    for (let dx of [-1, 1]) {
      for (let dy of [-1, 1]) {
        for (let dz of [-1, 1]) {
          arms.push(translate(
            [dx * diag * 0.5, dy * diag * 0.5, dz * diag * 0.5],
            cuboid({ size: [armWidth * 0.5, armWidth * 0.5, armWidth * 0.5] })
          ))
        }
      }
    }
    baseShape = union(arms)
  } else {
    // Bracket - L-shaped bracket with mounting holes represented as bumps
    const thick = armWidth * 0.6
    const legLength = size * 0.8
    const legWidth = size * 0.4
    baseShape = union(
      // Vertical leg
      cuboid({ size: [thick, legWidth, legLength], center: [0, 0, legLength/2 - thick/2] }),
      // Horizontal leg
      cuboid({ size: [thick, legWidth, thick], center: [0, 0, 0] }),
      translate([0, 0, -thick], cuboid({ size: [legLength * 0.8, legWidth, thick], center: [legLength * 0.4 - thick/2, 0, 0] })),
      // Gusset
      translate([thick/2, 0, thick/2],
        rotateY(Math.PI/4,
          cuboid({ size: [thick * 2, legWidth * 0.8, thick * 0.5] })
        )
      )
    )
  }

  // Create the rounding element (sphere for round, cube for chamfer)
  const roundingShape = sphere({ radius: roundRadius, segments: roundSegments })

  // Apply minkowski sum to round all edges
  return minkowski.minkowskiSum(baseShape, roundingShape)
}

module.exports = { main }
