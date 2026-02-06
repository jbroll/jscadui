"use strict"
/**
 * Benchmark: Minkowski Sum (Torus)
 * Tests minkowski sum with a torus - a challenging case because the torus
 * centroid lies OUTSIDE the geometry (in the hollow center).
 *
 * This benchmark exposes a known issue with centroid-based tetrahedral
 * decomposition: when the centroid is outside the shape, the decomposition
 * produces incorrect or inverted tetrahedra.
 *
 * A correct implementation needs a "face-local apex" approach where each
 * face creates tetrahedra using a point offset inward along its normal,
 * rather than a single global centroid.
 *
 * 8 segment sphere: Lite ~200ms
 * 12 segment sphere: Moderate (default) ~500ms
 * 16 segment sphere: Heavy ~1.5s
 */

const jscad = require('@jscad/modeling')
const { torus, sphere } = jscad.primitives
const { minkowski } = jscad.booleans

const main = (params) => {
  params._type = 'Minkowski Torus'
  params.innerRadius = { type: 'slider', default: 8, min: 4, max: 15, step: 1, label: 'Torus inner radius' }
  params.outerRadius = { type: 'slider', default: 12, min: 8, max: 20, step: 1, label: 'Torus outer radius' }
  params.torusSegments = { type: 'slider', default: 24, min: 12, max: 48, step: 4, label: 'Torus segments' }
  params.roundRadius = { type: 'slider', default: 1, min: 0.5, max: 3, step: 0.5, label: 'Round radius' }
  params.roundSegments = { type: 'slider', default: 8, min: 4, max: 16, step: 2, label: 'Round segments' }

  const innerRadius = params.innerRadius
  const outerRadius = params.outerRadius
  const torusSegments = params.torusSegments
  const roundRadius = params.roundRadius
  const roundSegments = params.roundSegments

  // Create torus - its centroid is at origin, which is OUTSIDE the solid
  // (in the hole). This tests the centroid decomposition bug.
  const torusShape = torus({
    innerRadius: innerRadius,
    outerRadius: outerRadius,
    innerSegments: torusSegments,
    outerSegments: torusSegments
  })

  // Create sphere for rounding
  const roundingShape = sphere({ radius: roundRadius, segments: roundSegments })

  // Apply minkowski sum - this should "inflate" the torus by the sphere radius
  // Expected: outer radius increases by roundRadius, inner radius decreases by roundRadius
  // Bug symptom: incorrect geometry, inverted faces, or errors
  return minkowski(torusShape, roundingShape)
}

module.exports = { main }
