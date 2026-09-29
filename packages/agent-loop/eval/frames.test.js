import { describe, expect, it } from 'vitest'
import { createFrameReader, decodeFrames, encodeFrame } from './frames.js'

const reader = (maxBytes) => {
  const frames = []
  const violations = []
  const read = createFrameReader({ maxBytes, onFrame: (f) => frames.push(f), onViolation: (v) => violations.push(v) })
  return { read, frames, violations }
}

describe('frames', () => {
  it('round-trips messages split and joined across chunks', () => {
    const { read, frames } = reader(1024)
    const bytes = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'é' }), encodeFrame([1, 2])])
    for (let i = 0; i < bytes.length; i += 3) read(bytes.subarray(i, i + 3))
    expect(frames).toEqual([{ a: 1 }, { b: 'é' }, [1, 2]])
    expect(decodeFrames(bytes)).toEqual(frames)
  })

  it('rejects a frame over the limit from its header, before its body arrives', () => {
    const { read, frames, violations } = reader(100)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(1e9)
    read(header)
    expect(violations).toEqual(['a frame of 1000000000 bytes, over the 100-byte limit'])
    read(Buffer.from(encodeFrame({ after: true })))
    expect(frames).toEqual([])
  })

  it('rejects a frame that is not JSON and stops reading', () => {
    const { read, frames, violations } = reader(100)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(3)
    read(Buffer.concat([header, Buffer.from('{x}'), encodeFrame({ ok: 1 })]))
    expect(violations).toEqual(['a frame that is not JSON'])
    expect(frames).toEqual([])
  })

  it('refuses to encode what JSON cannot carry', () => {
    expect(() => encodeFrame({ n: 1n })).toThrow()
    expect(() => encodeFrame(undefined)).toThrow(/not JSON/)
  })
})
