// Defensive caps on the geometry the frame returns, which is untrusted input.
// They are enforced before any allocation for drawing: setModel builds
// renderer buffers from these arrays.
export const DEFAULT_CAPS = {
  // 256MB of vertex/index/color buffers bounds the memory a model can claim.
  // A vertex costs at least 12 bytes, so this caps vertices too, at about 22M.
  // A separate vertex cap only refused legitimate scenes: an ALL.js grid draws
  // every model of a library at once and reached 9.4M under the old 8M limit.
  bytes: 256 * 1024 * 1024,
  // A model with more parts than this is more likely a runaway loop than a
  // real design.
  entities: 2_000,
}

// A streamed grid is checked batch by batch against DEFAULT_CAPS and in total
// against these; its batches never exist in one message.
export const STREAM_CAPS = {
  bytes: 1.5 * 1024 * 1024 * 1024,
  entities: 20_000,
}

/** @param {string} message */
export const modelError = (message) => {
  const error = new Error(message)
  error.name = 'ModelError'
  return error
}

/** @param {Array<object>} entities */
export const geometryBytes = (entities) => {
  let bytes = 0
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue
    // byteLength is buffer metadata; summing it never copies the data.
    for (const value of Object.values(entity)) {
      if (ArrayBuffer.isView(value)) bytes += value.byteLength
    }
  }
  return bytes
}

const checkCount = (count, limits) => {
  if (count > limits.entities) throw modelError(`geometry exceeds the entity cap (${count} > ${limits.entities})`)
}

const checkBytes = (bytes, limits) => {
  if (bytes > limits.bytes) throw modelError(`geometry exceeds the buffer cap (${bytes} > ${limits.bytes})`)
}

const BUFFER_FIELDS = ['vertices', 'indices', 'normals', 'colors']

// Byte counting sees only typed arrays, and a fake length would stall the loops that read it.
export const checkBuffers = (entities) => {
  for (const entity of entities) {
    for (const field of BUFFER_FIELDS) {
      const value = entity[field]
      if (value != null && !ArrayBuffer.isView(value)) throw modelError(`geometry ${field} is not a typed array`)
    }
  }
}

export const checkLimits = (count, bytes, limits) => {
  checkCount(count, limits)
  checkBytes(bytes, limits)
}

/**
 * @param {Array<object>} entities
 * @param {{bytes:number,entities:number}} limits
 * @returns {Array<object>}
 */
export const capGeometry = (entities, limits) => {
  checkCount(entities.length, limits)
  checkBytes(geometryBytes(entities), limits)
  return entities
}