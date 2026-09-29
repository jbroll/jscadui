// Two overlapping spheres with sliders for radius and overlap
const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params._type = 'Sphere Union'
  params.radius = { type: 'slider', default: 10, min: 5, max: 30, step: 1, label: 'Sphere radius' }
  params.overlap = { type: 'slider', default: 0.8, min: 0.1, max: 1.5, step: 0.1, label: 'Overlap factor' }
  const offset = params.radius * params.overlap
  const ball = jf.sphere({ radius: params.radius })
  return ball.translateX(-offset / 2).union(ball.translateX(offset / 2))
}

module.exports = { main }
