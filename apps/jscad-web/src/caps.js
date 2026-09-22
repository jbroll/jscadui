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

/** @param {string} message */
const modelError = (message) => {
  const error = new Error(message)
  error.name = 'ModelError'
  return error
}

/**
 * @param {Array<object>} entities
 * @param {{bytes:number,entities:number}} limits
 * @returns {Array<object>}
 */
export const capGeometry = (entities, limits) => {
  if (entities.length > limits.entities) {
    throw modelError(`geometry exceeds the entity cap (${entities.length} > ${limits.entities})`)
  }
  let bytes = 0
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue
    // byteLength is buffer metadata; summing it never copies the data.
    for (const value of Object.values(entity)) {
      if (ArrayBuffer.isView(value)) bytes += value.byteLength
    }
  }
  if (bytes > limits.bytes) {
    throw modelError(`geometry exceeds the buffer cap (${bytes} > ${limits.bytes})`)
  }
  return entities
}