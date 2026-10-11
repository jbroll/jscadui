import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requireCache } from '@jscadui/require'

// worker.js registers self.addEventListener at import time
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('worker staleness guard', () => {
  beforeEach(() => {
    workerState.reset()
    workerState.main = undefined
    workerState.useParamsProxy = undefined
  })

  afterEach(() => {
    self.postMessage.mockClear()
    workerState.reset()
    delete globalThis.__jscadTestState
    delete requireCache.local['./modeling-bundle.js']
    delete requireCache.bundleAlias['@jscad/modeling']
  })

  describe('jscadMain', () => {
    it('rejects a run superseded by a newer script', async () => {
      workerState.main = async () => {
        workerState.nextGeneration()
        return []
      }

      await expect(jscadMain({ params: {}, stream: false })).rejects.toThrow(/superseded/)
    })

    it('names a superseded run SupersededError so the app name checks recognize it', async () => {
      workerState.main = async () => {
        workerState.nextGeneration()
        return []
      }

      const error = await jscadMain({ params: {}, stream: false }).catch((e) => e)
      expect(error.name).toBe('SupersededError')
    })
  })

  describe('jscadScript generation checks', () => {
    it('names a jscadScript superseded before its turn SupersededError', async () => {
      const script = 'module.exports = { main: () => [] }'
      // The later calls advance the generation while the earlier ones wait on
      // the script lock, so each earlier call finds itself superseded.
      const first = jscadScript({ script, url: 'http://project.local/a.js', runMain: false })
      const second = jscadScript({ script, url: 'http://project.local/b.js', runMain: false })
      const third = jscadScript({ script, url: 'http://project.local/c.js', runMain: false })

      await expect(first).rejects.toMatchObject({
        name: 'SupersededError',
        message: expect.stringContaining('superseded by newer script'),
      })
      await expect(second).rejects.toMatchObject({
        name: 'SupersededError',
        message: expect.stringContaining('superseded by newer script'),
      })
      await expect(third).resolves.toMatchObject({ def: [], params: {} })
    })

    it('names a jscadScript superseded during module load SupersededError', async () => {
      // Top-level model code runs during the require, and a newer script can
      // start in that window; the module bumps the generation itself.
      globalThis.__jscadTestState = workerState
      const script = 'globalThis.__jscadTestState.nextGeneration(); module.exports = { main: () => [] }'

      await expect(jscadScript({ script, url: 'http://project.local/m.js', runMain: false })).rejects.toMatchObject({
        name: 'SupersededError',
        message: expect.stringContaining('during module load'),
      })
    })

    it('names a jscadScript superseded during WASM initialization SupersededError', async () => {
      requireCache.bundleAlias['@jscad/modeling'] = './modeling-bundle.js'
      let resolveReady
      const ready = new Promise((r) => { resolveReady = r })
      requireCache.local['./modeling-bundle.js'] = { ready }

      const run = jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/m.js', runMain: false })
      // Let the load reach the WASM await, then start the newer script.
      await new Promise((resolve) => setTimeout(resolve, 0))
      workerState.nextGeneration()
      resolveReady()

      await expect(run).rejects.toMatchObject({
        name: 'SupersededError',
        message: expect.stringContaining('during WASM initialization'),
      })
    })
  })
})