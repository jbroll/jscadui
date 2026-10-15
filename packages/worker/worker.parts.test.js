import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

// The active tree bundle URL cannot be required under vitest/Node, so the
// worker's engine seam is mocked with an evaluator bound to the real engine.
vi.mock('./src/treeApi.js', async () => {
  const modeling = (await import('@jscad/modeling')).default
  const { createEvaluator } = await import('@jscadui/model-tree')
  return { loadBoundEvaluate: () => createEvaluator(modeling) }
})

const { jscadMain, answerClaim } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')
const { createModelTree } = await import('@jscadui/model-tree')
const modeling = (await import('@jscad/modeling')).default

const tree = createModelTree(modeling)

// Records every post and answers each claim as won, the way a pool of one
// wins every part claim on the lone worker.
const capture = () => {
  const calls = []
  self.postMessage = vi.fn((message, transfer) => {
    calls.push([message, transfer])
    if (message.method === 'jscadClaim') answerClaim({ id: message.id, won: true })
  })
  return calls
}

const claimsOf = (calls) => calls.filter(([message]) => message.method === 'jscadClaim')
const cellsOf = (calls) => calls.filter(([message]) => message.method === 'jscadCells')

const tri = () => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('jscadMain parts', () => {
  beforeEach(() => {
    workerState.claims = true
  })

  afterEach(() => {
    workerState.claims = false
    workerState.main = undefined
    workerState.solids = []
    self.postMessage = vi.fn()
  })

  it('multi-part main claims each part and streams batches', async () => {
    workerState.main = () => [tree.primitives.cube({ size: 2 }), tree.primitives.sphere({ radius: 2 })]
    const calls = capture()

    const result = await jscadMain({ params: {}, runId: 11 })

    const claims = claimsOf(calls)
    expect(claims.map(([message]) => message.params[0].key)).toEqual(['0', '1'])
    expect(claims.every(([message]) => message.params[0].url === undefined)).toBe(true)
    const cells = cellsOf(calls)
    expect(cells).toHaveLength(2)
    for (const [message] of cells) expect(message.params[0].entities).toHaveLength(1)
    expect(result).toMatchObject({ entities: [], streamed: true, runId: 11 })
  })

  it('one-part main returns entities with no claims', async () => {
    workerState.main = () => [tree.primitives.cube({ size: 2 })]
    const calls = capture()

    const result = await jscadMain({ params: {}, runId: 11 })

    expect(claimsOf(calls)).toHaveLength(0)
    expect(result.streamed).toBeUndefined()
    expect(result.entities).toHaveLength(1)
  })

  it('throwing part rejects the run with no fallback', async () => {
    workerState.main = () => [
      tree.primitives.cube({ size: 2 }),
      { op: 'nope', params: {}, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null },
    ]
    const calls = capture()

    await expect(jscadMain({ params: {}, runId: 11 })).rejects.toThrow(/jscadMain failed/)
    expect(cellsOf(calls)).toHaveLength(1)
  })

  it('unsupported op rejects the run', async () => {
    workerState.main = () => [
      { op: 'nope', params: {}, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null },
    ]
    capture()

    await expect(jscadMain({ params: {}, runId: 11 })).rejects.toThrow(/jscadMain failed/)
  })

  it('anchor-merged parts and a mid-list root ghost claim distinct keys', async () => {
    const a = tree.primitives.cube({ size: 2 })
    const b = tree.primitives.cube({ size: 2 })
    const c = tree.primitives.cube({ size: 2 })
    // Children 0 and 1 merge under the attach reference, so the retained part
    // keys are '0+1' and '3'. A ghost claimed by `${parts.length}` (3) would
    // reuse child 3's key; the frame refuses the duplicate and drops the ghost.
    const placed = { op: 'attach', params: { child: b, childAnchor: { node: b, direction: [0, 0, -1] }, parent: a, parentAnchor: { node: a, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [b, a], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
    const ghost = { polygons: [tri()], transforms: identity, color: [1, 0.32, 0.32, 0.5], previewOnly: true }
    workerState.main = () => [a, placed, ghost, c]

    const won = new Set()
    const keys = []
    const calls = []
    self.postMessage = vi.fn((message, transfer) => {
      calls.push([message, transfer])
      if (message.method === 'jscadClaim') {
        const key = message.params[0].key
        keys.push(key)
        answerClaim({ id: message.id, won: !won.has(key) })
        won.add(key)
      }
    })

    const result = await jscadMain({ params: {}, runId: 12 })

    expect(result.streamed).toBe(true)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
    const cells = cellsOf(calls)
    expect(cells.filter(([message]) => message.params[0].entities.some(e => e.color?.[3] === 0.5))).toHaveLength(1)
  })

  it('evaluates a tree node a streamed cell emits before converting', async () => {
    const cube = tree.primitives.cube({ size: 2 })
    workerState.main = async () => {
      await globalThis.__jscadStream.emit([tree.transforms.translate([5, 0, 0], cube)])
      return []
    }
    const calls = capture()

    const result = await jscadMain({ params: {}, runId: 11 })

    expect(result.streamed).toBe(true)
    const cells = cellsOf(calls)
    expect(cells).toHaveLength(1)
    const [entity] = cells[0][0].params[0].entities
    expect(entity.type).not.toBe('unknown')
  })

  it('evaluates a build-time measurement through the bound evaluator', async () => {    let volume
    workerState.main = async () => {
      const cube = tree.primitives.cube({ size: 2 })
      volume = await tree.measurements.measureVolume(cube)
      return [cube, tree.primitives.cube({ size: 3 })]
    }
    capture()

    await jscadMain({ params: {}, runId: 11 })

    expect(volume).toBeCloseTo(8, 5)
  })
})
