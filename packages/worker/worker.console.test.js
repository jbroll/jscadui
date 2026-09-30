import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript, setRunConsole } = await import('./worker.js')
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

  it("keeps the worker's own logging out of a params-proxy run's console", async () => {
    const c = collector()
    setRunConsole(c)
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => c.push(args.join(' ')))
    workerState.useParamsProxy = true
    try {
      const result = await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/proxy.js' })
      expect(result).not.toHaveProperty('console')
    } finally {
      log.mockRestore()
      workerState.useParamsProxy = undefined
    }
  })

  it('keeps top-level lines together with the first main run of a script', async () => {
    const c = collector()
    setRunConsole(c)
    globalThis.__runConsole = c
    const script = [
      "globalThis.__runConsole.push('top')",
      "module.exports = { main: () => { globalThis.__runConsole.push('main'); return [] } }",
    ].join('\n')

    const result = await jscadScript({ script, url: 'http://project.local/both.js' })

    expect(result.console).toEqual(['top', 'main'])
  })

  it('gives a param change only its own lines, not those of a scratch run before it', async () => {
    const c = collector()
    setRunConsole(c)
    globalThis.__runConsole = c
    const model = "module.exports = { main: () => { globalThis.__runConsole.push('main ran'); return [] } }"
    await jscadScript({ script: model, url: 'http://project.local/model.js' })
    const scratch = "globalThis.__runConsole.push('scratch output')\nmodule.exports = {}"
    const scratchResult = await jscadScript({ script: scratch, url: 'http://project.local/scratch.js', scratch: true })
    expect(scratchResult.console).toEqual(['scratch output'])

    const first = await jscadMain({ params: {} })
    const second = await jscadMain({ params: {} })

    expect(first.console).toEqual(['main ran'])
    expect(second.console).toEqual(['main ran'])
  })
})
