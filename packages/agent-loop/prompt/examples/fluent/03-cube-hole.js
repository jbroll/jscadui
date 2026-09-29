// A 20mm cube with a 5mm-radius hole through it
const jf = require('@jbroll/jscad-fluent')

const main = () => jf.cube({ size: 20 }).subtract(jf.cylinder({ radius: 5, height: 30 }))

module.exports = { main }
