/**
 * Format converter for Regl renderer
 * Converts common geometry format to Regl-compatible entities
 */

// Default color used for fallback
// const white = [1, 1, 1, 1]

/**
 * Create a CommonToRegl converter
 * @param {Object} options - Converter options
 * @param {boolean} options.smooth - Enable smooth shading with creased normals (default false)
 * @returns {Function} Converter function
 */
export function CommonToRegl({ smooth = false } = {}) {
  function _CSG2Regl(obj, _scene, meshColor) {
    let { vertices, indices = [], normals, color = meshColor, colors, isTransparent = false } = obj
    const { transforms } = obj
    const objType = obj.type || 'mesh'

    const visuals = {
      show: true,
      color,
      transparent: isTransparent || (color?.length > 3 && color[3] < 1),
      useVertexColors: !!(colors && colors.length)
    }

    // Handle instanced geometry
    if (objType === 'instance') {
      return handleInstance(obj, visuals, meshColor)
    }

    // For meshes: if no normals, let GPU compute flat normals via dFdx/dFdy
    // For lines: create default up-facing normals (needed for line rendering)
    if (!normals && objType === 'lines') {
      normals = createDefaultNormals(vertices)
    }

    // Apply smooth shading if enabled and we have mesh geometry with normals
    if (smooth && objType === 'mesh' && normals && indices && indices.length) {
      const smoothed = toCreasedNormals(vertices, indices, normals, Math.PI / 10)
      vertices = smoothed.vertices
      normals = smoothed.normals
      indices = null // Non-indexed after smoothing
    }

    const geometry = { positions: vertices, transforms }

    if (indices && indices.length) geometry.indices = indices
    if (normals) geometry.normals = normals

    // Handle vertex colors
    let _colors
    if (colors && colors.length) {
      _colors = ensureRGBAColors(colors, vertices.length / 3)
    }

    switch (objType) {
      case 'mesh':
        visuals.drawCmd = 'drawMesh'
        if (_colors) {
          geometry.colors = _colors
        }
        break

      case 'line':
        // Continuous line strip (arc, line primitives)
        visuals.drawCmd = 'drawLineStrip'
        if (!normals) {
          geometry.normals = createDefaultNormals(vertices)
        }
        if (color) geometry.color = color
        if (_colors) {
          geometry.colors = _colors
        }
        break

      case 'lines':
        visuals.drawCmd = 'drawLines'
        if (!indices || !indices.length) {
          // Create sequential indices without mutating input
          const len = Math.floor(vertices.length / 3)
          geometry.indices = Array.from({ length: len }, (_, i) => i)
        }
        if (color) geometry.color = color
        if (_colors) {
          geometry.colors = _colors
        }
        break
    }

    return { geometry, visuals, transparent: visuals.transparent }
  }

  /**
   * Handle instanced geometry
   */
  function handleInstance(obj, visuals, meshColor) {
    const { vertices, indices, normals, color = meshColor, list } = obj

    if (!list || !list.length) {
      console.error('Instance geometry missing list of transforms')
      return null
    }

    // Create default normals if needed
    const finalNormals = normals || createDefaultNormals(vertices)

    const geometry = {
      positions: vertices,
      normals: finalNormals
    }

    if (indices && indices.length) {
      geometry.indices = indices
    }

    // Collect all instance transforms
    const instanceCount = list.length
    const instanceMatrices = new Float32Array(instanceCount * 16)

    list.forEach((item, i) => {
      const offset = i * 16
      const transforms = item.transforms
      if (transforms) {
        for (let j = 0; j < 16; j++) {
          instanceMatrices[offset + j] = transforms[j]
        }
      } else {
        // Identity matrix
        instanceMatrices[offset + 0] = 1
        instanceMatrices[offset + 5] = 1
        instanceMatrices[offset + 10] = 1
        instanceMatrices[offset + 15] = 1
      }
    })

    visuals.drawCmd = 'drawMeshInstanced'
    visuals.color = color

    return {
      geometry,
      visuals,
      transparent: visuals.transparent,
      instanceMatrices,
      instanceCount
    }
  }

  return _CSG2Regl
}

/**
 * Create default up-facing normals for vertices
 */
function createDefaultNormals(vertices) {
  if (!vertices || !vertices.length) {
    return new Float32Array(0)
  }
  const vertCount = vertices.length / 3
  const normals = new Float32Array(vertices.length)
  for (let i = 0; i < vertCount; i++) {
    // Default normal pointing up (0, 0, 1)
    normals[i * 3] = 0
    normals[i * 3 + 1] = 0
    normals[i * 3 + 2] = 1
  }
  return normals
}

/**
 * Ensure colors are in RGBA format (4 components per vertex)
 */
function ensureRGBAColors(colors, vertexCount) {
  const hasAlpha = colors.length >= vertexCount * 4
  if (hasAlpha) {
    return colors
  }

  // Convert RGB to RGBA
  const colorVertexCount = Math.floor(colors.length / 3)
  const count = Math.min(colorVertexCount, vertexCount)
  const _colors = new Float32Array(vertexCount * 4)

  for (let v = 0; v < count; v++) {
    const ci = v * 3
    const di = v * 4
    _colors[di] = colors[ci]
    _colors[di + 1] = colors[ci + 1]
    _colors[di + 2] = colors[ci + 2]
    _colors[di + 3] = 1
  }

  // Fill remaining with white
  for (let v = count; v < vertexCount; v++) {
    const di = v * 4
    _colors[di] = 1
    _colors[di + 1] = 1
    _colors[di + 2] = 1
    _colors[di + 3] = 1
  }

  return _colors
}

/**
 * Compute creased normals for smooth shading
 * Ported from Three.js BufferGeometryUtils.toCreasedNormals
 *
 * @param {Float32Array} vertices - Vertex positions
 * @param {Uint16Array|Uint32Array} indices - Triangle indices
 * @param {Float32Array} normals - Original normals (may be ignored)
 * @param {number} creaseAngle - Angle threshold in radians (default PI/3 = 60 degrees)
 * @returns {Object} { vertices, normals } - Non-indexed geometry with smooth normals
 */
function toCreasedNormals(vertices, indices, _normals, creaseAngle = Math.PI / 3) {
  const creaseDot = Math.cos(creaseAngle)
  const hashMultiplier = (1 + 1e-10) * 1e2

  // Convert indexed geometry to non-indexed
  const triCount = indices.length / 3
  const newVertices = new Float32Array(indices.length * 3)
  const newNormals = new Float32Array(indices.length * 3)

  // Expand indexed vertices to non-indexed
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    newVertices[i * 3] = vertices[idx * 3]
    newVertices[i * 3 + 1] = vertices[idx * 3 + 1]
    newVertices[i * 3 + 2] = vertices[idx * 3 + 2]
  }

  // Hash function for vertex positions
  function hashVertex(x, y, z) {
    const hx = ~~(x * hashMultiplier)
    const hy = ~~(y * hashMultiplier)
    const hz = ~~(z * hashMultiplier)
    return `${hx},${hy},${hz}`
  }

  // Compute face normals and build vertex map
  const vertexMap = {}
  const faceNormals = []

  for (let i = 0; i < triCount; i++) {
    const i9 = i * 9
    // Get triangle vertices
    const ax = newVertices[i9], ay = newVertices[i9 + 1], az = newVertices[i9 + 2]
    const bx = newVertices[i9 + 3], by = newVertices[i9 + 4], bz = newVertices[i9 + 5]
    const cx = newVertices[i9 + 6], cy = newVertices[i9 + 7], cz = newVertices[i9 + 8]

    // Compute face normal using cross product
    // edge1 = c - b, edge2 = a - b
    const e1x = cx - bx, e1y = cy - by, e1z = cz - bz
    const e2x = ax - bx, e2y = ay - by, e2z = az - bz

    // cross product
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x

    // normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      nx /= len
      ny /= len
      nz /= len
    }

    const faceNormal = [nx, ny, nz]
    faceNormals.push(faceNormal)

    // Add normal to map for each vertex
    const verts = [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz]
    ]

    for (const v of verts) {
      const hash = hashVertex(v[0], v[1], v[2])
      if (!(hash in vertexMap)) {
        vertexMap[hash] = []
      }
      vertexMap[hash].push(faceNormal)
    }
  }

  // Compute smooth normals
  for (let i = 0; i < triCount; i++) {
    const i9 = i * 9
    const faceNormal = faceNormals[i]

    // For each vertex in the triangle
    for (let v = 0; v < 3; v++) {
      const vi = i9 + v * 3
      const vx = newVertices[vi]
      const vy = newVertices[vi + 1]
      const vz = newVertices[vi + 2]

      const hash = hashVertex(vx, vy, vz)
      const otherNormals = vertexMap[hash]

      // Average normals that are within crease angle
      let avgX = 0, avgY = 0, avgZ = 0

      for (const otherNorm of otherNormals) {
        // Dot product with face normal
        const dot = faceNormal[0] * otherNorm[0] +
                    faceNormal[1] * otherNorm[1] +
                    faceNormal[2] * otherNorm[2]

        if (dot > creaseDot) {
          avgX += otherNorm[0]
          avgY += otherNorm[1]
          avgZ += otherNorm[2]
        }
      }

      // Normalize averaged normal
      const avgLen = Math.sqrt(avgX * avgX + avgY * avgY + avgZ * avgZ)
      if (avgLen > 0) {
        newNormals[vi] = avgX / avgLen
        newNormals[vi + 1] = avgY / avgLen
        newNormals[vi + 2] = avgZ / avgLen
      } else {
        // Fallback to face normal
        newNormals[vi] = faceNormal[0]
        newNormals[vi + 1] = faceNormal[1]
        newNormals[vi + 2] = faceNormal[2]
      }
    }
  }

  return {
    vertices: newVertices,
    normals: newNormals
  }
}

// Export for testing
export { toCreasedNormals, createDefaultNormals, ensureRGBAColors }
