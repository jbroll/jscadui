// Two Cars Example - demonstrates requiring and composing hierarchical parts
// Shows how to create multiple instances of a complex part with independent parameters

const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms

const car = require('./hierarchical-car.example.js')

const main = (params) => {
  params._type = 'Two Cars'

  params.one._class = 'car1'
  params.two._class = 'car2'

  const car1 = translate([0, -12, 0], car.main(params.one))
  const car2 = translate([0, 12, 0], car.main(params.two))

  return [car1, car2]
}

module.exports = { main }
