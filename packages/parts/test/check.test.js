import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readRecords } from '../src/records.js'
import { checkRecord } from '../bin/check.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const catalogDir = fileURLToPath(new URL('./fixtures/catalog/', import.meta.url))

describe('checkRecord', () => {
  it('passes a record whose bounding boxes match', async () => {
    const [record] = readRecords(catalogDir)
    const result = await checkRecord(record, { libsDir })
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.sizes).toEqual(['M2_block', 'M3_block'])
    expect(result.measured[0].size).toEqual([6, 6, 3])
    expect(result.transpileMs).toBeGreaterThan(0)
  })

  it('reports a bounding box outside tolerance', async () => {
    const [record] = readRecords(catalogDir)
    const bad = { ...record, checks: [{ args: ['M3_block'], size: [6, 6, 4], tol: 0.01, source: 'fixture' }] }
    const result = await checkRecord(bad, { libsDir })
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/M3_block.*z.*3.*4/)
  })

  it('reports a size that throws', async () => {
    const [record] = readRecords(catalogDir)
    const bad = { ...record, call: 'strict', sizes: { values: ['nope'] } }
    const result = await checkRecord(bad, { libsDir })
    expect(result.ok).toBe(false)
    expect(result.failures.some((f) => f.includes('nope'))).toBe(true)
  })

  it('passes a sizes.values record whose literal values build fine', async () => {
    const [record] = readRecords(catalogDir)
    const good = { ...record, sizes: { values: [[1, 2]] } }
    const result = await checkRecord(good, { libsDir })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })
})
