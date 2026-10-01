/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controller ruling: sizeNames hold RAW values; the browser formats the call
// argument from `sizes.list` (identifier) vs `sizes.values` (JSON literal).
const catalog = { entries: [
  { id: 'b/nut', family: 'nut', preferred: true, library: 'B', license: 'BSD-2-Clause', call: 'nut', summary: 'Nut B', signature: { params: [{ name: 'spec' }] }, sizes: { values: ['M3'] }, sizeNames: ['M3'], options: {}, measured: [], example: 'nut("M3")', thumb: 'thumbs/b/nut.png', require: '_catalog/B/nuts.scad', scadIncludes: ['B/std.scad', 'B/nuts.scad'] },
  { id: 'a/nut', family: 'nut', library: 'A', license: 'GPL-3.0', call: 'nut', summary: 'Nut A', signature: { params: [{ name: 'type' }] }, sizes: { list: 'nuts' }, sizeNames: ['M3_nut'], options: { nyloc: 'add the nylon insert' }, measured: [{ args: ['M3_nut'], size: [6.35, 5.5, 2.4] }], example: 'nut(M3_nut)', thumb: 'thumbs/a/nut.png', require: 'A/nuts.scad', scadIncludes: ['A/nuts.scad'] },
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
})
