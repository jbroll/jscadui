// Two overlapping spheres with sliders for radius and overlap
const { booleans, primitives } = require('@jscad/modeling')
const { union } = booleans
const { sphere } = primitives

const main = (params) => {
  params._type = 'Sphere Union'
  params.radius = { type: 'slider', default: 10, min: 5, max: 30, step: 1, label: 'Sphere radius' }
  params.overlap = { type: 'slider', default: 0.8, min: 0.1, max: 1.5, step: 0.1, label: 'Overlap factor' }
  const offset = params.radius * params.overlap
  return union(
    sphere({ radius: params.radius, center: [-offset / 2, 0, 0] }),
    sphere({ radius: params.radius, center: [offset / 2, 0, 0] }),
  )
}

module.exports = { main }
