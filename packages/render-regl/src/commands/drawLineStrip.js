/**
 * Draw line strip command factory
 * Creates a regl command for rendering continuous line strips (arc, line primitives)
 */

import * as mat4 from 'gl-mat4'
import { linesVert, linesFrag, vColorVert, vColorFrag } from '../shaders/lines.js'
import renderDefaults from '../renderDefaults.js'

/**
 * Create a draw command for a line strip entity
 * Unlike drawLines which draws discrete line segments (pairs of vertices),
 * this draws a continuous line through all vertices (GL_LINE_STRIP)
 * @param {Object} regl - The regl instance
 * @param {Object} params - Entity parameters
 * @returns {Function} Regl draw command
 */
const drawLineStrip = (regl, params = {}) => {
  const defaults = {
    color: renderDefaults.meshColor,
    geometry: undefined
  }

  let { geometry, color, transparent: _transparent } = Object.assign({}, defaults, params)

  // Use geometry color if specified
  if ('color' in geometry) color = geometry.color

  const hasNormals = !!(geometry.normals && geometry.normals.length > 0)
  const hasVertexColors = !!(geometry.colors && geometry.colors.length > 0)
  const transforms = geometry.transforms || mat4.create()

  // Select shaders based on vertex colors
  const vert = hasVertexColors ? vColorVert : linesVert
  const frag = hasVertexColors ? vColorFrag : linesFrag

  const commandParams = {
    primitive: 'line strip',
    vert,
    frag,

    uniforms: {
      model: (_context, props) => props.model || transforms,
      ucolor: (_context, props) => (props && props.color) ? props.color : color,
      // For vertex color shader compatibility
      vColorToggler: (_context, _props) => hasVertexColors ? 1.0 : 0.0
    },

    attributes: {
      position: regl.buffer({ usage: 'static', type: 'float', data: geometry.positions })
    },

    // No backface culling for lines
    cull: {
      enable: false
    },

    depth: {
      enable: true,
      mask: !transparent
    },

    // Draw all vertices as a continuous line strip
    count: geometry.positions.length / 3
  }

  // Alpha blending for transparent lines
  if (transparent) {
    commandParams.blend = {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' }
    }
  }

  // Vertex colors
  if (hasVertexColors) {
    commandParams.attributes.color = regl.buffer({ usage: 'static', type: 'float', data: geometry.colors })
  }

  // Normal attribute (needed for shader compatibility even if not used for lighting)
  if (hasNormals) {
    commandParams.attributes.normal = regl.buffer({ usage: 'static', type: 'float', data: geometry.normals })
  }

  return regl(commandParams)
}

export default drawLineStrip
