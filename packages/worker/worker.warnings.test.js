import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadScript, setRunWarnings } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const collector = () => {
  const order = []
  let list = []
  return {
    order,
    reset: () => {
      order.push('reset')
      list = []
    },
    list: () => list,
    warn: (w) => list.push(w),
  }
}

describe('run warnings', () => {
  afterEach(() => {
    setRunWarnings(null)
    delete globalThis.__runWarnings
    workerState.main = undefined
  })

  it('clears the collector before the model loads and returns what the run reported', async () => {
    const c = collector()
    setRunWarnings(c)
    globalThis.__runWarnings = c
    c.warn({ fn: 'stale', option: 'x', suggestions: [] })
    const script = [
      "globalThis.__runWarnings.order.push('top')",
      "globalThis.__runWarnings.warn({ fn: 'primitives.cube', option: 'sise', suggestions: ['size'] })",
      'module.exports = { main: () => [] }',
    ].join('\n')

    const result = await jscadScript({ script, url: 'http://project.local/warn.js' })

    expect(c.order).toEqual(['reset', 'top'])
    expect(result.warnings).toEqual([{ fn: 'primitives.cube', option: 'sise', suggestions: ['size'] }])
  })

  it('leaves warnings off a clean run', async () => {
    setRunWarnings(collector())
    const result = await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/clean.js' })
    expect(result).not.toHaveProperty('warnings')
  })
})
