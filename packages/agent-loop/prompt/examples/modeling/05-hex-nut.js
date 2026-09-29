// An M10 hex nut, 17mm across flats and 8mm thick
const { booleans, primitives } = require('@jscad/modeling')
const { subtract } = booleans
const { cylinder } = primitives

// A 6-segment cylinder is a hexagonal prism; its radius is the corner radius.
const main = () =>
  subtract(cylinder({ radius: 17 / Math.sqrt(3), height: 8, segments: 6 }), cylinder({ radius: 5, height: 10 }))

module.exports = { main }
