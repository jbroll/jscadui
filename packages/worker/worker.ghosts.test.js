import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const tri = () => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('preview-only ghosts', () => {
  afterEach(() => {
    workerState.main = undefined
    workerState.useParamsProxy = undefined
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
})
