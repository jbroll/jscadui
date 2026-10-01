import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadEntry } from '../src/load.js'
import { signature, sizeNames } from '../src/derive.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const record = { id: 'mini/block', file: 'Mini/mini.scad', call: 'block', sizes: { list: 'blocks' } }

describe('derive', () => {
  it('reads the signature from $meta', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(signature(exports, 'block')).toEqual({ params: [{ name: 'type' }, { name: 'tall', default: 'false' }] })
  })

  it('names sizes by identity with the list elements', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(sizeNames(exports, { list: 'blocks' })).toEqual(['M2_block', 'M3_block'])
  })

  it('passes listed size values through', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(sizeNames(exports, { values: ['M2', 'M3'] })).toEqual(['M2', 'M3'])
  })
})
