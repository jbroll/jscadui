/**
 * Car with Legacy Wheels - demonstrates using legacy parts with the params proxy system
 *
 * This example shows how to use wrapLegacyModule to seamlessly integrate
 * legacy JSCAD parts (that use getParameterDefinitions) into the new
 * hierarchical parameter system.
 *
 * Run with ?proxy=1 to enable params proxy mode
 */

const jscad = require('@jscad/modeling')
const { cuboid, cylinder } = jscad.primitives
const { union } = jscad.booleans
const { colorize, hexToRgb } = jscad.colors
const { translate, rotateX } = jscad.transforms

// Import the legacy wheel module and wrap it
const { wrapLegacyModule } = require('@jscadui/params-core')
const LegacyWheelModule = require('./legacy-wheel.js')
const Wheel = wrapLegacyModule(LegacyWheelModule)

// Main car model
const main = (params) => {
  // Car body parameters
  params.wheelbase = params.wheelbase ?? { default: 14, min: 8, max: 24, step: 1 }
  params.bodyWidth = params.bodyWidth ?? { default: 6, min: 4, max: 12, step: 0.5 }
  params.bodyHeight = params.bodyHeight ?? { default: 3, min: 2, max: 6, step: 0.5 }
  params.bodyLength = params.bodyLength ?? { default: 16, min: 10, max: 30, step: 1 }
  params.groundClearance = params.groundClearance ?? { default: 2, min: 0.5, max: 5, step: 0.5 }
  params.bodyColor = params.bodyColor ?? { default: '#cc3333', type: 'color' }

  // Define wheel sub-parts with types and classes
  // The Wheel function will merge legacy defs for any missing properties
  params.frontLeft = params.frontLeft ?? {}
  params.frontLeft._type = 'Wheel'
  params.frontLeft._class = params.frontLeft._class ?? 'front-wheels'

  params.frontRight = params.frontRight ?? {}
  params.frontRight._type = 'Wheel'
  params.frontRight._class = params.frontRight._class ?? 'front-wheels'

  params.rearLeft = params.rearLeft ?? {}
  params.rearLeft._type = 'Wheel'
  params.rearLeft._class = params.rearLeft._class ?? 'rear-wheels'

  params.rearRight = params.rearRight ?? {}
  params.rearRight._type = 'Wheel'
  params.rearRight._class = params.rearRight._class ?? 'rear-wheels'

  // Get actual values
  const wheelbase = params.wheelbase
  const bodyWidth = params.bodyWidth
  const bodyHeight = params.bodyHeight
  const bodyLength = params.bodyLength
  const groundClearance = params.groundClearance
  const bodyColor = params.bodyColor

  // Get wheel radius to calculate positions
  const wheelRadius = params.frontLeft.radius ?? 3
  const wheelY = bodyWidth / 2 + 0.5 // offset from center

  // Car body
  const body = colorize(
    hexToRgb(bodyColor),
    translate(
      [0, 0, groundClearance + bodyHeight / 2],
      cuboid({ size: [bodyLength, bodyWidth, bodyHeight] })
    )
  )

  // Cabin (smaller box on top)
  const cabinLength = bodyLength * 0.5
  const cabinHeight = bodyHeight * 0.6
  const cabin = colorize(
    hexToRgb(bodyColor),
    translate(
      [bodyLength * 0.1, 0, groundClearance + bodyHeight + cabinHeight / 2],
      cuboid({ size: [cabinLength, bodyWidth - 0.5, cabinHeight] })
    )
  )

  // Position wheels
  const frontX = wheelbase / 2
  const rearX = -wheelbase / 2
  const wheelZ = groundClearance

  // Create wheels using the wrapped legacy module
  // The Wheel function automatically handles legacy parameter definitions
  const frontLeftWheel = translate(
    [frontX, wheelY, wheelZ],
    rotateX(Math.PI / 2, Wheel(params.frontLeft))
  )

  const frontRightWheel = translate(
    [frontX, -wheelY, wheelZ],
    rotateX(Math.PI / 2, Wheel(params.frontRight))
  )

  const rearLeftWheel = translate(
    [rearX, wheelY, wheelZ],
    rotateX(Math.PI / 2, Wheel(params.rearLeft))
  )

  const rearRightWheel = translate(
    [rearX, -wheelY, wheelZ],
    rotateX(Math.PI / 2, Wheel(params.rearRight))
  )

  return [
    body,
    cabin,
    frontLeftWheel,
    frontRightWheel,
    rearLeftWheel,
    rearRightWheel,
  ]
}

module.exports = { main }
