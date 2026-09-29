// A 10mm cube hollowed by a sphere, with a colored core inside
const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const outer = jf.cube({ size: 10 }).subtract(jf.sphere({ radius: 6.8 })).colorize([0.65, 0.25, 0.8])
  const inner = jf.sphere({ radius: 4 }).intersect(jf.cube({ size: 7 })).colorize([0.7, 0.7, 0.1])
  return [outer, inner]
}

module.exports = { main }
