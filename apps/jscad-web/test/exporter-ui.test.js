/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { downloadBlob } from '@jscadui/scene'

vi.mock('@jscadui/scene', () => ({ downloadBlob: vi.fn() }))

const shell = () => {
  document.body.innerHTML = '<button id="export-button">Export</button><select id="export-format"></select>'
}

const formats = [{ id: 'stlb', label: 'STL', extension: 'stl' }]

beforeEach(() => {
  // The scene mock instance survives resetModules (mock registry is separate),
  // so clear its history here; load() re-imports exporter against fresh DOM.
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

const load = async (workerApi, opts) => {
  // Re-import per load: exporter.js captures its button at import time, and
  // shell() replaces the DOM it was bound to.
  vi.resetModules()
  shell()
  const exporter = await import('../src/exporter.js')
  await exporter.init(workerApi, opts)
  return exporter
}

describe('export button', () => {
  it('disables with Exporting… during the run and downloads under the project name', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const workerApi = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: vi.fn(async () => { await gate; return { data: [new ArrayBuffer(8)] } }),
    }
    const exporter = await load(workerApi, { onError: vi.fn() })
    exporter.exportConfig.projectName = 'bracket'
    const btn = document.getElementById('export-button')
    btn.click()
    await vi.waitFor(() => expect(btn.disabled).toBe(true))
    expect(btn.textContent).toBe('Exporting…')
    release()
    await vi.waitFor(() => expect(btn.disabled).toBe(false))
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'bracket.stl')
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toBe('Export')
  })

  it('reports a frame failure and an empty result instead of dropping them', async () => {
    const onError = vi.fn()
    const failing = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: async () => { throw new Error('frame gone') },
    }
    await load(failing, { onError })
    document.getElementById('export-button').click()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'frame gone' })))
    expect(document.getElementById('export-button').disabled).toBe(false)

    const empty = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: async () => ({}),
    }
    const onError2 = vi.fn()
    await load(empty, { onError: onError2 })
    document.getElementById('export-button').click()
    await vi.waitFor(() => expect(onError2).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/no geometry/) })))
  })
})
