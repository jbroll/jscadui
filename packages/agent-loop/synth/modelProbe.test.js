import { describe, expect, it } from 'vitest'
import { probeModel, probeModels, shapesPng } from './modelProbe.js'

const hasImage = (messages) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))

const fakeClient = ({ textFails, imageAnswer, imageError }) => ({
  calls: [],
  async complete({ model, messages }) {
    this.calls.push({ model, image: hasImage(messages) })
    if (textFails) throw new Error(`${model}: HTTP 402: Insufficient account funds`)
    if (hasImage(messages)) {
      if (imageError) throw new Error(imageError)
      return { text: imageAnswer }
    }
    return { text: 'OK' }
  },
})

describe('probeModel', () => {
  it('text-only model is available without vision', async () => {
    const client = fakeClient({ imageError: 'beam-free: HTTP 400: Beam supports text input only' })
    expect(await probeModel(client, 'beam-free')).toEqual({ available: true, vision: false })
  })
  it('vision model names both shapes', async () => {
    const client = fakeClient({ imageAnswer: 'A red square and a blue circle.' })
    expect(await probeModel(client, 'm')).toEqual({ available: true, vision: true })
  })
  it('vision is false when an answer misses a shape', async () => {
    const client = fakeClient({ imageAnswer: 'A red square.' })
    expect((await probeModel(client, 'm')).vision).toBe(false)
  })
  it('unavailable model skips the image call', async () => {
    const client = fakeClient({ textFails: true })
    const r = await probeModel(client, 'paid')
    expect(r).toMatchObject({ available: false, vision: false })
    expect(r.error).toMatch(/Insufficient/)
    expect(client.calls.every((c) => !c.image)).toBe(true)
  })
})

describe('probeModels', () => {
  it('returns a map by model', async () => {
    const client = fakeClient({ imageAnswer: 'red square blue circle' })
    const map = await probeModels(client, ['a', 'b'])
    expect(Object.keys(map)).toEqual(['a', 'b'])
  })
})

describe('shapesPng', () => {
  it('starts with the PNG signature', () => {
    expect([...shapesPng().subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})
