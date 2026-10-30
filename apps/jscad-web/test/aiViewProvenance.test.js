// Part provenance: a `view` look-at aims at a part by name through the anchors
// a build auto-attaches to its geometry, not through geometry indices. An index
// mapping was disproven on the real hierarchical car (11 typed param paths
// against 13 geometry items), so a name resolves through `measure({anchors:
// true})` frame origins instead. This suite drives that on the real example:
// the anchored tree stamps each part-path anchor at its primitive's creation
// centre, the evaluator carries it onto the solid, and the resolver reads it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { measure } from '@jscadui/model-tools/src/measure.js'
import { createParamsProxy, createProxyState } from '@jscadui/params-core'
import { createBuildContext, createEvaluator, createModelTree, memoFromSpecials, withBuildContext } from '@jscadui/model-tree'
import { resolveLookAt } from '@jscadui/agent-loop/src/viewParts.js'
import { createViewHandler, buildAnchorFrames } from '@jscadui/agent-loop/src/viewHandler.js'

expect.extend({
  toEqualCoordsOf(received, expected, precision = 6) {
    const ok =
      Array.isArray(received) &&
      Array.isArray(expected) &&
      received.length === expected.length &&
      received.every((n, i) => Math.abs(n - expected[i]) <= precision)
    return { pass: ok, message: () => `expected [${received}] to equal [${expected}] within ${precision}` }
  },
})

const here = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modeling = nodeRequire('@jscad/modeling')

// The example is written for the app's CommonJS example loader, so evaluate it
// the way that loader does, with a chosen '@jscad/modeling': the plain engine
// for the independent witness, the anchored tree bundle for the real path.
const loadCar = (modelingFor) => {
  const source = readFileSync(join(here, '../examples/jscad/jscad-examples/02-hierarchical-car.example.js'), 'utf8')
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jscad/modeling') return modelingFor
    throw new Error(`the example required ${name}`)
  }
  new Function('require', 'exports', 'module', source)(require, module.exports, module)
  return module.exports
}

// `main()` returns nested arrays; the worker flattens them before measuring.
const flatten = (value, out = []) => {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out)
    return out
  }
  out.push(value)
  return out
}

const newState = () => createProxyState({}, new Set(), { mode: 'hierarchical' })

// The plain engine runs the example eagerly, real geometry out: the independent
// witness that does not touch the anchor pipeline.
const plainSolidsOfCar = () => flatten(loadCar(modeling).main(createParamsProxy(newState())))

// The anchored tree builds deferred nodes; a build context tracks the
// last-touched part path and stamps it on each primitive, and the evaluator
// carries those anchors onto the solids `measure({anchors:true})` reads.
const anchoredSolidsOfCar = async () => {
  const tree = createModelTree(modeling, { anchors: true })
  const { main } = loadCar(tree)
  const ctx = createBuildContext(modeling)
  const root = await withBuildContext(ctx, async () => main(createParamsProxy(newState())))
  const { solids } = await createEvaluator(modeling)(root, memoFromSpecials(ctx))
  return solids
}

// Every named anchor origin of the real car, first name wins (a part whose
// solids all share a name keeps the first). This is what the app builds from
// the worker's `measure({anchors:true})`.
const anchorFramesOfRealCar = async () => {
  const { anchors } = measure(await anchoredSolidsOfCar(), { anchors: true })
  return buildAnchorFrames({ anchors })
}

// The body block sits on the car's centre line, lifted by main() to
// groundClearance + 2 (the example defaults: 2.5 + 2 = 4.5). Its 20x8x3.5 box
// is unique among the car's parts, so a plain build identifies it structurally
// — independent of the anchor path under test.
const independentBodyCenter = () => {
  const part = measure(plainSolidsOfCar(), { parts: 'all' }).parts.find(
    (p) => p.dimensions[0] === 20 && p.dimensions[1] === 8 && p.dimensions[2] === 3.5,
  )
  if (!part) throw new Error('no 20x8x3.5 body part in the plain car build')
  return part.center
}

describe('part-name look-at provenance (real hierarchical car)', () => {
  it('aims at the real body centre through its auto-attached anchor', async () => {
    const frames = await anchorFramesOfRealCar()
    const aim = resolveLookAt({ kind: 'lookAtPart', part: 'body' }, { anchorFrames: frames })
    expect(aim).toEqualCoordsOf(independentBodyCenter(), 1e-6)
  })

  it('names a wheel by its whole dotted path', async () => {
    const frames = await anchorFramesOfRealCar()
    // The front-left wheel's tire and hub share the path; both carry it, so the
    // first origin wins. Its centre is the axle end at [halfWheelbase, -halfWidth].
    const aim = resolveLookAt({ kind: 'lookAtPart', part: 'front.left' }, { anchorFrames: frames })
    expect(aim).toEqualCoordsOf([7, -6, 0], 1e-6)
  })

  it('errors on an unknown part name, never guessing', async () => {
    const render = async () => {
      throw new Error('the renderer must not run')
    }
    const view = createViewHandler({
      getMesh: () => [{ type: 'mesh' }],
      noGeometry: async () => null,
      render,
      measure: async () => measure(await anchoredSolidsOfCar(), { anchors: true }),
    })
    await expect(view({ views: [{ lookAt: 'ghost-part' }] })).rejects.toThrowError(/PartNotFound/)
  })
})
