// No lock-in: every project exports as a zip of its files and imports from one.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { exportZip, importZip } from '../src/storage/zip.js'

const MAIN = 'const gear = { teeth: 12 }'

describe('zip export/import', () => {
  it('round-trips a project through export and import as a new project', async () => {
    const store = createLocalStorage()
    await store.writeFiles(
      'p5',
      { 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' },
      { message: 'original', name: 'RoundTrip', entry: 'main.js' },
    )
    const zip = await exportZip(store, 'p5')
    const imported = await importZip(store, zip)
    expect(imported.id).not.toBe('p5')
    const project = await store.readProject(imported.id)
    expect(project.files).toEqual({ 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' })
    expect(project.entry).toBe('main.js')
    expect(project.kind).toBe('jscad')
  })

  it('refuses a zip with no project metadata', async () => {
    const store = createLocalStorage()
    const { zipSync, strToU8 } = await import('fflate')
    const bad = zipSync({ 'main.js': strToU8('hello') })
    await expect(importZip(store, bad)).rejects.toThrow(/metadata/)
  })
})
