// A tray with rounded edges and a rounded pocket, with a slider for the edge rounding
const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params._type = 'Rounded Tray'
  params.rounding = { type: 'slider', default: 3, min: 0.5, max: 5, step: 0.5, label: 'Edge rounding' }
  // The option is roundRadius; roundedCuboid ignores `radius` and falls back to 0.2.
  return jf.roundedCuboid({ size: [60, 40, 16], roundRadius: params.rounding })
    .subtract(jf.roundedCuboid({ size: [52, 32, 16], roundRadius: params.rounding }).translateZ(4))
}

module.exports = { main }
