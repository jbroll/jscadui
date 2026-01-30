/**
 * Command factory initialization
 * Creates all the draw commands needed for rendering
 */

import drawMesh from './drawMesh.js'
import drawLines from './drawLines.js'
import drawLineStrip from './drawLineStrip.js'
import drawMeshInstanced from './drawMeshInstanced.js'

/**
 * Creates the draw command factories
 * These factories create individual draw commands for each entity
 */
export const createDrawCommands = () => ({
  drawMesh,
  drawLines,
  drawLineStrip,
  drawMeshInstanced,
  // Grid and axis can use drawLines with appropriate geometry
  drawGrid: drawLines,
  drawAxis: drawLines
})

export default createDrawCommands
