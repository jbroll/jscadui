/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const catalog = { entries: [
  { id: 'b/nut', family: 'nut', preferred: true, library: 'B', license: 'BSD-2-Clause', call: 'nut', summary: 'Nut B', signature: { params: [{ name: 'spec' }] }, sizes: { values: ['M3'] }, sizeNames: ['M3'], options: {}, measured: [], example: 'nut("M3")', thumb: 'thumbs/b/nut.png', require: '_catalog/B/nuts.scad', scadIncludes: ['B/std.scad', 'B/nuts.scad'] },
  { id: 'a/nut', family: 'nut', library: 'A', license: 'GPL-3.0', call: 'nut', summary: 'Nut A', signature: { params: [{ name: 'type' }] }, sizes: { list: 'nuts' }, sizeNames: ['M3_nut'], options: { nyloc: 'add the nylon insert' }, measured: [{ args: ['M3_nut', { $fn: 72 }], size: [6.4000000059604645, 5.542562589049339, 2.4] }], example: 'nut(M3_nut)', thumb: 'thumbs/a/nut.png', require: 'A/nuts.scad', scadIncludes: ['A/nuts.scad'] },
  { id: 'a/screw', family: 'screw', library: 'A', license: 'GPL-3.0', call: 'screw', summary: 'Screw A', signature: { params: [{ name: 'type' }, { name: 'length' }] }, sizes: { names: ['M3_cap_screw'] }, insertArgs: [10], sizeNames: ['M3_cap_screw'], options: {}, measured: [], example: 'screw(M3_cap_screw, 10)', thumb: 'thumbs/a/screw.png', require: '_catalog/A/screw.scad', scadIncludes: ['A/core.scad', 'A/screw.scad'] },
] }

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog) }))
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('parts browser', () => {
  it('lists a family card with the preferred entry first', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    const names = [...document.querySelectorAll('.parts-entry')].map((e) => e.textContent)
    expect(names[0]).toContain('B')
    expect(document.querySelector('.parts-license').textContent).toContain('BSD-2-Clause')
  })

  it('inserts the selected size into the editor', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    const applyEdit = vi.fn()
    const editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
    await flush()
    document.querySelectorAll('.parts-entry')[1].click()
    document.querySelector('.parts-insert').click()
    expect(applyEdit).toHaveBeenCalledOnce()
    expect(applyEdit.mock.calls[0][0].changes.map((c) => c.insert).join('')).toContain('nut(M3_nut)')
  })

  it('shows an error when the catalog is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    expect(document.querySelector('.parts-error')).not.toBeNull()
  })

  it('fetches the catalog again after a failed fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog) })
    vi.stubGlobal('fetch', fetchMock)
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.parts-entry')).not.toBeNull()
  })

  it('shows measured arguments as call text and sizes to 0.01 mm', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    document.querySelectorAll('.parts-entry')[1].click()
    expect(document.querySelector('.parts-measured li').textContent).toBe('M3_nut, {"$fn":72} → 6.4 × 5.54 × 2.4 mm')
  })

  it('inserts a sizes.names entry as an identifier followed by its insertArgs', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    const applyEdit = vi.fn()
    const editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
    await flush()
    document.querySelectorAll('.parts-entry')[2].click()
    document.querySelector('.parts-insert').click()
    const inserted = applyEdit.mock.calls[0][0].changes.map((c) => c.insert).join('')
    expect(inserted).toContain("const { screw, M3_cap_screw } = require('_catalog/A/screw.scad')")
    expect(inserted).toContain('screw(M3_cap_screw, 10)')
  })

  it('disables Insert and shows a not-ready note when no editor is available', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    document.querySelectorAll('.parts-entry')[0].click()
    const insertBtn = document.querySelector('.parts-insert')
    expect(insertBtn.disabled).toBe(true)
    expect(document.querySelector('.parts-not-ready')).not.toBeNull()
    expect(() => insertBtn.click()).not.toThrow()
  })

  it('inserts a numeric sizes.values entry as a bare number', async () => {
    const motorCatalog = { entries: [
      { id: 'a/motor', family: 'motor', library: 'A', license: 'MIT', call: 'nema_stepper_motor', summary: 'NEMA stepper', signature: { params: [{ name: 'size' }] }, sizes: { values: [17] }, sizeNames: [17], options: {}, measured: [], example: 'nema_stepper_motor(17)', thumb: 'thumbs/a/motor.png', require: 'A/motor.scad', scadIncludes: ['A/motor.scad'] },
    ] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(motorCatalog) }))
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    const applyEdit = vi.fn()
    const editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
    await flush()
    document.querySelector('.parts-entry').click()
    document.querySelector('.parts-insert').click()
    expect(applyEdit.mock.calls[0][0].changes.map((c) => c.insert).join('')).toContain('nema_stepper_motor(17)')
  })

  it('inserts a string sizes.values entry as a quoted JSON literal', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    const applyEdit = vi.fn()
    const editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
    await flush()
    document.querySelectorAll('.parts-entry')[0].click() // entry B: preferred, sizes.values
    document.querySelector('.parts-insert').click()
    expect(applyEdit.mock.calls[0][0].changes.map((c) => c.insert).join('')).toContain('nut("M3")')
  })

  it('keeps catalog order for a family with no preferred entry', async () => {
    const noPreferred = { entries: [
      { id: 'x/washer', family: 'washer', library: 'X', license: 'MIT', call: 'washer', summary: 'Washer X', signature: { params: [{ name: 'size' }] }, sizes: { list: 'washers' }, sizeNames: ['M3_washer'], options: {}, measured: [], example: 'washer(M3_washer)', thumb: 'thumbs/x/washer.png', require: 'X/washer.scad', scadIncludes: ['X/washer.scad'] },
      { id: 'y/washer', family: 'washer', library: 'Y', license: 'MIT', call: 'washer', summary: 'Washer Y', signature: { params: [{ name: 'size' }] }, sizes: { list: 'washers' }, sizeNames: ['M3_washer'], options: {}, measured: [], example: 'washer(M3_washer)', thumb: 'thumbs/y/washer.png', require: 'Y/washer.scad', scadIncludes: ['Y/washer.scad'] },
    ] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(noPreferred) }))
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    const names = [...document.querySelectorAll('.parts-entry')].map((e) => e.textContent)
    expect(names[0]).toContain('X')
    expect(names[1]).toContain('Y')
  })
})
