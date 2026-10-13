import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, answerClaim } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const autoClaims = () => {
  self.postMessage = vi.fn((message) => {
    if (message.method === 'jscadClaim') answerClaim({ id: message.id, won: true })
  })
}

const tri = () => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('preview-only ghosts', () => {
  afterEach(() => {
    workerState.main = undefined
    workerState.useParamsProxy = undefined
    workerState.claims = false
    workerState.solids = []
    self.postMessage = vi.fn()
  })

  it('draws ghosts without keeping them as solids', async () => {
    const solid = { polygons: [tri()], transforms: identity }
    const ghost = { polygons: [tri()], transforms: identity, color: [0.5, 0.5, 0.5, 0.3], previewOnly: true }
    workerState.main = () => [solid, ghost]

    const result = await jscadMain({ params: {} })

    expect(result.entities).toHaveLength(2)
    expect(result.entities.some(e => e.color?.[3] === 0.3)).toBe(true)
    expect(workerState.solids).toEqual([solid])
  })

  it('streams ghosts after the parts without keeping them as solids', async () => {
    const solids = [{ polygons: [tri()], transforms: identity }, { polygons: [tri()], transforms: identity }]
    const ghost = { polygons: [tri()], transforms: identity, color: [1, 0.32, 0.32, 0.5], previewOnly: true }
    workerState.main = () => [...solids, ghost]
    workerState.claims = true
    autoClaims()

    const result = await jscadMain({ params: {}, runId: 2 })

    const cells = self.postMessage.mock.calls.filter(([message]) => message.method === 'jscadCells')
    expect(result.streamed).toBe(true)
    expect(cells).toHaveLength(3)
    expect(cells[2][0].params[0].entities.map(e => e.color?.[3])).toEqual([0.5])
    // A streamed run keeps no solids; the ghost never was one.
    expect(workerState.solids).toEqual([])
  })

  it('streams a root ghost that is not the last root child under its own claim', async () => {
    const solidA = { polygons: [tri()], transforms: identity }
    const ghost = { polygons: [tri()], transforms: identity, color: [1, 0.32, 0.32, 0.5], previewOnly: true }
    const solidB = { polygons: [tri()], transforms: identity }
    workerState.main = () => [solidA, ghost, solidB]
    workerState.claims = true

    // A real frame grants each key to one worker; a repeated key loses. The
    // ghost sits at index 1, so a trailing key computed from the retained
    // parts would collide with the solid at index 2 and drop the ghost.
    const won = new Set()
    const keys = []
    self.postMessage = vi.fn((message) => {
      if (message.method === 'jscadClaim') {
        const key = message.params[0].key
        keys.push(key)
        answerClaim({ id: message.id, won: !won.has(key) })
        won.add(key)
      }
    })

    const result = await jscadMain({ params: {}, runId: 3 })

    const cells = self.postMessage.mock.calls.filter(([message]) => message.method === 'jscadCells')
    expect(result.streamed).toBe(true)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
    expect(cells).toHaveLength(3)
    expect(cells.some(([message]) => message.params[0].entities.some(e => e.color?.[3] === 0.5))).toBe(true)
    expect(workerState.solids).toEqual([])
  })
})
