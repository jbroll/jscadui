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

  it('writes its metadata as .jscad-web.json', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p6', { 'main.js': MAIN }, { name: 'Meta', entry: 'main.js' })
    const { unzipSync, strFromU8 } = await import('fflate')
    const entries = unzipSync(await exportZip(store, 'p6'))
    expect(JSON.parse(strFromU8(entries['.jscad-web.json']))).toMatchObject({ name: 'Meta', entry: 'main.js' })
    expect(entries['.jscad-studio.json']).toBe(undefined)
  })

  it('imports a zip that carries the jscad-studio metadata name', async () => {
    const store = createLocalStorage()
    const { zipSync, strToU8 } = await import('fflate')
    const old = zipSync({
      'part.scad': strToU8('cube(5);'),
      '.jscad-studio.json': strToU8(JSON.stringify({ name: 'Old', entry: 'part.scad' })),
    })
    const imported = await importZip(store, old)
    const project = await store.readProject(imported.id)
    expect(project.files).toEqual({ 'part.scad': 'cube(5);' })
    expect(project.entry).toBe('part.scad')
  })

  it('refuses a zip with no project metadata', async () => {
    const store = createLocalStorage()
    const { zipSync, strToU8 } = await import('fflate')
    const bad = zipSync({ 'main.js': strToU8('hello') })
    await expect(importZip(store, bad)).rejects.toThrow(/metadata/)
  })
})
