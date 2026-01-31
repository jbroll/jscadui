/**
 * ManifoldGeom3 - A wrapper class that holds a Manifold object internally
 * but provides a JSCAD geom3-compatible interface.
 *
 * The key feature is the lazy `polygons` getter which only converts
 * to polygon format when actually needed (e.g., for rendering or export).
 *
 * Also implements the "common format" interface (vertices, indices, normals)
 * for direct pass-through to renderers, bypassing polygon conversion.
 */

import { manifoldToGeom3, geom3ToManifold } from '../conversions/index.js'

/**
 * Compute flat-shading normals from an indexed triangle mesh.
 * Expands the mesh to non-indexed format with per-face normals.
 *
 * @param {Float32Array} srcVerts - Source vertex positions (shared/indexed)
 * @param {Uint32Array} srcIndices - Triangle indices
 * @returns {{ vertices: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
function computeMeshData(srcVerts, srcIndices) {
  const triCount = srcIndices.length / 3
  const vertCount = triCount * 3

  const vertices = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const indices = new Uint32Array(vertCount)

  for (let t = 0; t < triCount; t++) {
    const i0 = srcIndices[t * 3]
    const i1 = srcIndices[t * 3 + 1]
    const i2 = srcIndices[t * 3 + 2]

    // Read source vertex positions
    const v0x = srcVerts[i0 * 3], v0y = srcVerts[i0 * 3 + 1], v0z = srcVerts[i0 * 3 + 2]
    const v1x = srcVerts[i1 * 3], v1y = srcVerts[i1 * 3 + 1], v1z = srcVerts[i1 * 3 + 2]
    const v2x = srcVerts[i2 * 3], v2y = srcVerts[i2 * 3 + 1], v2z = srcVerts[i2 * 3 + 2]

    // Write expanded vertex positions
    const outBase = t * 9
    vertices[outBase] = v0x; vertices[outBase + 1] = v0y; vertices[outBase + 2] = v0z
    vertices[outBase + 3] = v1x; vertices[outBase + 4] = v1y; vertices[outBase + 5] = v1z
    vertices[outBase + 6] = v2x; vertices[outBase + 7] = v2y; vertices[outBase + 8] = v2z

    // Compute face normal via cross product
    const ax = v1x - v0x, ay = v1y - v0y, az = v1z - v0z
    const bx = v2x - v0x, by = v2y - v0y, bz = v2z - v0z
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx

    // Normalize
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) {
      nx /= len; ny /= len; nz /= len
    } else {
      // Degenerate triangle - use default normal
      nx = 0; ny = 0; nz = 1
    }

    // Set same normal for all 3 vertices of this triangle
    normals[outBase] = nx; normals[outBase + 1] = ny; normals[outBase + 2] = nz
    normals[outBase + 3] = nx; normals[outBase + 4] = ny; normals[outBase + 5] = nz
    normals[outBase + 6] = nx; normals[outBase + 7] = ny; normals[outBase + 8] = nz

    // Sequential indices (since we expanded to non-indexed)
    const idxBase = t * 3
    indices[idxBase] = idxBase
    indices[idxBase + 1] = idxBase + 1
    indices[idxBase + 2] = idxBase + 2
  }

  return { vertices, indices, normals }
}

/**
 * A geometry wrapper that holds a Manifold internally.
 * Provides lazy conversion to JSCAD geom3 format.
 * Also provides direct access to render-ready mesh data.
 */
export class ManifoldGeom3 {
  /**
   * When true, skip CPU normal computation and return indexed mesh directly.
   * Only enable for renderers that support GPU-computed flat normals (e.g., Regl).
   * Three.js requires CPU-computed normals.
   * Saves ~170ms at 400K triangles when enabled.
   * @type {boolean}
   */
  static useGpuNormals = false

  #manifold
  #cachedPolygons = null
  #cachedMeshData = null
  #cachedRawMesh = null
  #color = null

  /**
   * Create a ManifoldGeom3 wrapper.
   *
   * @param {Object} manifold - The Manifold object to wrap
   */
  constructor(manifold) {
    this.#manifold = manifold
    // Identity transform - actual transform is in Manifold
    this.transforms = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  /**
   * Lazily compute and cache render-ready mesh data.
   * Converts from Manifold's indexed format to flat-shaded format with normals.
   *
   * @returns {{ vertices: Float32Array, indices: Uint32Array, normals: Float32Array }}
   */
  #ensureMeshData() {
    if (this.#cachedMeshData === null) {
      const mesh = this.#manifold.getMesh()
      this.#cachedMeshData = computeMeshData(mesh.vertProperties, mesh.triVerts)
    }
    return this.#cachedMeshData
  }

  /**
   * Get raw indexed mesh data from Manifold (no vertex expansion, no normals).
   * Used when useGpuNormals is enabled for GPU-computed flat shading.
   *
   * @returns {{ vertices: Float32Array, indices: Uint32Array }}
   */
  #ensureRawMesh() {
    if (this.#cachedRawMesh === null) {
      const mesh = this.#manifold.getMesh()
      // vertProperties is Float32Array, triVerts is Uint32Array
      this.#cachedRawMesh = {
        vertices: mesh.vertProperties,
        indices: mesh.triVerts
      }
    }
    return this.#cachedRawMesh
  }

  /**
   * Get the underlying Manifold object.
   *
   * @returns {Object} The wrapped Manifold
   */
  get manifold() {
    return this.#manifold
  }

  // ========== Common Format Interface ==========
  // These getters allow JscadToCommon to pass through directly
  // without converting to polygon format first.

  /**
   * Geometry type for the common format.
   * @returns {'mesh'}
   */
  get type() {
    return 'mesh'
  }

  /**
   * Get vertex positions as Float32Array.
   * When useGpuNormals is true, returns indexed (shared) vertices directly from Manifold.
   * Otherwise, returns expanded vertices (one per triangle vertex) for flat shading.
   *
   * @returns {Float32Array} Flat array of vertex positions [x,y,z,x,y,z,...]
   */
  get vertices() {
    if (ManifoldGeom3.useGpuNormals) {
      return this.#ensureRawMesh().vertices
    }
    return this.#ensureMeshData().vertices
  }

  /**
   * Get triangle indices as Uint32Array.
   * When useGpuNormals is true, returns original indices from Manifold.
   * Otherwise, returns sequential indices for expanded vertices.
   *
   * @returns {Uint32Array} Triangle indices
   */
  get indices() {
    if (ManifoldGeom3.useGpuNormals) {
      return this.#ensureRawMesh().indices
    }
    return this.#ensureMeshData().indices
  }

  /**
   * Get vertex normals as Float32Array.
   * When useGpuNormals is true, returns undefined (GPU computes flat normals via dFdx/dFdy).
   * Otherwise, lazily computes and caches flat shading normals (per-face).
   *
   * @returns {Float32Array|undefined} Flat array of normals or undefined for GPU normals
   */
  get normals() {
    if (ManifoldGeom3.useGpuNormals) {
      return undefined
    }
    return this.#ensureMeshData().normals
  }

  // ========== Legacy JSCAD Interface ==========

  /**
   * Lazy getter for polygons - converts from Manifold format on first access.
   * This is the legacy interface for JSCAD compatibility.
   * Prefer using vertices/indices/normals for rendering.
   *
   * @returns {Array} Array of poly3 objects
   */
  get polygons() {
    if (this.#cachedPolygons === null) {
      const geom3 = manifoldToGeom3(this.#manifold)
      this.#cachedPolygons = geom3.polygons
    }
    return this.#cachedPolygons
  }

  /**
   * Get/set the color of this geometry.
   *
   * @returns {Array|null} RGBA color array or null
   */
  get color() {
    return this.#color
  }

  set color(value) {
    this.#color = value
  }

  /**
   * Check if this is a ManifoldGeom3 (duck typing helper).
   */
  get isManifoldGeom3() {
    return true
  }

  /**
   * Get the bounding box of the geometry.
   *
   * @returns {Array} [[minX, minY, minZ], [maxX, maxY, maxZ]]
   */
  boundingBox() {
    const bbox = this.#manifold.boundingBox()
    return [
      [bbox.min[0], bbox.min[1], bbox.min[2]],
      [bbox.max[0], bbox.max[1], bbox.max[2]]
    ]
  }

  /**
   * Get the volume of the geometry.
   *
   * @returns {number} Volume in cubic units
   */
  volume() {
    return this.#manifold.volume()
  }

  /**
   * Get the surface area of the geometry.
   *
   * @returns {number} Surface area in square units
   */
  surfaceArea() {
    return this.#manifold.surfaceArea()
  }

  /**
   * Check if geometry is empty.
   *
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.#manifold.isEmpty()
  }

  /**
   * Get the genus (number of holes) of the geometry.
   *
   * @returns {number} Genus value
   */
  genus() {
    return this.#manifold.genus()
  }

  /**
   * Clone this geometry.
   *
   * Note: This shares the underlying Manifold object reference, which is safe because
   * Manifold objects are immutable - all operations (subtract, union, transform, etc.)
   * return NEW Manifold objects rather than mutating in place. This is the same
   * pattern used by JSCAD's geom3.clone().
   *
   * @returns {ManifoldGeom3} A new ManifoldGeom3 with copied data
   */
  clone() {
    const cloned = new ManifoldGeom3(this.#manifold)
    cloned.#color = this.#color
    return cloned
  }
}

/**
 * Create a ManifoldGeom3 from a Manifold object.
 *
 * @param {Object} manifold - Manifold object
 * @returns {ManifoldGeom3} Wrapped geometry
 */
export const fromManifold = (manifold) => new ManifoldGeom3(manifold)

/**
 * Check if an object is a ManifoldGeom3.
 *
 * @param {any} obj - Object to check
 * @returns {boolean} True if ManifoldGeom3
 */
export const isManifoldGeom3 = (obj) => {
  return obj && obj.isManifoldGeom3 === true
}

/**
 * Get the Manifold from a geometry (handles both ManifoldGeom3 and regular geom3).
 *
 * @param {Object} geom - ManifoldGeom3 or geom3
 * @returns {Object} Manifold object
 */
export const toManifold = (geom) => {
  if (isManifoldGeom3(geom)) {
    return geom.manifold
  }
  return geom3ToManifold(geom)
}

export default { ManifoldGeom3, fromManifold, isManifoldGeom3, toManifold }
