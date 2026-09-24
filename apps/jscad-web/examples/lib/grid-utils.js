/**
 * Grid utilities for [ALL] view layouts.
 *
 * Provides helpers for normalizing and positioning models in a grid.
 * Used by auto-generated ALL scripts to display multiple models together.
 */

const jscad = require('@jscad/modeling')
const { translate, scale } = jscad.transforms
const { measureAggregateBoundingBox } = jscad.measurements
const { colorize } = jscad.colors

/**
 * Calculate grid positions for N items.
 *
 * Items are arranged in a square-ish grid, row-major order, centred on [0,0].
 *
 * @param {number} index    - Item index (0-based)
 * @param {number} total    - Total number of items
 * @param {number} spacing  - Distance between item centres (model units)
 * @returns {[number, number]} [x, y] position for this item
 */
function gridPosition(index, total, spacing = 60) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)

  // Offsets to centre the grid on the origin
  const xOff = ((cols - 1) * spacing) / 2
  const yOff = ((rows - 1) * spacing) / 2

  const col = index % cols
  const row = Math.floor(index / cols)

  return [col * spacing - xOff, row * spacing - yOff]
}

/**
 * Centre a group of geometries at the origin, scale uniformly to cellSize,
 * then translate to the grid position (gx, gy).
 *
 * @param {Array} geoms   - Array of JSCAD geometries
 * @param {number} gx     - Grid X position
 * @param {number} gy     - Grid Y position
 * @param {number} cellSize - Maximum size for the longest axis
 * @returns {Array} Normalized and positioned geometries
 */
function normalizeAndPlace(geoms, gx, gy, cellSize) {
  if (geoms.length === 0) return []

  // Get bounding box - handle both single bbox and array of bboxes
  const rawBbox = measureAggregateBoundingBox(...geoms)

  let x0, y0, z0, x1, y1, z1

  // Check if we got an array of bboxes (multiple geometries) or a single bbox
  if (Array.isArray(rawBbox[0]) && Array.isArray(rawBbox[0][0])) {
    // Multiple bboxes returned - compute aggregate manually
    x0 = Infinity; y0 = Infinity; z0 = Infinity
    x1 = -Infinity; y1 = -Infinity; z1 = -Infinity

    for (const [[minX, minY, minZ], [maxX, maxY, maxZ]] of rawBbox) {
      x0 = Math.min(x0, minX)
      y0 = Math.min(y0, minY)
      z0 = Math.min(z0, minZ)
      x1 = Math.max(x1, maxX)
      y1 = Math.max(y1, maxY)
      z1 = Math.max(z1, maxZ)
    }
  } else {
    // Single bbox - use directly
    [[x0, y0, z0], [x1, y1, z1]] = rawBbox
  }

  const width = x1 - x0
  const height = y1 - y0
  const depth = z1 - z0
  const maxSize = Math.max(width, height, depth)

  if (maxSize === 0 || !isFinite(maxSize)) {
    return []
  }

  const s = cellSize / maxSize

  // Centroid of the bounding box
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2

  // For each geometry: centre → scale → place
  return geoms.map(g => {
    const centred = translate([-cx, -cy, -cz], g)
    const scaled = scale([s, s, s], centred)
    const placed = translate([gx, gy, 0], scaled)
    // A manifold transform result owns its own handle, so the steps can go now
    // rather than wait for the finalizer; g stays, as a model may reuse it.
    disposeIntermediate(centred, g)
    disposeIntermediate(scaled, g)
    return placed
  })
}

function disposeIntermediate(geom, keep) {
  for (const x of [geom].flat(Infinity)) {
    if (x !== keep && x?.isManifoldGeom3 && typeof x.dispose === 'function') x.dispose()
  }
}

/**
 * Derive a valid JS identifier from a file URL.
 *
 * Examples:
 *   .../01-menger.example.js      → menger
 *   .../09-hull-chain.example.js  → hull_chain
 *   .../14-AMFImport/index.js     → AMFImport
 *
 * @param {string} url
 * @returns {string}
 */
function urlToPartName(url) {
  const parts = url.replace(/\/$/, '').split('/')
  let name = parts[parts.length - 1]

  // For index files, use the parent directory name instead
  if (name === 'index.js' || name === 'index.scad') {
    name = parts[parts.length - 2] || name
  }

  // Remove NN- numeric prefix
  name = name.replace(/^\d+-/, '')
  // Remove .example.js / .example.scad / .js / .scad suffixes
  name = name.replace(/\.example\.(js|scad)$/, '').replace(/\.(js|scad)$/, '')
  // Replace hyphens and dots with underscores → valid JS identifier
  return name.replace(/[-.]/g, '_')
}

const SKULL_COLORS = { white: [0.95, 0.95, 0.92, 1], black: [0.1, 0.1, 0.1, 1] }

// skull.svg as a relief with longest side 1, one plain geom3 per colour
function skullLayers() {
  const mesh = require('./skull-mesh.js')
  const vertex = (i) => mesh.vertices.slice(i * 3, i * 3 + 3)
  // Named, not iterated: @jscadui/require adds a `default` key to exports
  return Object.entries(SKULL_COLORS).map(([name, color]) => {
    const indices = mesh[name]
    const polygons = []
    for (let i = 0; i < indices.length; i += 3) {
      polygons.push({ vertices: [vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2])] })
    }
    return { polygons, transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color }
  })
}

/**
 * A skull-and-crossbones to stand in for a model that failed to load.
 *
 * @returns {Array} the off-white plate and the black linework, coloured
 */
function failureMarker() {
  return skullLayers().map(g => colorize(g.color, g))
}

/**
 * The failure marker as plain geometry, for a cell that fails once the wasm
 * has trapped: building it needs no wasm.
 *
 * @returns {Array} two plain geom3s placed at (gx, gy) with longest side cellSize
 */
function prebuiltSkull(gx, gy, cellSize) {
  const s = cellSize
  return skullLayers().map(g => ({ ...g, transforms: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, gx, gy, 0, 1] }))
}

module.exports = {
  gridPosition,
  normalizeAndPlace,
  urlToPartName,
  failureMarker,
  prebuiltSkull
}
