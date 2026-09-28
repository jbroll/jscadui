// A hex nut from a 2D outline, in jscad-fluent
const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3
    return [10 * Math.cos(a), 10 * Math.sin(a)]
  })
  // jf.polygon takes the points array itself; 2D shapes extrude with .extrudeLinear.
  const body = jf.polygon(corners).extrudeLinear({ height: 8 }).centerZ()
  return jf.subtract(body, jf.cylinder({ radius: 5, height: 10 }))
}

module.exports = { main }
