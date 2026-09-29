// A 40 by 20 by 6 plate with two 4mm mounting holes 28mm apart
const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const hole = jf.cylinder({ radius: 2, height: 10 })
  return jf.cuboid({ size: [40, 20, 6] })
    .subtract(hole.translate([-14, 0, 0]), hole.translate([14, 0, 0]))
}

module.exports = { main }
