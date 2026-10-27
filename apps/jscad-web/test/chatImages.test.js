import { describe, expect, it, vi } from 'vitest'
import { encodeWithin, fitWithin, imageFiles, MAX_CHAT_IMAGES, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE, prepareImage } from '../src/chatImages.js'

// A stand-in for canvas.toDataURL: its output grows with the pixel count, and
// a JPEG also with its quality, so the size steps are observable.
const fakeEncoder = ({ pngPerPixel = 1, jpegPerPixel = 1 } = {}) => {
  const calls = []
  const encode = ({ width, height }, mime, quality = 1) => {
    calls.push({ width, height, mime, quality })
    const per = mime === 'image/png' ? pngPerPixel : jpegPerPixel * quality
    return `data:${mime};base64,${'A'.repeat(Math.round(width * height * per))}`
  }
  return { encode, calls }
}

describe('fitWithin', () => {
  it('scales the long side down to the limit and never up', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_IMAGE_SIDE, height: 1176 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: MAX_IMAGE_SIDE })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('encodeWithin', () => {
  const limits = { maxSide: 100, maxChars: 5000 }

  it('keeps a small PNG as PNG', () => {
    const { encode } = fakeEncoder({ pngPerPixel: 0.2 })
    expect(encodeWithin({ width: 200, height: 100, sourceMime: 'image/png' }, encode, limits)).toMatchObject({ mime: 'image/png', width: 100, height: 50 })
  })

  it('re-encodes a PNG too large to keep, and every photo, as JPEG', () => {
    const big = fakeEncoder({ pngPerPixel: 3, jpegPerPixel: 0.5 })
    expect(encodeWithin({ width: 100, height: 100, sourceMime: 'image/png' }, big.encode, limits)).toMatchObject({ mime: 'image/jpeg', width: 100, height: 100 })
    const photo = fakeEncoder({ jpegPerPixel: 0.1 })
    expect(encodeWithin({ width: 100, height: 100, sourceMime: 'image/heic' }, photo.encode, limits).mime).toBe('image/jpeg')
    expect(photo.calls.map((c) => c.mime)).toEqual(['image/jpeg'])
  })

  it('lowers the JPEG quality, then the size, until the data URL fits', () => {
    const { encode, calls } = fakeEncoder({ jpegPerPixel: 1 })
    const out = encodeWithin({ width: 100, height: 100, sourceMime: 'image/jpeg' }, encode, { ...limits, minSide: 10 })
    expect(out.dataUrl.length).toBeLessThanOrEqual(limits.maxChars)
    expect(out.width).toBeLessThan(100)
    expect(calls[0]).toMatchObject({ width: 100, height: 100 })
    expect(new Set(calls.slice(0, 3).map((c) => c.quality)).size).toBe(3)
  })

  it('takes the mime from what the encoder produced', () => {
    const encode = () => 'data:image/png;base64,AAAA'
    expect(encodeWithin({ width: 10, height: 10, sourceMime: 'image/jpeg' }, encode, limits).mime).toBe('image/png')
  })

  it('fails when even the smallest size does not fit', () => {
    const encode = () => `data:image/jpeg;base64,${'A'.repeat(10_000)}`
    expect(() => encodeWithin({ width: 100, height: 100, sourceMime: 'image/jpeg' }, encode, limits)).toThrow(/too large/)
  })

  it('keeps four images of the default size under half the relay body limit', () => {
    expect(MAX_CHAT_IMAGES * MAX_IMAGE_CHARS).toBeLessThan(1_048_576 / 2)
  })
})

describe('prepareImage', () => {
  it('decodes, encodes within the limits and closes the bitmap', async () => {
    const bitmap = { width: 3000, height: 1500, close: vi.fn() }
    const { encode } = fakeEncoder({ jpegPerPixel: 0.01 })
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    const out = await prepareImage(file, { decode: async () => bitmap, encoder: () => encode })
    expect(out).toMatchObject({ mime: 'image/jpeg', width: MAX_IMAGE_SIDE, height: 784 })
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('refuses a file that is not an image', async () => {
    await expect(prepareImage(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/notes.txt is not an image/)
  })

  it('names the file when it cannot be decoded', async () => {
    const file = new File(['x'], 'broken.png', { type: 'image/png' })
    await expect(prepareImage(file, { decode: async () => Promise.reject(new Error('bad')) })).rejects.toThrow(/could not read broken.png/)
  })
})

describe('imageFiles', () => {
  it('keeps the image files of a file list', () => {
    const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.txt', { type: 'text/plain' })]
    expect(imageFiles(files).map((f) => f.name)).toEqual(['a.png'])
    expect(imageFiles(undefined)).toEqual([])
  })
})
