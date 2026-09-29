import { describe, expect, it, vi } from 'vitest'
import { createExport } from '../src/aiExport.js'

describe('agent export', () => {
  it('returns format and byte size without model bytes', async () => {
    const exportData = vi.fn(async () => ({ data: [new ArrayBuffer(8), new ArrayBuffer(12)] }))
    const res = await createExport(exportData)({ format: 'stl' })
    expect(exportData).toHaveBeenCalledWith({ format: 'stl' })
    expect(res).toEqual({ ok: true, format: 'stl', size: 20 })
    expect(res).not.toHaveProperty('data')
  })

  it('accepts a single buffer outside an array', async () => {
    const exportData = async () => ({ data: new ArrayBuffer(5) })
    const res = await createExport(exportData)({ format: 'obj' })
    expect(res).toEqual({ ok: true, format: 'obj', size: 5 })
  })
})
