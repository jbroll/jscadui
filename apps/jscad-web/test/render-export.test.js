import { afterEach, describe, expect, it } from 'vitest'
import { createRenderExport } from '../src_frame/renderExport.js'
import { CAPTURES } from '../src_frame/exportParts.js'

const fakeWorker = () => {
  let preview = true
  let solids = ['preview']
  const runs = []
  return {
    runs,
    deps: {
      withSolids: (fn) => fn(solids),
      setScadPreview: (on) => { preview = on },
      currentParams: () => ({}),
      currentSolids: () => solids,
      jscadMain: async () => {
        const mode = preview ? 'preview' : 'render'
        runs.push(mode)
        solids = [mode]
        globalThis[CAPTURES] = [{ maker: 'makeA', file: 'a.js', value: mode }]
      },
    },
  }
}

describe('createRenderExport', () => {
  afterEach(() => {
    delete globalThis[CAPTURES]
  })

  it('serializes the current solids without re-running outside render mode', async () => {
    const worker = fakeWorker()

    const out = await createRenderExport(worker.deps)(false, (solids) => solids)

    expect(out).toEqual(['preview'])
    expect(worker.runs).toEqual([])
  })

  it('serializes the render run, then restores preview', async () => {
    const worker = fakeWorker()

    const out = await createRenderExport(worker.deps)(true, (solids) => solids)

    expect(out).toEqual(['render'])
    expect(worker.runs).toEqual(['render', 'preview'])
  })

  it('leaves the render run captures for the parts export, not the preview re-run', async () => {
    const worker = fakeWorker()

    await createRenderExport(worker.deps)(true, (solids) => solids)

    expect(globalThis[CAPTURES]).toEqual([{ maker: 'makeA', file: 'a.js', value: 'render' }])
  })

  it('sets no captures for a model that left none', async () => {
    const worker = fakeWorker()
    worker.deps.jscadMain = async () => {}

    await createRenderExport(worker.deps)(true, (solids) => solids)

    expect(CAPTURES in globalThis).toBe(false)
  })
})
