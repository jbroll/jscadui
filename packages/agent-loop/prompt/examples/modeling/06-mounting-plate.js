// A 40 by 20 by 6 plate with two 4mm mounting holes 28mm apart
const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid, cylinder } = primitives
const { translate } = transforms

const main = () => {
  const hole = cylinder({ radius: 2, height: 10 })
  return subtract(cuboid({ size: [40, 20, 6] }), translate([-14, 0, 0], hole), translate([14, 0, 0], hole))
}

module.exports = { main }
