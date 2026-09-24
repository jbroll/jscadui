/**
 * Grid utilities for [ALL] view layouts.
 *
 * Provides helpers for normalizing and positioning models in a grid.
 * Used by auto-generated ALL scripts to display multiple models together.
 */

const jscad = require('@jscad/modeling')
const { translate, rotate, scale } = jscad.transforms
const { measureAggregateBoundingBox } = jscad.measurements
const { cuboid, cylinder, sphere } = jscad.primitives
const { subtract, union } = jscad.booleans
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

/**
 * Build a skull-and-crossbones to stand in for a model that failed to load.
 *
 * @returns {Array} Array of JSCAD geometries, coloured red
 */
function failureMarker() {
  const segments = 24

  const eye = (x) => sphere({ radius: 4, segments, center: [x, -8, 2] })
  const cranium = subtract(
    union(
      sphere({ radius: 10, segments }),
      cuboid({ size: [12, 9, 8], center: [0, -5, -9] })
    ),
    eye(-4.6),
    eye(4.6),
    cuboid({ size: [3, 6, 4.5], center: [0, -9, -3.5] }),
    cuboid({ size: [10, 6, 1.8], center: [0, -8, -9] })
  )

  const shaft = union(
    cylinder({ radius: 2.4, height: 40, segments }),
    sphere({ radius: 4, segments, center: [0, 0, 20] }),
    sphere({ radius: 4, segments, center: [0, 0, -20] })
  )
  // Lay the shaft along X first, so the pair crosses in the XY plane
  const bone = (angle) => rotate([0, 0, angle], rotate([0, Math.PI / 2, 0], shaft))

  const crossbones = translate([0, 0, -26],
    rotate([Math.PI / 2, 0, 0], union(bone(Math.PI / 6), bone(-Math.PI / 6))))

  // Yaw so the face points at the app's default camera, which looks from +X,-Y,+Z
  const marker = rotate([0, 0, Math.PI / 4], union(cranium, crossbones))

  return [].concat(colorize([0.85, 0.1, 0.1], marker)).flat()
}

/**
 * The failure marker as stored triangles, for a cell that fails once the
 * wasm has trapped: building it needs no boolean and no wasm.
 *
 * @returns {object} a plain geom3 placed at (gx, gy) with longest side cellSize
 */
function prebuiltSkull(gx, gy, cellSize) {
  const data = require('./skull-mesh.js')
  const polygons = []
  for (let i = 0; i < data.length; i += 9) {
    polygons.push({ vertices: [data.slice(i, i + 3), data.slice(i + 3, i + 6), data.slice(i + 6, i + 9)] })
  }
  const s = cellSize
  return { polygons, transforms: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, gx, gy, 0, 1], color: [0.85, 0.1, 0.1, 1] }
}

module.exports = {
  gridPosition,
  normalizeAndPlace,
  urlToPartName,
  failureMarker,
  prebuiltSkull
}
