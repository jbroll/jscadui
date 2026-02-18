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
 * The returned script uses the worker's `require()` to load each model file
 * synchronously, calls its main() function, and translates the result.
 *
 * @param {string[]} fileUrls - Absolute or root-relative URLs of model files
 * @param {number} [spacing=60]
 * @returns {string} JavaScript source for the combined script
 */
export function buildAllScript(fileUrls, spacing = 60) {
  const positions = calculateGridPositions(fileUrls.length, spacing)

  const items = fileUrls.map((url, i) => {
    const [x, y] = positions[i]
    return { url, x, y }
  })

  // Serialise the item list into the script source
  const itemsJson = JSON.stringify(items, null, 2)

  return `// Auto-generated ALL script
const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms

const items = ${itemsJson}

function main(params) {
  const all = []
  for (const { url, x, y } of items) {
    try {
      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geom = [].concat(fn(params))
        if (geom.length > 0) {
          all.push(...translate([x, y, 0], geom))
        }
      }
    } catch (err) {
      console.warn('demoBrowser: failed to load', url, err.message)
    }
  }
  return all
}
`
}
