import { describe, expect, it } from 'vitest'
import modeling from '@jscad/modeling'
import { createEvalBackend } from '@jscadui/agent-loop/eval/backend.js'
import { bindEvaluator, createBuildContext, createEvaluator, createModelTree, withBuildContext } from '@jscadui/model-tree'
import { partViewScript } from '../src/projectBuild.js'

const MODELING = `const { primitives } = require('@jscad/modeling')
const makeBody = () => primitives.cuboid({ size: [20, 10, 4], center: [0, 0, 2] })
const makeWheels = () => [primitives.cylinder({ radius: 3, height: 2, center: [0, 0, 1] }), [primitives.cylinder({ radius: 3, height: 2, center: [100, 0, 1] })]]
module.exports = { makeBody, makeWheels, axleDx: 12 }
`

const FLUENT = `const jf = require('@jbroll/jscad-fluent')
const makeBody = () => jf.cuboid({ size: [20, 10, 4] }).translate([0, 0, 2])
const makeLid = () => jf.cylinder({ radius: 5, height: 2 }).translate([50, 50, 1])
module.exports = { makeBody, makeLid }
`

// The part file as truck.js and its synthesized entry as main.js, which the eval builds.
const boxesOf = async (part, count) => {
  const backend = createEvalBackend()
  await backend.requestTool('write', { path: 'truck.js', content: part })
  const built = JSON.parse(await backend.requestTool('write', { path: 'main.js', content: partViewScript('truck.js') }))
  expect(built.ok, JSON.stringify(built)).toBe(true)
  const measured = JSON.parse(await backend.requestTool('measure', { parts: Array.from({ length: count }, (_, i) => String(i)) }))
  return measured.parts.map((part) => part.boundingBox)
}

describe('partViewScript', () => {
  it('lays every maker result out along +x with a 5 mm gap, flattened, keeping its y and z', async () => {
    expect(await boxesOf(MODELING, 3)).toEqual([
      [[0, -5, 0], [20, 5, 4]],
      [[25, -3, 0], [31, 3, 2]],
      [[36, -3, 0], [42, 3, 2]],
    ])
  })

  it('lays out fluent shapes the same way', async () => {
    const boxes = await boxesOf(FLUENT, 2)
    expect(boxes[0]).toEqual([[0, -5, 0], [20, 5, 4]])
    expect(boxes[1][0][0]).toBeCloseTo(25)
    expect(boxes[1][1][0]).toBeCloseTo(35)
    expect(boxes[1][0][1]).toBeCloseTo(45)
    expect(boxes[1][0][2]).toBeCloseTo(0)
  })

  it("lays out the frame's lazy tree nodes, measuring them inside the build", async () => {
    const tree = createModelTree(modeling, { anchors: true })
    const part = { makeBody: () => tree.primitives.cuboid({ size: [20, 10, 4], center: [0, 0, 2] }), makeLid: () => tree.primitives.cylinder({ radius: 5, height: 2, center: [50, 50, 1] }) }
    const module = { exports: {} }
    const shim = { '@jscad/modeling': tree, './truck.js': part }
    new Function('require', 'module', 'exports', partViewScript('truck.js'))((name) => shim[name], module, module.exports)
    const evaluate = createEvaluator(modeling)
    const ctx = createBuildContext(modeling)
    bindEvaluator(ctx, evaluate)
    const placed = await withBuildContext(ctx, () => module.exports.main({}))
    const boxes = []
    for (const node of placed) boxes.push(modeling.measurements.measureBoundingBox((await evaluate(node)).solids[0]))
    expect(boxes[0]).toEqual([[0, -5, 0], [20, 5, 4]])
    expect(boxes[1][0][0]).toBeCloseTo(25)
    expect(boxes[1][1][0]).toBeCloseTo(35)
  })

  it('shows nothing for a part file whose make* exports are not functions', async () => {
    const backend = createEvalBackend()
    await backend.requestTool('write', { path: 'truck.js', content: 'module.exports = { makeSize: 4 }' })
    const built = JSON.parse(await backend.requestTool('write', { path: 'main.js', content: partViewScript('truck.js') }))
    expect(built.ok).toBe(true)
    expect(built.geometry?.parts ?? 0).toBe(0)
  })
})
