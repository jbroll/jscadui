// A tray with rounded edges and a rounded pocket, with a slider for the edge rounding
const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { roundedCuboid } = primitives
const { translate } = transforms

const main = (params) => {
  params._type = 'Rounded Tray'
  params.rounding = { type: 'slider', default: 3, min: 0.5, max: 5, step: 0.5, label: 'Edge rounding' }
  // The option is roundRadius; roundedCuboid ignores `radius` and falls back to 0.2.
  const outer = roundedCuboid({ size: [60, 40, 16], roundRadius: params.rounding })
  const pocket = translate([0, 0, 4], roundedCuboid({ size: [52, 32, 16], roundRadius: params.rounding }))
  return subtract(outer, pocket)
}

module.exports = { main }
