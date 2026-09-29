// An M10 hex nut, 17mm across flats and 8mm thick, in jscad-fluent
const jf = require('@jbroll/jscad-fluent')

// A 6-segment cylinder is a hexagonal prism; its radius is the corner radius.
const main = () =>
  jf.cylinder({ radius: 17 / Math.sqrt(3), height: 8, segments: 6 })
    .subtract(jf.cylinder({ radius: 5, height: 10 }))

module.exports = { main }
