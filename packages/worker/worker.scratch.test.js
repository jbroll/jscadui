import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAllCaches, requireCache } from '@jscadui/require'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

const { jscadMain, jscadScript, currentSolids, setModelIsolation, setRunConsole, setRunSummary } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const consoleCollector = () => {
  let list = []
  return { reset: () => (list = []), list: () => list, log: (line) => list.push(line) }
}

const reset = () => {
  setModelIsolation(null)
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

describe("a scratch run calling a project module's main", () => {
  const PROJECT = {
    'http://project.local/main.js':
      "module.exports = { main: (params) => { params.width = { type: 'slider', default: 60 }; params.depth = { type: 'slider', default: 20 }; return [{ width: params.width, depth: params.depth }] } }",
  }

  beforeEach(() => {
    globalThis.self.location = { origin: 'http://project.local' }
    globalThis.XMLHttpRequest = class {
      open(_method, url) {
        this.url = url
      }
      send() {
        this.status = this.url in PROJECT ? 200 : 404
        this.responseText = PROJECT[this.url]
      }
    }
  })

  afterEach(() => {
    reset()
    delete globalThis.XMLHttpRequest
    delete globalThis.self.location
    clearAllCaches()
  })

  it('hands it the values given over its defaults, as a build would', async () => {
    const seen = []
    setRunSummary((run) => {
      seen.push(run)
      return {}
    })
    const script = "const { main } = require('./main.js')\nmodule.exports = { main: () => main({ width: 30 }) }"
    await jscadScript({ script, url: 'http://project.local/__run__.js', base: 'http://project.local/', root: 'http://project.local/', scratch: true })
    expect(seen[0].value).toEqual([{ width: 30, depth: 20 }])
  })

  it('leaves the project module cache as it found it', async () => {
    const before = { ...requireCache.local }
    await jscadScript({ script: "require('./main.js')\nmodule.exports = {}", url: 'http://project.local/__run__.js', base: 'http://project.local/', root: 'http://project.local/', scratch: true })
    expect({ ...requireCache.local }).toEqual(before)
  })
})

describe('module state a model sets up (setModelIsolation)', () => {
  const text = { state: null }
  const MODEL = "globalThis.__text.state = 'model'\nmodule.exports = { main: () => [{ id: String(globalThis.__text.state) }] }"
  const NO_SETUP = 'module.exports = { main: () => [{ id: String(globalThis.__text.state) }] }'

  beforeEach(() => {
    globalThis.__text = text
    text.state = null
    setModelIsolation(() => {
      const saved = text.state
      text.state = null
      return () => {
        text.state = saved
      }
    })
  })

  afterEach(() => {
    reset()
    delete globalThis.__text
  })

  it('starts every load clean, so a build never sees what a scratch run set up', async () => {
    await jscadScript({ script: "globalThis.__text.state = 'run'\nmodule.exports = {}", url: 'http://project.local/__run__.js', scratch: true })
    await jscadScript({ script: NO_SETUP, url: 'http://project.local/main.js' })
    expect(currentSolids()).toEqual([{ id: 'null' }])
  })

  it("puts the loaded model's setup back after a scratch run, so a param change still runs", async () => {
    await jscadScript({ script: MODEL, url: 'http://project.local/main.js' })
    await jscadScript({ script: "globalThis.__text.state = 'run'\nmodule.exports = {}", url: 'http://project.local/__run__.js', scratch: true })
    expect(text.state).toBe('model')
    await jscadMain({ params: {}, stream: false })
    expect(currentSolids()).toEqual([{ id: 'model' }])
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
    await expect(jscadScript({ script: 'module.exports = {}', url: 'http://project.local/editor.js' })).rejects.toMatchObject({ name: 'NoMainError', message: 'no main function exported' })
  })
})
