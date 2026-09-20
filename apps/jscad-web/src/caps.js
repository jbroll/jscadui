// Defensive caps on the geometry the frame returns, which is untrusted input.
// They are enforced before any allocation for drawing: setModel builds
// renderer buffers from these arrays.
export const DEFAULT_CAPS = {
  // A 5M-vertex mesh is roughly 1.6M triangles; beyond that the draw cost
  // alone would stall the page.
  vertices: 5_000_000,
  // 256MB of vertex/index/color buffers bounds the memory a model can claim.
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
 * @param {{vertices:number,bytes:number,entities:number}} limits
 * @returns {Array<object>}
 */
export const capGeometry = (entities, limits) => {
  if (entities.length > limits.entities) {
    throw modelError(`geometry exceeds the entity cap (${entities.length} > ${limits.entities})`)
  }
  let vertices = 0
  let bytes = 0
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue
    if (entity.vertices) vertices += entity.vertices.length / 3
    // byteLength is buffer metadata; summing it never copies the data.
    for (const value of Object.values(entity)) {
      if (ArrayBuffer.isView(value)) bytes += value.byteLength
    }
  }
  if (vertices > limits.vertices) {
    throw modelError(`geometry exceeds the vertex cap (${vertices} > ${limits.vertices})`)
  }
  if (bytes > limits.bytes) {
    throw modelError(`geometry exceeds the buffer cap (${bytes} > ${limits.bytes})`)
  }
  return entities
}