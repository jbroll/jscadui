"use strict"
/**
 * Benchmark: Mounting Plate with Holes
 * A realistic mechanical part - a plate with a grid of drilled holes.
 *
 * This is a common CAD operation: sequential subtracts of cylinders
 * from a base plate. Tests practical boolean performance.
 *
 * 3x3 holes: Lite ~50ms
 * 5x5 holes: Moderate (default) ~200ms
 * 7x7 holes: Heavy ~500ms
 * 10x10 holes: Brutal ~2s
 */

const jscad = require('@jscad/modeling')
const { cuboid, cylinder } = jscad.primitives
const { subtract } = jscad.booleans

const main = (params) => {
  params._type = 'Mounting Plate'
  params.holesX = { type: 'slider', default: 5, min: 2, max: 12, step: 1, label: 'Holes X' }
  params.holesY = { type: 'slider', default: 5, min: 2, max: 12, step: 1, label: 'Holes Y' }
  params.holeRadius = { type: 'slider', default: 3, min: 1, max: 6, step: 0.5, label: 'Hole radius' }
  params.holeSegments = { type: 'slider', default: 32, min: 8, max: 64, step: 4, label: 'Hole segments' }
  params.plateThickness = { type: 'slider', default: 5, min: 2, max: 15, step: 1, label: 'Plate thickness' }
  params.spacing = { type: 'slider', default: 24, min: 10, max: 40, step: 2, label: 'Hole spacing' }

  const holesX = params.holesX
  const holesY = params.holesY
  const holeRadius = params.holeRadius
  const holeSegments = params.holeSegments
  const plateThickness = params.plateThickness
  const spacing = params.spacing

  // Calculate plate size based on holes and spacing
  const plateWidth = (holesX - 1) * spacing + spacing * 2
  const plateHeight = (holesY - 1) * spacing + spacing * 2

  // Create the base plate
  let plate = cuboid({ size: [plateWidth, plateHeight, plateThickness] })

  // Calculate starting positions (centered grid)
  const startX = -((holesX - 1) * spacing) / 2
  const startY = -((holesY - 1) * spacing) / 2

  // Drill holes - sequential subtracts
  for (let x = 0; x < holesX; x++) {
    for (let y = 0; y < holesY; y++) {
      const hole = cylinder({
        radius: holeRadius,
        height: plateThickness + 2, // Extend through plate
        segments: holeSegments,
        center: [startX + x * spacing, startY + y * spacing, 0]
      })
      plate = subtract(plate, hole)
    }
  }

  return plate
}

module.exports = { main }
