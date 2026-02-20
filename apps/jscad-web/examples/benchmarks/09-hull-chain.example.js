"use strict"
/**
 * Benchmark: Hull Chain
 * Tests hullChain which creates a chain of convex hulls between
 * consecutive shapes - useful for organic, flowing forms.
 *
 * This creates a worm/tentacle-like shape by chaining hulls of
 * spheres along a sinusoidal path.
 *
 * 8 spheres: Lite ~30ms
 * 12 spheres: Moderate (default) ~80ms
 * 20 spheres: Heavy ~300ms
 * 30 spheres: Brutal ~1s
 */

const jscad = require('@jscad/modeling')
const { sphere } = jscad.primitives
const { hullChain } = jscad.hulls
const { translate } = jscad.transforms

const main = (params) => {
  params._type = 'Hull Chain'
  params.count = { type: 'slider', default: 12, min: 4, max: 40, step: 2, label: 'Number of spheres' }
  params.baseRadius = { type: 'slider', default: 4, min: 2, max: 8, step: 0.5, label: 'Base radius' }
  params.radiusVariation = { type: 'slider', default: 2, min: 0, max: 4, step: 0.5, label: 'Radius variation' }
  params.spacing = { type: 'slider', default: 8, min: 4, max: 16, step: 1, label: 'Spacing' }
  params.amplitude = { type: 'slider', default: 12, min: 0, max: 25, step: 1, label: 'Wave amplitude' }
  params.frequency = { type: 'slider', default: 2, min: 0.5, max: 4, step: 0.5, label: 'Wave frequency' }
  params.segments = { type: 'slider', default: 12, min: 6, max: 24, step: 2, label: 'Sphere segments' }

  const count = params.count
  const baseRadius = params.baseRadius
  const radiusVariation = params.radiusVariation
  const spacing = params.spacing
  const amplitude = params.amplitude
  const frequency = params.frequency
  const segments = params.segments

  const shapes = []

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)  // 0 to 1

    // Position along sinusoidal path
    const x = i * spacing
    const y = Math.sin(t * Math.PI * frequency) * amplitude
    const z = Math.cos(t * Math.PI * frequency) * amplitude * 0.5

    // Radius varies along the chain (bulges in middle)
    const radius = baseRadius + Math.sin(t * Math.PI) * radiusVariation

    shapes.push(translate([x, y, z], sphere({
      radius,
      segments
    })))
  }

  return hullChain(shapes)
}

module.exports = { main }
