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
 * Build a combined JS script that loads multiple model files at grid offsets.
 *
 * Each model is:
 *   1. Given its own params sub-namespace (params[name]) to avoid conflicts.
 *   2. Translated to its bounding-box centroid (centred at origin).
 *   3. Uniformly scaled so its longest axis fits within the grid cell.
 *   4. Translated to its grid position.
 *
 * Uses the compact format: just an array of URLs, with positions calculated
 * dynamically at runtime using helper functions from lib/grid-utils.js.
 *
 * @param {string[]} fileUrls - Absolute or root-relative URLs of model files
 * @param {number} [spacing=60]
 * @param {string} [dirUrl=''] - Directory URL (used to determine relative path to lib)
 * @returns {string} JavaScript source for the combined script
 */
export function buildAllScript(fileUrls, spacing = 60, dirUrl = '') {
  // Compact format: just the URLs
  const itemsJson = JSON.stringify(fileUrls, null, 2)
  // Models fill 85 % of the cell; the remaining 15 % acts as gutters.
  const cellSize = spacing * 0.85

  // Calculate relative path to examples/lib/grid-utils.js based on directory depth
  // examples/ → ./lib/grid-utils.js
  // examples/benchmarks/ → ../lib/grid-utils.js
  // examples/openscad/01-basics/ → ../../lib/grid-utils.js
  const pathSegments = dirUrl.replace(/^\//, '').split('/').filter(Boolean)
  const examplesIndex = pathSegments.indexOf('examples')
  const depth = examplesIndex >= 0 ? pathSegments.length - examplesIndex - 1 : 0
  const libPath = depth === 0 ? './lib/grid-utils.js' : '../'.repeat(depth) + 'lib/grid-utils.js'

  return `"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const { gridPosition, normalizeAndPlace, urlToPartName } = require('${libPath}')

const items = ${itemsJson}
const spacing = ${spacing}
const cellSize = ${cellSize}

const main = (params) => {
  const all = []
  const nameSeen = {}

  items.forEach((url, i) => {
    try {
      // Calculate grid position dynamically
      const [x, y] = gridPosition(i, items.length, spacing)

      // Derive unique part name from URL
      let name = urlToPartName(url)
      // Deduplicate: if the same name appears twice, append _2, _3, …
      if (nameSeen[name]) {
        nameSeen[name]++
        name = \`\${name}_\${nameSeen[name]}\`
      } else {
        nameSeen[name] = 1
      }

      // Give each sub-model its own params sub-object so inline param
      // definitions (params.foo = {type:'slider',...}) don't collide.
      params[name] = params[name] ?? {}
      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geoms = [].concat(fn(params[name]))
        all.push(...normalizeAndPlace(geoms, x, y, cellSize))
      }
    } catch (err) {
      console.error('demoBrowser: failed to load', url, err.message)
      throw new Error(\`Failed to load \${url}: \${err.message}\`)
    }
  })
  return all
}

module.exports = { main }
`
}
