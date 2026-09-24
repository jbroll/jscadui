/**
 * @param {import("@jscadui/format-common").JscadMeshEntity[]} objects 
 * @returns {string[]}
 */
export const exportStlText = (objects) => {
  const out = ['solid JSCAD\n']
  convertToStl(objects, out)
  out.push('endsolid JSCAD\n')
  return out
}

/**
 * @param {import("@jscadui/format-common").JscadMeshEntity[]} objects 
 * @param {string[]} out 
 * @returns 
 */
const convertToStl = (objects, out) => {
  objects.forEach((object, _i) => {
    convertToFacets(object, out)
  })
  return out
}

/**
 * @param {string} prefix 
 * @param {Float32Array} v 
 * @param {number} idx 
 * @returns {string}
 */
const vertexToStlString = (prefix, v, idx) => `${prefix} ${v[idx]} ${v[idx + 1]} ${v[idx + 2]}\n`

/**
 * @param {Float32Array} vertices
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {[number, number, number]}
 */
const facetNormal = (vertices, a, b, c) => {
  const ax = vertices[b] - vertices[a], ay = vertices[b + 1] - vertices[a + 1], az = vertices[b + 2] - vertices[a + 2]
  const bx = vertices[c] - vertices[a], by = vertices[c + 1] - vertices[a + 1], bz = vertices[c + 2] - vertices[a + 2]
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
  const len = Math.hypot(nx, ny, nz)
  return len === 0 ? [0, 0, 0] : [nx / len, ny / len, nz / len]
}

/**
 * @param {import("@jscadui/format-common").JscadMeshEntity} polygon
 * @param {string[]} out
 * @returns {string[]}
 */
const convertToFacets = (polygon, out) => {
  const {vertices, indices} = polygon
  const maxIndex = indices.length - 2

  // Validation logs but doesn't throw: malformed STL is preferable to
  // breaking exports outright on untrusted worker output.
  let maxVertexIndex = 0
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > maxVertexIndex) maxVertexIndex = indices[i]
  }
  const requiredVerticesLength = (maxVertexIndex + 1) * 3
  if (vertices.length < requiredVerticesLength) {
    console.error(`Invalid mesh: vertices.length=${vertices.length} < required=${requiredVerticesLength}`)
  }

  for(let i=0; i<maxIndex; i+=3){
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const [nx, ny, nz] = facetNormal(vertices, a, b, c)
    out.push(`facet normal ${nx} ${ny} ${nz}\n`)
    out.push('outer loop\n')
    out.push(vertexToStlString('vertex', vertices, a))
    out.push(vertexToStlString('vertex', vertices, b))
    out.push(vertexToStlString('vertex', vertices, c))
    out.push('endloop\nendfacet\n')
  }
  return out
}
