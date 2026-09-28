import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadScript, setRunConsole } = await import('./worker.js')
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
    push: (line) => list.push(line),
  }
}

describe('run console', () => {
  afterEach(() => {
    setRunConsole(null)
    delete globalThis.__runConsole
    workerState.main = undefined
  })

  it('clears the collector before the model loads and returns what the run reported', async () => {
    const c = collector()
    setRunConsole(c)
    globalThis.__runConsole = c
    c.push('stale')
    const script = [
      "globalThis.__runConsole.order.push('top')",
      "globalThis.__runConsole.push('hi from top level')",
      'module.exports = { main: () => [] }',
    ].join('\n')

    const result = await jscadScript({ script, url: 'http://project.local/console.js' })

    expect(c.order).toEqual(['reset', 'top'])
    expect(result.console).toEqual(['hi from top level'])
  })

  it('leaves console off a run that logs nothing', async () => {
    setRunConsole(collector())
    const result = await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/clean.js' })
    expect(result).not.toHaveProperty('console')
  })
})
