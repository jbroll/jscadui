// Hierarchical Car Example - demonstrates params-proxy pattern
// Each part declares its own parameters and type

const { cylinder, cuboid, sphere } = require('@jscad/modeling').primitives
const { translate, rotateX } = require('@jscad/modeling').transforms
const { union } = require('@jscad/modeling').booleans
const { colorize } = require('@jscad/modeling').colors

// Wheel part - declares its own parameters
const wheel = (params) => {
  params._type = 'Wheel'
  params.radius = { default: 3, min: 1, max: 8, step: 0.5 }
  params.width = { default: 1.5, min: 0.5, max: 4, step: 0.25 }
  params.hubRadius = { default: 1, min: 0.3, max: 3, step: 0.1 }

  const tire = cylinder({ radius: params.radius, height: params.width })
  const hub = colorize([0.7, 0.7, 0.7], cylinder({ radius: params.hubRadius, height: params.width + 0.1 }))

  return rotateX(Math.PI / 2, union(tire, hub))
}

// Axle part - has children (wheels)
const axle = (params) => {
  params._type = 'Axle'
  params.width = { default: 12, min: 6, max: 20, step: 1 }
  params.rodRadius = { default: 0.3, min: 0.1, max: 1, step: 0.1 }

  // Computed offsets for child wheels (hidden params)
  const halfWidth = params.width / 2
  params.left._offset = -halfWidth
  params.right._offset = halfWidth

  const rod = rotateX(Math.PI / 2, cylinder({ radius: params.rodRadius, height: params.width }))
  const leftWheel = translate([0, params.left._offset, 0], wheel(params.left))
  const rightWheel = translate([0, params.right._offset, 0], wheel(params.right))

  return [rod, leftWheel, rightWheel]
}

// Body part
const body = (params) => {
  params._type = 'Body'
  params.length = { default: 20, min: 10, max: 40, step: 1 }
  params.width = { default: 8, min: 4, max: 15, step: 0.5 }
  params.height = { default: 4, min: 2, max: 8, step: 0.5 }
  params.color = { default: [0.8, 0.2, 0.2] }

  // Cabin
  params.cabin.length = { default: 8, min: 4, max: 15, step: 0.5 }
  params.cabin.height = { default: 3, min: 1, max: 6, step: 0.25 }

  const mainBody = colorize(params.color, cuboid({ size: [params.length, params.width, params.height] }))
  const cabin = colorize(
    [0.3, 0.5, 0.8],
    translate(
      [-params.length / 4, 0, params.height / 2 + params.cabin.height / 2],
      cuboid({ size: [params.cabin.length, params.width - 1, params.cabin.height] })
    )
  )

  return union(mainBody, cabin)
}

// Main car assembly
const main = (params) => {
  params._type = 'Car'
  params.wheelbase = { default: 14, min: 8, max: 25, step: 1 }
  params.groundClearance = { default: 2, min: 1, max: 5, step: 0.25 }

  // Link front wheels together and rear wheels together
  // Editing any wheel in a class updates all wheels in that class
  params.front.left._class = 'front-wheels'
  params.front.right._class = 'front-wheels'
  params.rear.left._class = 'rear-wheels'
  params.rear.right._class = 'rear-wheels'

  const halfWheelbase = params.wheelbase / 2

  // Position axles
  const frontAxle = translate([halfWheelbase, 0, 0], axle(params.front))
  const rearAxle = translate([-halfWheelbase, 0, 0], axle(params.rear))

  // Body sits above the axles
  const carBody = translate([0, 0, params.groundClearance + 2], body(params.body))

  return [frontAxle, rearAxle, carBody]
}

module.exports = { main }
