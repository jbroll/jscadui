import { afterEach, describe, expect, it, vi } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

// The active tree bundle cannot be required under Node, so the worker's engine
// seam gets an evaluator bound to the real engine, as in worker.parts.test.js.
vi.mock('./src/treeApi.js', async () => {
  const modeling = (await import('@jscad/modeling')).default
  const { createEvaluator } = await import('@jscadui/model-tree')
  return { loadBoundEvaluate: () => createEvaluator(modeling) }
})

const { jscadScript, setRunSummary } = await import('./worker.js')
const { createModelTree } = await import('@jscadui/model-tree')
const modeling = (await import('@jscad/modeling')).default

const URL = 'http://project.local/__run__.js'

const runScratch = async (script) => {
  const seen = []
  setRunSummary((run) => {
    seen.push(run)
    return {}
  })
  const result = await jscadScript({ script, url: URL, scratch: true })
  return { result, run: seen[0] }
}

describe('a scratch run over lazy model-tree geometry', () => {
  globalThis.__tree = createModelTree(modeling)

  afterEach(() => setRunSummary(null))

  it('measures a tree solid in the snippet top-level code', async () => {
    const { result, run } = await runScratch('const t = globalThis.__tree\nmodule.exports = { size: t.measurements.measureDimensions(t.primitives.cube({ size: 2 })) }')
    expect(result.error).toBeUndefined()
    expect(run.value.size).toEqual([2, 2, 2])
  })

  it('measures a tree solid inside the snippet main()', async () => {
    const { result, run } = await runScratch('const t = globalThis.__tree\nmodule.exports = { main: () => ({ box: t.measurements.measureBoundingBox(t.primitives.cube({ size: 4 })) }) }')
    expect(result.error).toBeUndefined()
    expect(run.value.box).toEqual([[-2, -2, -2], [2, 2, 2]])
  })

  it('hands the summary the evaluated geometry main() returned, not tree nodes', async () => {
    const { run } = await runScratch('const t = globalThis.__tree\nmodule.exports = { main: () => [t.primitives.cube({ size: 2 }), t.transforms.translate([5, 0, 0], t.primitives.cube({ size: 1 }))] }')
    expect(run.hasMain).toBe(true)
    expect(run.value).toHaveLength(2)
    expect(run.value.every((item) => modeling.geometries.geom3.isA(item))).toBe(true)
    expect(modeling.measurements.measureBoundingBox(run.value[1])).toEqual([[4.5, -0.5, -0.5], [5.5, 0.5, 0.5]])
  })

  it('hands a single returned tree solid over evaluated as well', async () => {
    const { run } = await runScratch('const t = globalThis.__tree\nmodule.exports = { main: () => t.primitives.cube({ size: 2 }) }')
    expect(run.value).toHaveLength(1)
    expect(modeling.geometries.geom3.isA(run.value[0])).toBe(true)
  })
})
