/**
 * ManifoldGeom3 - A wrapper class that holds a Manifold object internally
 * but provides a JSCAD geom3-compatible interface.
 *
 * The key feature is the lazy `polygons` getter which only converts
 * to polygon format when actually needed (e.g., for rendering or export).
 */

import { manifoldToGeom3, geom3ToManifold } from '../conversions/index.js'

/**
 * A geometry wrapper that holds a Manifold internally.
 * Provides lazy conversion to JSCAD geom3 format.
 */
export class ManifoldGeom3 {
  #manifold
  #cachedPolygons = null
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
   * Get the underlying Manifold object.
   *
   * @returns {Object} The wrapped Manifold
   */
  get manifold() {
    return this.#manifold
  }

  /**
   * Lazy getter for polygons - converts from Manifold format on first access.
   * This is what JscadToCommon looks for.
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
