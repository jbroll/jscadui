// A 20mm cube with a 5mm-radius hole through it
const { booleans, primitives } = require('@jscad/modeling')
const { subtract } = booleans
const { cube, cylinder } = primitives

const main = () => subtract(cube({ size: 20 }), cylinder({ radius: 5, height: 30 }))

module.exports = { main }
