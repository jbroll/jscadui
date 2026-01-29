/**
 * Scene helper utilities for the Regl renderer
 * Re-exports and adapts helpers from @jscadui/scene for use with Regl
 */

import { makeGrid as _makeGrid, makeAxes as _makeAxes } from '@jscadui/scene'

/**
 * Create grid geometry for the Regl renderer
 * Returns two line sets: main grid lines and secondary grid lines
 *
 * @param {Object} options - Grid options
 * @param {number} options.size - Grid size (default 200)
 * @param {Array} options.color1 - Main grid color [r,g,b,a] (default [0,0,0,0.2])
 * @param {Array} options.color2 - Secondary grid color [r,g,b,a] (default [0,0,0.6,0.1])
 * @returns {Array} Array of two line geometry objects
 */
export const makeGrid = (options = {}) => {
  return _makeGrid(options)
}

/**
 * Create axis geometry for the Regl renderer
 * Returns RGB-colored axis lines (X=red, Y=green, Z=blue)
 *
 * @param {number} length - Axis length (default 100)
 * @returns {Object} Lines geometry object with vertices and colors
 */
export const makeAxes = (length = 100) => {
  // Regl shaders expect RGBA colors, so force 4-component colors
  return _makeAxes(length, true)
}

/**
 * Create a complete scene with grid and axes
 * Ready to be added to viewer.setScene()
 *
 * @param {Object} options - Scene options
 * @param {boolean} options.showGrid - Whether to show grid (default true)
 * @param {boolean} options.showAxes - Whether to show axes (default true)
 * @param {number} options.gridSize - Grid size (default 200)
 * @param {number} options.axisLength - Axis length (default 100)
 * @param {Array} options.gridColor1 - Main grid color
 * @param {Array} options.gridColor2 - Secondary grid color
 * @returns {Array} Array of geometry objects ready for setScene
 */
export const createSceneHelpers = ({
  showGrid = true,
  showAxes = true,
  gridSize = 200,
  axisLength = 100,
  gridColor1,
  gridColor2
} = {}) => {
  const items = []

  if (showGrid) {
    const gridOptions = { size: gridSize }
    if (gridColor1) gridOptions.color1 = gridColor1
    if (gridColor2) gridOptions.color2 = gridColor2
    items.push(...makeGrid(gridOptions))
  }

  if (showAxes) {
    items.push(makeAxes(axisLength))
  }

  return items
}

/**
 * Default grid colors matching common themes
 */
export const gridColors = {
  light: {
    color1: [0, 0, 0, 0.2],
    color2: [0, 0, 0.6, 0.1]
  },
  dark: {
    color1: [1, 1, 1, 0.2],
    color2: [0.6, 0.6, 1, 0.1]
  }
}

export default {
  makeGrid,
  makeAxes,
  createSceneHelpers,
  gridColors
}
