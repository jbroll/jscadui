"use strict"
/**
 * Benchmark: Minkowski Sum (Square Frame)
 * Tests minkowski sum with a square frame - a flat cuboid with a cylindrical
 * hole cut through the center. Like the torus, the centroid lies OUTSIDE
 * the geometry (in the hollow center).
 *
 * This benchmark exposes a known issue with centroid-based tetrahedral
 * decomposition: when the centroid is outside the shape, the decomposition
 * produces incorrect or inverted tetrahedra.
 *
 * A correct implementation needs a "face-local apex" approach where each
 * face creates tetrahedra using a point offset inward along its normal,
 * rather than a single global centroid.
 */

const jscad = require('@jscad/modeling')
const { cuboid, cylinder, sphere } = jscad.primitives
const { subtract } = jscad.booleans
const { minkowski } = jscad.booleans

const getParameterDefinitions = () => [
  { name: 'frameSize', type: 'slider', initial: 30, min: 20, max: 50, step: 5, caption: 'Frame size' },
  { name: 'frameThickness', type: 'slider', initial: 4, min: 2, max: 10, step: 1, caption: 'Frame thickness' },
  { name: 'holeRadius', type: 'slider', initial: 8, min: 4, max: 15, step: 1, caption: 'Hole radius' },
  { name: 'holeSegments', type: 'slider', initial: 32, min: 16, max: 64, step: 8, caption: 'Hole segments' },
  { name: 'roundRadius', type: 'slider', initial: 1, min: 0.5, max: 3, step: 0.5, caption: 'Round radius' },
  { name: 'roundSegments', type: 'slider', initial: 8, min: 4, max: 16, step: 2, caption: 'Round segments' },
]

const main = (params) => {
  const { frameSize, frameThickness, holeRadius, holeSegments, roundRadius, roundSegments } = params

  // Create flat square prism
  const squarePrism = cuboid({
    size: [frameSize, frameSize, frameThickness]
  })

  // Create cylinder to cut the center hole
  const holeCylinder = cylinder({
    radius: holeRadius,
    height: frameThickness + 2, // slightly taller to ensure clean cut
    segments: holeSegments
  })

  // Cut the hole to create a frame - centroid is at origin, which is OUTSIDE
  // the solid (in the hole). This tests the centroid decomposition bug.
  const frame = subtract(squarePrism, holeCylinder)

  // Create sphere for rounding
  const roundingShape = sphere({ radius: roundRadius, segments: roundSegments })

  // Apply minkowski sum - this should "inflate" the frame by the sphere radius
  // Expected: all edges become rounded, hole radius decreases by roundRadius
  // Bug symptom: incorrect geometry, inverted faces, or errors
  return minkowski(frame, roundingShape)
}

module.exports = { main, getParameterDefinitions }
