/**
 * @param {number} id
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {number} precision
 * @param {string} [name]
 * @return {import('../xml-schema-3mf').Xml3mfMeshObject}
 */
export const genObjectWithMesh = (id, vertices, indices, precision, name) => {
  // Input validation
  if (!vertices || !(vertices instanceof Float32Array) || vertices.length === 0) {
    throw new Error('Invalid vertices: must be a non-empty Float32Array')
  }
  if (vertices.length % 3 !== 0) {
    throw new Error(`Invalid vertices length: ${vertices.length} is not divisible by 3`)
  }
  if (!indices || !(indices instanceof Uint32Array) || indices.length === 0) {
    throw new Error('Invalid indices: must be a non-empty Uint32Array')
  }
  if (indices.length % 3 !== 0) {
    throw new Error(`Invalid indices length: ${indices.length} is not divisible by 3`)
  }

  /** @type { import('../xml-schema-3mf').Xml3mfVertex[]} */
  const xmlVertex = []
  for (let i = 0; i < vertices.length; i += 3) {
    xmlVertex.push({
      '@_x': vertices[i].toPrecision(precision),
      '@_y': vertices[i + 1].toPrecision(precision),
      '@_z': vertices[i + 2].toPrecision(precision),
    })
  }

  /** @type { import('../xml-schema-3mf').Xml3mfTriangle[]} */
  const xmlTriangles = []
  for (let i = 0; i < indices.length; i += 3) {
    xmlTriangles.push({
      '@_v1': indices[i],
      '@_v2': indices[i + 1],
      '@_v3': indices[i + 2],
    })
  }

  return {
    '@_id': id,
    '@_type': 'model',
    '@_name': name,
    mesh: {
      vertices: { vertex: xmlVertex },
      triangles: { triangle: xmlTriangles },
    },
  }
}