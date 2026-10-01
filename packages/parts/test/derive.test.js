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

  it('passes listed size names through', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(sizeNames(exports, { names: ['M3_block'] })).toEqual(['M3_block'])
  })

  it('takes the last $meta entry for a name, as the local definition overrides an included one', () => {
    const $meta = [
      { name: 'nut', kind: 'module', params: [{ name: 'included' }] },
      { name: 'nut', kind: 'module', params: [{ name: 'local' }] },
    ]
    expect(signature({ $meta }, 'nut')).toEqual({ params: [{ name: 'local' }] })
  })
})
