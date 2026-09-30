import { describe, expect, it, vi } from 'vitest'
import { createExport } from '../src/aiExport.js'

describe('agent export', () => {
  it("asks the frame for binary STL for stl, and answers the format and byte size without the bytes", async () => {
    const exportData = vi.fn(async () => ({ data: [new ArrayBuffer(8), new ArrayBuffer(12)] }))
    const res = await createExport(exportData)({ format: 'stl' })
    expect(exportData).toHaveBeenCalledWith({ format: 'stlb' })
    expect(res).toEqual({ ok: true, format: 'stl', size: 20 })
    expect(res).not.toHaveProperty('data')
  })

  it('counts text chunks, and a single buffer outside an array', async () => {
    expect(await createExport(async () => ({ data: ['abc'] }))({ format: 'obj' })).toEqual({ ok: true, format: 'obj', size: 3 })
    expect(await createExport(async () => ({ data: new ArrayBuffer(5) }))({ format: '3mf' })).toEqual({ ok: true, format: '3mf', size: 5 })
  })

  it('hands the joined bytes to save and reports the path it wrote', async () => {
    const save = vi.fn(async (format) => `main.${format}`)
    const exportData = async () => ({ data: ['ab', new Uint8Array([1, 2]).buffer, 'c'] })
    const res = await createExport(exportData, { save })({ format: 'obj' })
    expect(res).toEqual({ ok: true, format: 'obj', size: 5, path: 'main.obj' })
    const [format, bytes] = save.mock.calls[0]
    expect(format).toBe('obj')
    expect([...bytes]).toEqual([0x61, 0x62, 1, 2, 0x63])
  })

  it('reports no path when save writes nothing', async () => {
    const res = await createExport(async () => ({ data: ['abc'] }), { save: async () => undefined })({ format: 'obj' })
    expect(res).toEqual({ ok: true, format: 'obj', size: 3 })
  })

  it('refuses a format with no serializer before asking the frame, as the eval does', async () => {
    const exportData = vi.fn()
    await expect(createExport(exportData)({ format: 'step' })).rejects.toMatchObject({ name: 'ExportFormatError' })
    expect(exportData).not.toHaveBeenCalled()
  })
})
