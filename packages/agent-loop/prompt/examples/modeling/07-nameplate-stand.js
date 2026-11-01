// A 60 by 30 nameplate standing in a slotted base
// base.js
const { booleans, primitives } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid } = primitives

const makeBase = () =>
  subtract(cuboid({ size: [70, 20, 6], center: [0, 0, 3] }), cuboid({ size: [62, 3.4, 4], center: [0, 0, 6] }))

module.exports = { makeBase }

// plate.js: printed lying on its face
const { primitives } = require('@jscad/modeling')
const { cuboid } = primitives

const makePlate = () => cuboid({ size: [60, 30, 3], center: [0, 0, 1.5] })

module.exports = { makePlate }

// main.js: stands the plate on the slot floor at z = 4
const { colors, transforms } = require('@jscad/modeling')
const { colorize } = colors
const { rotateX, translate } = transforms
const { makeBase } = require('./base.js')
const { makePlate } = require('./plate.js')

const main = () => [
  colorize([0.3, 0.3, 0.35], makeBase()),
  colorize([0.9, 0.7, 0.2], translate([0, 1.5, 19], rotateX(Math.PI / 2, makePlate()))),
]

module.exports = { main }
