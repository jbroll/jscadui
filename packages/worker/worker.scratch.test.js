import { afterEach, describe, expect, it } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

const { jscadMain, jscadScript, currentSolids, setRunConsole, setRunSummary } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const consoleCollector = () => {
  let list = []
  return { reset: () => (list = []), list: () => list, log: (line) => list.push(line) }
}

const reset = () => {
  setRunConsole(null)
  setRunSummary(null)
  delete globalThis.__runConsole
  workerState.main = undefined
  workerState.scriptModule = {}
  workerState.solids = []
  workerState.userInteracted = new Set()
  workerState.currentUiValues = {}
}

describe('a scratch run for the chat (scratch: true)', () => {
  afterEach(reset)

  it('answers its console and leaves the current model in place', async () => {
    const collector = consoleCollector()
    setRunConsole(collector)
    globalThis.__runConsole = collector
    const marker = [{ id: 'previous-solid' }]
    workerState.solids = marker

    const script = "globalThis.__runConsole.log('expected volume 42')\nmodule.exports = {}"
    const result = await jscadScript({ script, url: 'http://project.local/__run__.js', scratch: true })

    expect(result).toMatchObject({ scratch: true, console: ['expected volume 42'], warnings: [] })
    expect(currentSolids()).toBe(marker)
  })

  it('runs a main it exports and hands its value to the summary, never to the solids', async () => {
    const seen = []
    setRunSummary((run) => {
      seen.push(run)
      return { geometry: { parts: 1 } }
    })
    const marker = [{ id: 'previous-solid' }]
    workerState.solids = marker

    const result = await jscadScript({ script: 'module.exports = { main: () => [{ id: "scratch" }] }', url: 'http://project.local/__run__.js', scratch: true })

    expect(seen).toEqual([{ hasMain: true, value: [{ id: 'scratch' }] }])
    expect(result).toMatchObject({ scratch: true, geometry: { parts: 1 } })
    expect(currentSolids()).toBe(marker)
  })

  it('hands the module exports to the summary when there is no main', async () => {
    const seen = []
    setRunSummary((run) => {
      seen.push(run)
      return { returned: '{"size":10}' }
    })
    const result = await jscadScript({ script: 'module.exports = { size: 10 }', url: 'http://project.local/__run__.js', scratch: true })
    expect(seen[0]).toMatchObject({ hasMain: false, value: { size: 10 } })
    expect(result.returned).toBe('{"size":10}')
  })

  it('answers a thrown error as a scratch result with its console, and keeps the model', async () => {
    const collector = consoleCollector()
    setRunConsole(collector)
    globalThis.__runConsole = collector
    const interacted = new Set(['width'])
    workerState.userInteracted = interacted
    const marker = [{ id: 'previous-solid' }]
    workerState.solids = marker

    const script = "globalThis.__runConsole.log('before')\nmodule.exports = { main: () => { throw new RangeError('bad size') } }"
    const result = await jscadScript({ script, url: 'http://project.local/__run__.js', scratch: true })

    expect(result).toMatchObject({ scratch: true, console: ['before'], error: { name: 'RangeError', message: 'bad size' } })
    expect(typeof result.error.stack).toBe('string')
    expect(currentSolids()).toBe(marker)
    expect(workerState.userInteracted).toBe(interacted)
  })

  it('restores userInteracted and currentUiValues too, not just solids', async () => {
    const interacted = new Set(['width'])
    const uiValues = { width: 20 }
    workerState.userInteracted = interacted
    workerState.currentUiValues = uiValues

    await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/__run__.js', scratch: true })

    expect(workerState.userInteracted).toBe(interacted)
    expect(workerState.currentUiValues).toBe(uiValues)
  })
})

describe('the loaded model after a scratch run', () => {
  const MODEL = 'module.exports = { main: (params) => [{ id: `size-${params?.size ?? 1}` }] }'

  afterEach(reset)

  it('keeps its main and module', async () => {
    await jscadScript({ script: MODEL, url: 'http://project.local/model.js' })
    const { main, scriptModule } = workerState
    await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/__run__.js', scratch: true })
    expect(workerState.main).toBe(main)
    expect(workerState.scriptModule).toBe(scriptModule)
  })

  it('still runs a param change', async () => {
    await jscadScript({ script: MODEL, url: 'http://project.local/model.js' })
    await jscadScript({ script: 'module.exports = {}', url: 'http://project.local/__run__.js', scratch: true })
    await jscadMain({ params: { size: 3 }, stream: false })
    expect(currentSolids()).toEqual([{ id: 'size-3' }])
  })
})

describe('a failed load', () => {
  afterEach(reset)

  it("carries the run's console and warnings on the error", async () => {
    const collector = consoleCollector()
    setRunConsole(collector)
    globalThis.__runConsole = collector
    const script = "globalThis.__runConsole.log('got here')\nmodule.exports = { main: () => { throw new Error('boom') } }"
    const error = await jscadScript({ script, url: 'http://project.local/main.js' }).catch((e) => e)
    expect(error.message).toMatch(/boom/)
    expect(error.output).toEqual({ console: ['got here'], warnings: [] })
  })
})

describe('a script with no main, run from the editor', () => {
  it('fails with an error the user sees', async () => {
    await expect(jscadScript({ script: 'module.exports = {}', url: 'http://project.local/editor.js' })).rejects.toThrow('no main function exported')
  })
})
