/**
 * ManifoldGeom2 - A dual-port geometry wrapper that can hold either
 * a Manifold CrossSection or a JSCAD geom2 as its internal representation.
 *
 * This allows operations that work better with one format or the other
 * to use the appropriate internal representation without conversion overhead,
 * while still providing compatibility with both APIs.
 */

import { crossSectionToGeom2, geom2ToCrossSection } from '../conversions/index.js'

/**
 * Source type constants
 */
const SOURCE_CROSSSECTION = 'crossSection'
const SOURCE_JSCAD = 'jscad'

/**
 * A geometry wrapper that can hold either CrossSection or JSCAD geom2 internally.
 * Provides lazy conversion between formats.
 */
export class ManifoldGeom2 {
  // Internal storage - one of these will be the source of truth
  #crossSection = null
  #jscadGeom2 = null

  // Which format is the source of truth
  #sourceType = null

  // Cached conversions
  #cachedSides = null

  // Color
  #color = null

  /**
   * Create a ManifoldGeom2 wrapper.
   *
   * @param {Object} geometry - Either a CrossSection or JSCAD geom2
   * @param {string} [sourceType] - Optional hint: 'crossSection' or 'jscad'
   */
  constructor(geometry, sourceType = null) {
    if (geometry === null || geometry === undefined) {
      // Empty geometry - will create empty CrossSection on demand
      this.#sourceType = SOURCE_CROSSSECTION
      return
    }

    // Detect type if not specified
    if (sourceType === SOURCE_CROSSSECTION) {
      this.#crossSection = geometry
      this.#sourceType = SOURCE_CROSSSECTION
    } else if (sourceType === SOURCE_JSCAD) {
      this.#jscadGeom2 = geometry
      this.#sourceType = SOURCE_JSCAD
    } else if (geometry.toPolygons || geometry.area || (geometry.offset && !geometry.sides)) {
      // Looks like a CrossSection (has CrossSection-specific methods)
      this.#crossSection = geometry
      this.#sourceType = SOURCE_CROSSSECTION
    } else if (geometry.sides || geometry.outlines) {
      // Looks like a JSCAD geom2
      this.#jscadGeom2 = geometry
      this.#sourceType = SOURCE_JSCAD
    } else {
      // Default to CrossSection
      this.#crossSection = geometry
      this.#sourceType = SOURCE_CROSSSECTION
    }

    // Identity transform
    this.transforms = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  /**
   * Get the underlying CrossSection object.
   * Converts from JSCAD geom2 if needed.
   *
   * @returns {Object} The CrossSection
   */
  get crossSection() {
    if (this.#crossSection !== null) {
      return this.#crossSection
    }

    // Need to convert from JSCAD geom2
    if (this.#jscadGeom2 !== null) {
      this.#crossSection = geom2ToCrossSection(this.#jscadGeom2)
      return this.#crossSection
    }

    // No geometry at all - return null (caller should handle)
    return null
  }

  /**
   * Get the JSCAD geom2 representation.
   * Converts from CrossSection if needed.
   *
   * @returns {Object} JSCAD geom2 format
   */
  get jscadGeom2() {
    if (this.#jscadGeom2 !== null) {
      return this.#jscadGeom2
    }

    // Need to convert from CrossSection
    if (this.#crossSection !== null) {
      this.#jscadGeom2 = crossSectionToGeom2(this.#crossSection)
      return this.#jscadGeom2
    }

    // No geometry at all
    return { sides: [], outlines: [], transforms: this.transforms }
  }

  /**
   * Check if the source of truth is a CrossSection.
   *
   * @returns {boolean} True if CrossSection is the source
   */
  get hasCrossSectionSource() {
    return this.#sourceType === SOURCE_CROSSSECTION && this.#crossSection !== null
  }

  /**
   * Check if the source of truth is JSCAD geom2.
   *
   * @returns {boolean} True if JSCAD geom2 is the source
   */
  get hasJscadSource() {
    return this.#sourceType === SOURCE_JSCAD && this.#jscadGeom2 !== null
  }

  /**
   * Lazy getter for sides - converts from CrossSection format on first access.
   *
   * @returns {Array} Array of [start, end] pairs
   */
  get sides() {
    if (this.#cachedSides === null) {
      const geom2 = this.jscadGeom2
      this.#cachedSides = geom2.sides || []
    }
    return this.#cachedSides
  }

  /**
   * Get outlines from the geometry.
   *
   * @returns {Array} Array of outlines
   */
  get outlines() {
    const geom2 = this.jscadGeom2
    return geom2.outlines || []
  }

  /**
   * Get/set the color of this geometry.
   */
  get color() {
    return this.#color
  }

  set color(value) {
    this.#color = value
  }

  /**
   * Check if this is a ManifoldGeom2 (duck typing helper).
   */
  get isManifoldGeom2() {
    return true
  }

  /**
   * Get the bounding box of the geometry.
   *
   * @returns {Array} [[minX, minY], [maxX, maxY]]
   */
  boundingBox() {
    const cs = this.crossSection
    if (!cs) return [[0, 0], [0, 0]]
    const bbox = cs.bounds()
    return [
      [bbox.min[0], bbox.min[1]],
      [bbox.max[0], bbox.max[1]]
    ]
  }

  /**
   * Get the area of the geometry.
   *
   * @returns {number} Area in square units
   */
  area() {
    const cs = this.crossSection
    return cs ? cs.area() : 0
  }

  /**
   * Check if geometry is empty.
   *
   * @returns {boolean} True if empty
   */
  isEmpty() {
    const cs = this.crossSection
    return cs ? cs.isEmpty() : true
  }

  /**
   * Get the number of contours.
   *
   * @returns {number} Number of contours
   */
  numContour() {
    const cs = this.crossSection
    return cs ? cs.numContour() : 0
  }

  /**
   * Clone this geometry.
   *
   * @returns {ManifoldGeom2} A new ManifoldGeom2 with copied data
   */
  clone() {
    let cloned
    if (this.#sourceType === SOURCE_JSCAD && this.#jscadGeom2) {
      // Clone the JSCAD geom2 as source
      cloned = new ManifoldGeom2(this.#jscadGeom2, SOURCE_JSCAD)
    } else if (this.#crossSection) {
      cloned = new ManifoldGeom2(this.#crossSection, SOURCE_CROSSSECTION)
    } else {
      cloned = new ManifoldGeom2(null)
    }
    cloned.#color = this.#color
    return cloned
  }
}

/**
 * Create a ManifoldGeom2 from a CrossSection object.
 *
 * @param {Object} crossSection - CrossSection object
 * @returns {ManifoldGeom2} Wrapped geometry
 */
export const fromCrossSection = (crossSection) => new ManifoldGeom2(crossSection, SOURCE_CROSSSECTION)

/**
 * Create a ManifoldGeom2 from a JSCAD geom2 object.
 *
 * @param {Object} geom2 - JSCAD geom2 object
 * @returns {ManifoldGeom2} Wrapped geometry
 */
export const fromJscadGeom2 = (geom2) => new ManifoldGeom2(geom2, SOURCE_JSCAD)

/**
 * Check if an object is a ManifoldGeom2.
 *
 * @param {any} obj - Object to check
 * @returns {boolean} True if ManifoldGeom2
 */
export const isManifoldGeom2 = (obj) => {
  return obj && obj.isManifoldGeom2 === true
}

/**
 * Get the CrossSection from a geometry.
 * Handles ManifoldGeom2 and plain JSCAD geom2.
 *
 * @param {Object} geom - ManifoldGeom2 or geom2
 * @returns {Object} CrossSection object
 */
export const toCrossSection = (geom) => {
  if (isManifoldGeom2(geom)) {
    return geom.crossSection
  }
  return geom2ToCrossSection(geom)
}

/**
 * Get the JSCAD geom2 from a geometry.
 * Handles ManifoldGeom2 and plain JSCAD geom2.
 *
 * @param {Object} geom - ManifoldGeom2 or geom2
 * @returns {Object} JSCAD geom2 object
 */
export const toJscadGeom2 = (geom) => {
  if (isManifoldGeom2(geom)) {
    return geom.jscadGeom2
  }
  // Already a JSCAD geom2
  return geom
}

export default { ManifoldGeom2, fromCrossSection, fromJscadGeom2, isManifoldGeom2, toCrossSection, toJscadGeom2 }
