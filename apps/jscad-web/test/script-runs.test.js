import { describe, it, expect } from 'vitest'
import { createScriptRuns, sendScript } from '../src/scriptRuns.js'

// The frame worker keeps one global file map, set by its own message, and a
// script waits on a lock before it reads files.
const fakeWorker = () => {
  let files = null
  let lock = Promise.resolve()
  return {
    jscadSetFiles: async ({ files: next }) => { files = next },
    jscadScript: async ({ entry }) => {
      const previous = lock
      let release
      lock = new Promise((resolve) => { release = resolve })
      await previous
      await Promise.resolve()
      const seen = files
      release()
      return { entry, files: seen }
    },
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('overlapping script runs', () => {
  it('draw only the run started last, whichever finishes last', async () => {
    const worker = fakeWorker()
    const runs = createScriptRuns()
    const drawn = []
    const run = async (entry, files, collectMs) => {
      const isStale = runs.load()
      await delay(collectMs)
      if (isStale()) return
      const result = await sendScript(worker, files, { entry })
      if (isStale()) return
      drawn.push(result)
    }

    await Promise.all([run('A', 'filesA', 20), run('B', 'filesB', 5)])
    expect(drawn).toEqual([{ entry: 'B', files: 'filesB' }])
  })

  it('pair a script with its own files when a newer map arrives mid-run', async () => {
    const worker = fakeWorker()
    const a = sendScript(worker, 'filesA', { entry: 'A' })
    const b = sendScript(worker, 'filesB', { entry: 'B' })
    expect(await b).toEqual({ entry: 'B', files: 'filesB' })
    await a
  })

  it('drop a param change whose main finishes after a newer script load', () => {
    const runs = createScriptRuns()
    const isStale = runs.paramChange()
    runs.load()
    expect(isStale()).toBe(true)
  })

  it('drop a param change once a newer param change starts', () => {
    const runs = createScriptRuns()
    const isStale = runs.paramChange()
    runs.paramChange()
    expect(isStale()).toBe(true)
  })

  it('keep a script load when a param change starts during it', () => {
    const runs = createScriptRuns()
    const isStale = runs.load()
    runs.paramChange()
    expect(isStale()).toBe(false)
  })

  it('keep a param change when nothing newer starts', () => {
    const runs = createScriptRuns()
    runs.load()
    const isStale = runs.paramChange()
    expect(isStale()).toBe(false)
  })
})
