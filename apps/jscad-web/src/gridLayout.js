/**
 * gridLayout - calculate NxM grid positions for "ALL" view.
 *
 * Positions are centred around the origin so the camera's default
 * zoom-to-fit works well regardless of how many items are shown.
 */

/**
 * Calculate grid positions for N items.
 *
 * Items are arranged in a square-ish grid, row-major order, centred on [0,0].
 *
 * @param {number} count    - Number of items
 * @param {number} [spacing=60] - Distance between item centres (model units)
 * @returns {Array<[number, number]>} [x, y] positions, one per item
 */
export function calculateGridPositions(count, spacing = 60) {
  if (count <= 0) return []

  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  // Offsets to centre the grid on the origin
  const xOff = ((cols - 1) * spacing) / 2
  const yOff = ((rows - 1) * spacing) / 2

  const positions = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    positions.push([col * spacing - xOff, row * spacing - yOff])
  }

  return positions
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
 * Build a combined JS script that loads multiple model files at grid offsets.
 *
 * Each model is:
 *   1. Given its own params sub-namespace (params[name]) to avoid conflicts.
 *   2. Translated to its bounding-box centroid (centred at origin).
 *   3. Uniformly scaled so its longest axis fits within the grid cell.
 *   4. Translated to its grid position.
 *
 * @param {string[]} fileUrls - Absolute or root-relative URLs of model files
 * @param {number} [spacing=60]
 * @returns {string} JavaScript source for the combined script
 */
export function buildAllScript(fileUrls, spacing = 60) {
  const positions = calculateGridPositions(fileUrls.length, spacing)

  // Build items with unique part names
  const nameSeen = {}
  const items = fileUrls.map((url, i) => {
    const [x, y] = positions[i]
    let name = urlToPartName(url)
    // Deduplicate: if the same name appears twice, append _2, _3, …
    if (nameSeen[name]) {
      nameSeen[name]++
      name = `${name}_${nameSeen[name]}`
    } else {
      nameSeen[name] = 1
    }
    return { url, x, y, name }
  })

  const itemsJson = JSON.stringify(items, null, 2)
  // Models fill 85 % of the cell; the remaining 15 % acts as gutters.
  const cellSize = spacing * 0.85

  return `"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const jscad = require('@jscad/modeling')
const { translate, scale } = jscad.transforms
const { measureAggregateBoundingBox } = jscad.measurements

const items = ${itemsJson}
const cellSize = ${cellSize}

/**
 * Centre a group of geometries at the origin, scale uniformly to cellSize,
 * then translate to the grid position (gx, gy).
 */
function normalizeAndPlace(geoms, gx, gy) {
  if (geoms.length === 0) return []
  const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...geoms)
  const maxSize = Math.max(x1 - x0, y1 - y0, z1 - z0)
  if (maxSize === 0) return []
  const s = cellSize / maxSize
  // Centroid of the bounding box
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2
  // For each geometry: centre → scale → place
  return geoms.map(g =>
    translate([gx, gy, 0],
      scale([s, s, s],
        translate([-cx, -cy, -cz], g)))
  )
}

const main = (params) => {
  const all = []
  for (const { url, x, y, name } of items) {
    try {
      // Give each sub-model its own params sub-object so inline param
      // definitions (params.foo = {type:'slider',...}) don't collide.
      params[name] = params[name] ?? {}
      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geoms = [].concat(fn(params[name]))
        all.push(...normalizeAndPlace(geoms, x, y))
      }
    } catch (err) {
      console.warn('demoBrowser: failed to load', url, err.message)
    }
  }
  return all
}

module.exports = { main }
`
}
