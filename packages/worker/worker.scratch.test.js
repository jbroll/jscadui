import { afterEach, describe, expect, it } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

const { jscadScript, currentSolids, setRunConsole } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const consoleCollector = () => {
  let list = []
  return { reset: () => (list = []), list: () => list, log: (line) => list.push(line) }
}

describe('a script with no main', () => {
  afterEach(() => {
    setRunConsole(null)
    delete globalThis.__runConsole
    workerState.main = undefined
    workerState.solids = []
  })

  it('is a scratch run: ok, its console, and the current model left in place', async () => {
    const collector = consoleCollector()
    setRunConsole(collector)
    globalThis.__runConsole = collector
    const marker = [{ id: 'previous-solid' }]
    workerState.solids = marker

    const script = "globalThis.__runConsole.log('expected volume 42')\nmodule.exports = {}"
    const result = await jscadScript({ script, url: 'http://project.local/scratch.js' })

    expect(result).toMatchObject({
      scratch: true,
      console: ['expected volume 42'],
      message: 'no main(): nothing rendered, current model unchanged',
    })
    expect(currentSolids()).toBe(marker)
  })

  it('is a scratch run for an object export with no main too', async () => {
    const result = await jscadScript({ script: 'module.exports = { size: 10 }', url: 'http://project.local/scratch2.js' })
    expect(result.scratch).toBe(true)
  })
})
