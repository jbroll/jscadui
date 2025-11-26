/**
 * Legacy Wheel Part - uses traditional getParameterDefinitions format
 * This demonstrates a part that can be used standalone or as a sub-part
 */

const jscad = require('@jscad/modeling')
const { cylinder, torus } = jscad.primitives
const { union, subtract } = jscad.booleans
const { colorize } = jscad.colors
const { translate } = jscad.transforms

const getParameterDefinitions = () => [
  { name: 'group1', type: 'group', caption: 'Wheel Dimensions' },
  { name: 'radius', type: 'number', initial: 3, min: 1, max: 10, step: 0.5, caption: 'Radius:' },
  { name: 'width', type: 'number', initial: 1.5, min: 0.5, max: 5, step: 0.25, caption: 'Width:' },
  { name: 'hubRadius', type: 'number', initial: 1, min: 0.3, max: 3, step: 0.1, caption: 'Hub Radius:' },

  { name: 'group2', type: 'group', caption: 'Appearance' },
  { name: 'spokes', type: 'int', initial: 5, min: 3, max: 12, caption: 'Spokes:' },
  { name: 'color', type: 'color', initial: '#444444', caption: 'Tire Color:' },
  { name: 'hubColor', type: 'color', initial: '#888888', caption: 'Hub Color:' },
]

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ] : [0.5, 0.5, 0.5]
}

const main = (params) => {
  const { radius = 3, width = 1.5, hubRadius = 1, spokes = 5, color = '#444444', hubColor = '#888888' } = params

  // Tire (torus)
  const tire = colorize(
    hexToRgb(color),
    torus({ innerRadius: radius - width * 0.3, outerRadius: radius, innerSegments: 16, outerSegments: 32 })
  )

  // Hub (cylinder)
  const hub = colorize(
    hexToRgb(hubColor),
    cylinder({ radius: hubRadius, height: width * 0.8, segments: 32 })
  )

  // Spokes
  const spokeGeoms = []
  const spokeWidth = 0.15
  const spokeLength = radius - hubRadius - width * 0.2
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2
    const x = Math.cos(angle) * (hubRadius + spokeLength / 2)
    const y = Math.sin(angle) * (hubRadius + spokeLength / 2)
    spokeGeoms.push(
      colorize(
        hexToRgb(hubColor),
        translate([x, y, 0],
          cylinder({ radius: spokeWidth, height: width * 0.5, segments: 8 })
        )
      )
    )
  }

  return [tire, hub, ...spokeGeoms]
}

module.exports = { main, getParameterDefinitions }
