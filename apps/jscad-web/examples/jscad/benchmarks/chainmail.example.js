"use strict"
/**
 * Benchmark: Chainmail Pattern
 * Tests union of many interlocking torus shapes.
 *
 * 4x4 grid (16 rings): Lite (default) ~0.6s
 * 8x8 grid (64 rings): Moderate ~3s
 * 15x15 grid (225 rings): Heavy ~12s
 * 25x25+ grid: Brutal (minutes)
 *
 * This pattern stresses lazy-union optimizations and
 * tests performance with overlapping geometries.
 */

const jscad = require('@jscad/modeling')
const { torus } = jscad.primitives
const { union } = jscad.booleans
const { translate, rotateX } = jscad.transforms

const main = (params) => {
  params._type = 'Chainmail'
  params.rows = { type: 'slider', default: 4, min: 2, max: 30, step: 1, label: 'Rows' }
  params.cols = { type: 'slider', default: 4, min: 2, max: 30, step: 1, label: 'Columns' }
  params.ringRadius = { type: 'slider', default: 5, min: 3, max: 10, step: 1, label: 'Ring radius' }
  params.tubeRadius = { type: 'slider', default: 1, min: 0.5, max: 3, step: 0.5, label: 'Tube radius' }
  params.segments = { type: 'slider', default: 16, min: 8, max: 32, step: 4, label: 'Segments' }

  const rows = params.rows
  const cols = params.cols
  const ringRadius = params.ringRadius
  const tubeRadius = params.tubeRadius
  const segments = params.segments

  const spacing = ringRadius * 1.5
  const rings = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * spacing
      const y = row * spacing
      // Alternate rows are offset and rotated for interlocking
      const offset = (row % 2) * spacing / 2
      const rotation = (row + col) % 2 === 0 ? 0 : Math.PI / 2

      const ring = translate(
        [x + offset, y, 0],
        rotateX(rotation, torus({
          innerRadius: ringRadius - tubeRadius,
          outerRadius: ringRadius + tubeRadius,
          innerSegments: segments,
          outerSegments: segments
        }))
      )
      rings.push(ring)
    }
  }

  return union(rings)
}

module.exports = { main }
