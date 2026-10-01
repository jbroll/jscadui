import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadEntry, buildPart } from '../src/load.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const record = { id: 'mini/block', file: 'Mini/mini.scad', call: 'block', sizes: { list: 'blocks' } }

describe('loadEntry', () => {
  it('requires a library file and exposes its clean exports', async () => {
    const loaded = await loadEntry(record, { libsDir })
    expect(typeof loaded.exports.block).toBe('function')
    expect(loaded.exports.vars.M3_block).toEqual([3, 6])
  })

  it('builds a part with size names resolved to their values', async () => {
    const loaded = await loadEntry(record, { libsDir })
    const { geometry } = await buildPart(loaded, record, ['M3_block', { tall: true }])
    expect(geometry).toBeTruthy()
  })
})
