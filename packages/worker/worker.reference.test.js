import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

// The active tree bundle cannot be required under Node, so the worker's engine
// seam gets an evaluator bound to the real engine, as in worker.parts.test.js.
vi.mock('./src/treeApi.js', async () => {
  const modeling = (await import('@jscad/modeling')).default
  const { createEvaluator } = await import('@jscadui/model-tree')
  return { loadBoundEvaluate: () => createEvaluator(modeling) }
})

const { jscadMain, jscadScript, jscadExportData, setRunSummary, answerClaim } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')
const { exportableSolids } = await import('./src/exportable.js')
const { createModelTree } = await import('@jscadui/model-tree')
const { JscadToCommon } = await import('@jscadui/format-jscad')
const modeling = (await import('@jscad/modeling')).default

const tree = createModelTree(modeling)
const TAG = { reason: 'NEMA 17 stepper, purchased', allow: ['0'] }

const tagged = (node, tag = TAG) => {
  node.reference = tag
  return node
}

// Streamed solids leave no workerState.solids behind, so these read the
// solids each batch converts.
const preparedSolids = () => {
  const seen = []
  const prepare = JscadToCommon.prepare
  vi.spyOn(JscadToCommon, 'prepare').mockImplementation((solids, ...rest) => {
    seen.push(...solids)
    return prepare.call(JscadToCommon, solids, ...rest)
  })
  return seen
}

const autoClaims = () => {
  self.postMessage = vi.fn((message) => {
    if (message.method === 'jscadClaim') answerClaim({ id: message.id, won: true })
  })
}

describe('reference parts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setRunSummary(null)
    workerState.main = undefined
    workerState.claims = false
    workerState.solids = []
    self.postMessage = vi.fn()
  })

  it('a reference set on a returned tree node reaches the evaluated solid', async () => {
    workerState.main = () => [tree.primitives.cube({ size: 2 }), tagged(tree.transforms.translate([5, 0, 0], tree.primitives.cube({ size: 1 })))]

    await jscadMain({ params: {} })

    expect(workerState.solids).toHaveLength(2)
    expect(workerState.solids[0].reference).toBeUndefined()
    expect(workerState.solids[1].reference).toEqual(TAG)
  })

  it('a string reference reaches the solid of a memoized node', async () => {
    workerState.main = async () => {
      const motor = tree.primitives.cube({ size: 2 })
      await tree.measurements.measureVolume(motor)
      return [tagged(motor, 'purchased')]
    }

    await jscadMain({ params: {} })

    expect(workerState.solids.map((s) => s.reference)).toEqual(['purchased'])
  })

  it('a tag set on a part does not follow it into copies built from it later in the array', async () => {
    workerState.main = () => {
      const lid = tagged(tree.primitives.cube({ size: 2 }), 'lid')
      return [lid, tree.transforms.translate([5, 0, 0], lid), tree.colors.colorize([1, 0, 0], lid)]
    }

    await jscadMain({ params: {} })

    expect(workerState.solids.map((s) => s.reference)).toEqual(['lid', undefined, undefined])
    expect(exportableSolids(workerState.solids)).toEqual(workerState.solids.slice(1))
  })

  it('a reference reaches the solids of claimed, streamed parts', async () => {
    workerState.main = () => [tree.primitives.cube({ size: 2 }), tagged(tree.primitives.sphere({ radius: 1 }))]
    workerState.claims = true
    autoClaims()
    const seen = preparedSolids()

    const result = await jscadMain({ params: {}, runId: 4 })

    expect(result.streamed).toBe(true)
    expect(seen.map((s) => s.reference)).toEqual([undefined, TAG])
  })

  it('a reference reaches the solid of a tree node a streamed cell emits', async () => {
    workerState.main = async () => {
      await globalThis.__jscadStream.emit([tagged(tree.primitives.cube({ size: 2 }))])
      return []
    }
    const seen = preparedSolids()

    await jscadMain({ params: {}, runId: 5 })

    expect(seen.map((s) => s.reference)).toEqual([TAG])
  })

  it('a reference reaches the solids a scratch main returns', async () => {
    globalThis.__tree = tree
    const runs = []
    setRunSummary((run) => {
      runs.push(run)
      return {}
    })
    const script =
      'const t = globalThis.__tree\n' +
      'module.exports = { main: () => { const m = t.primitives.cube({ size: 2 }); m.reference = "bearing"; return [t.primitives.cube({ size: 1 }), m] } }'

    const result = await jscadScript({ script, url: 'http://project.local/__run__.js', scratch: true })

    expect(result.error).toBeUndefined()
    expect(runs[0].value.map((s) => s.reference)).toEqual([undefined, 'bearing'])
  })
})

describe('export', () => {
  const tri = () => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const solid = (extra = {}) => ({ polygons: [tri()], transforms: identity, ...extra })

  afterEach(() => {
    workerState.solids = []
  })

  it('leaves out reference parts and ghosts', async () => {
    workerState.solids = [solid(), solid({ reference: 'bearing' }), solid({ previewOnly: true })]

    const { data } = await jscadExportData({})

    const stl = new TextDecoder().decode(data[0])
    expect(stl.match(/facet normal/g)).toHaveLength(1)
    expect(workerState.solids).toHaveLength(3)
  })

  it('exportableSolids keeps only printed parts', () => {
    const printed = solid()
    expect(exportableSolids([printed, solid({ reference: { reason: 'motor' } }), solid({ previewOnly: true })])).toEqual([printed])
  })
})
