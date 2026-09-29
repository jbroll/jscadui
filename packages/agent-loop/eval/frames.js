// Length-prefixed JSON frames: a 4-byte big-endian byte count, then that many
// bytes of UTF-8 JSON. The reader refuses a frame from its header, so a peer
// can never make the other side buffer more than `maxBytes` of one message.
const HEADER = 4

export const encodeFrame = (message) => {
  const json = JSON.stringify(message)
  if (json === undefined) throw new Error('frame: message is not JSON')
  const body = Buffer.from(json)
  const header = Buffer.alloc(HEADER)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}

// Returns `read(chunk)`. After the first violation it ignores all further input.
export const createFrameReader = ({ maxBytes, onFrame, onViolation }) => {
  let pending = Buffer.alloc(0)
  let failed = false
  const fail = (reason) => {
    failed = true
    pending = Buffer.alloc(0)
    onViolation(reason)
  }
  return (chunk) => {
    if (failed) return
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk)
    while (!failed && pending.length >= HEADER) {
      const length = pending.readUInt32BE(0)
      if (length > maxBytes) return fail(`a frame of ${length} bytes, over the ${maxBytes}-byte limit`)
      if (pending.length < HEADER + length) return
      const body = pending.subarray(HEADER, HEADER + length)
      pending = pending.subarray(HEADER + length)
      let message
      try {
        message = JSON.parse(body.toString('utf8'))
      } catch {
        return fail('a frame that is not JSON')
      }
      onFrame(message)
    }
  }
}

// Test helper: every whole frame in `bytes`.
export const decodeFrames = (bytes) => {
  const frames = []
  createFrameReader({
    maxBytes: Infinity,
    onFrame: (f) => frames.push(f),
    onViolation: (v) => {
      throw new Error(v)
    },
  })(bytes)
  return frames
}
