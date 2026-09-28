// A 20mm cube with a 5mm-radius hole through it, in jscad-fluent
const jf = require('@jbroll/jscad-fluent')

const main = () => [jf.subtract(jf.cube({ size: 20 }), jf.cylinder({ radius: 5, height: 30 }))]

module.exports = { main }
