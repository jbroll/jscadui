import { afterEach, describe, expect, it } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

const { jscadMain, jscadScript, currentSolids, setRunConsole } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const consoleCollector = () => {
  let list = []
  return { reset: () => (list = []), list: () => list, log: (line) => list.push(line) }
}

describe('a script with no main, run for the chat (allowScratch)', () => {
  afterEach(() => {
    setRunConsole(null)
    delete globalThis.__runConsole
    workerState.main = undefined
    workerState.solids = []
    workerState.userInteracted = new Set()
    workerState.currentUiValues = {}
  })

  it('is a scratch run: ok, its console, and the current model left in place', async () => {
    const collector = consoleCollector()
    setRunConsole(collector)
    globalThis.__runConsole = collector
    const marker = [{ id: 'previous-solid' }]
    workerState.solids = marker

    const script = "globalThis.__runConsole.log('expected volume 42')\nmodule.exports = {}"
    const result = await jscadScript({ script, url: 'http://project.local/scratch.js', allowScratch: true })

    expect(result).toMatchObject({
      scratch: true,
      console: ['expected volume 42'],
      message: 'no main(): nothing rendered, current model unchanged',
    })
    expect(currentSolids()).toBe(marker)
  })

  it('is a scratch run for an object export with no main too', async () => {
    const result = await jscadScript({ script: 'module.exports = { size: 10 }', url: 'http://project.local/scratch2.js', allowScratch: true })
    expect(result.scratch).toBe(true)
  })

  it('restores userInteracted and currentUiValues too, not just solids', async () => {
    const interacted = new Set(['width'])
    const uiValues = { width: 20 }
    workerState.userInteracted = interacted
    workerState.currentUiValues = uiValues

    await jscadScript({ script: 'module.exports = {}', url: 'http://project.local/scratch3.js', allowScratch: true })

    expect(workerState.userInteracted).toBe(interacted)
    expect(workerState.currentUiValues).toBe(uiValues)
  })

  it('leaves nothing behind for the next normal run, whose own geometry replaces the marker', async () => {
    workerState.solids = [{ id: 'previous-solid' }]
    await jscadScript({ script: 'module.exports = {}', url: 'http://project.local/scratch4.js', allowScratch: true })

    const result = await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/normal.js' })

    expect(result.scratch).toBeUndefined()
    expect(currentSolids()).toEqual([])
  })
})

describe('the loaded model after a scratch run', () => {
  const MODEL = 'module.exports = { main: (params) => [{ id: `size-${params?.size ?? 1}` }] }'

  afterEach(() => {
    workerState.main = undefined
    workerState.scriptModule = {}
    workerState.solids = []
  })

  it('keeps its main and module', async () => {
    await jscadScript({ script: MODEL, url: 'http://project.local/model.js' })
    const { main, scriptModule } = workerState
    await jscadScript({ script: 'module.exports = {}', url: 'http://project.local/model.js', allowScratch: true })
    expect(workerState.main).toBe(main)
    expect(workerState.scriptModule).toBe(scriptModule)
  })

  it('still runs a param change, the path the chat params tool takes too', async () => {
    await jscadScript({ script: MODEL, url: 'http://project.local/model.js' })
    await jscadScript({ script: 'module.exports = {}', url: 'http://project.local/scratch5.js', allowScratch: true })
    await jscadMain({ params: { size: 3 }, stream: false })
    expect(currentSolids()).toEqual([{ id: 'size-3' }])
  })
})

describe('a script with no main, run from the editor', () => {
  it('fails with an error the user sees', async () => {
    await expect(jscadScript({ script: 'module.exports = {}', url: 'http://project.local/editor.js' })).rejects.toThrow('no main function exported')
  })
})
