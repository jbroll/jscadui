import { deflateSync } from 'node:zlib'

const W = 256
const H = 128

const pixel = (x, y) => {
  if (x >= 20 && x < 100 && y >= 24 && y < 104) return [220, 20, 20]
  if ((x - 190) ** 2 + (y - 64) ** 2 < 40 ** 2) return [20, 40, 220]
  return [255, 255, 255]
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A red square left, blue circle right, as a PNG. */
export function shapesPng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const stride = 1 + W * 3
  const raw = Buffer.alloc(H * stride)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) raw.set(pixel(x, y), y * stride + 1 + x * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const seesBoth = (answer) =>
  /red/i.test(answer) && /square|rectangle/i.test(answer) && /blue/i.test(answer) && /circle/i.test(answer)

const PROBE_ATTEMPTS = 3

// A free model times out now and then; a 4xx is a refusal that a retry won't change.
const refused = (err) => /HTTP 4\d\d/.test(err.message)

export async function probeModel(client, model) {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.complete({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 2000 })
      break
    } catch (err) {
      if (refused(err) || attempt === PROBE_ATTEMPTS) return { available: false, vision: false, error: err.message }
    }
  }
  const image = `data:image/png;base64,${shapesPng().toString('base64')}`
  try {
    const { text } = await client.complete({
      model,
      maxTokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Name each shape in this image and its color, left to right. One short line.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    })
    return { available: true, vision: seesBoth(text) }
  } catch {
    return { available: true, vision: false }
  }
}

export async function probeModels(client, models) {
  const result = {}
  for (const model of models) result[model] = await probeModel(client, model)
  return result
}
