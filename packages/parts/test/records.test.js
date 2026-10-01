import { describe, it, expect } from 'vitest'
import { readRecords, validateRecord } from '../src/records.js'

const rec = (over) => ({ id: 'a/nut', family: 'nut', library: 'A', license: 'MIT', file: 'A/nuts.scad', call: 'nut', summary: '', sizes: { list: 'nuts' }, example: '', checks: [], ...over })

describe('validateRecord', () => {
  it('accepts each sizes form', () => {
    for (const sizes of [{ list: 'nuts' }, { values: ['M3', 8] }, { names: ['M3_cap_screw'] }]) {
      expect(() => validateRecord(rec({ sizes }))).not.toThrow()
    }
  })

  it('refuses sizes with no form or two forms', () => {
    expect(() => validateRecord(rec({ sizes: {} }))).toThrow(/exactly one of list, values, names/)
    expect(() => validateRecord(rec({ sizes: { list: 'nuts', names: ['M3_nut'] } }))).toThrow(/exactly one/)
  })

  it('refuses sizes.names that are not identifiers', () => {
    expect(() => validateRecord(rec({ sizes: { names: ['M3 cap'] } }))).toThrow(/array of identifiers/)
  })

  it('refuses insertArgs that is not an array', () => {
    expect(() => validateRecord(rec({ insertArgs: 10 }))).toThrow(/"insertArgs" must be an array/)
  })

  it('accepts every committed catalog record', () => {
    expect(readRecords().length).toBeGreaterThan(0)
  })
})
