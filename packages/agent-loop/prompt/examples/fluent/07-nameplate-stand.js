// A 60 by 30 nameplate standing in a slotted base
// base.js
const jf = require('@jbroll/jscad-fluent')

const makeBase = () =>
  jf.cuboid({ size: [70, 20, 6], center: [0, 0, 3] })
    .subtract(jf.cuboid({ size: [62, 3.4, 4], center: [0, 0, 6] }))

module.exports = { makeBase }

// plate.js: printed lying on its face
const jf = require('@jbroll/jscad-fluent')

const makePlate = () => jf.cuboid({ size: [60, 30, 3], center: [0, 0, 1.5] })

module.exports = { makePlate }

// main.js: stands the plate on the slot floor at z = 4
const { makeBase } = require('./base.js')
const { makePlate } = require('./plate.js')

const main = () => [
  makeBase().colorize([0.3, 0.3, 0.35]),
  makePlate().rotateX(Math.PI / 2).translate([0, 1.5, 19]).colorize([0.9, 0.7, 0.2]),
]

module.exports = { main }
