/**
 * Draw mesh command factory
 * Creates a regl command for rendering triangle meshes with Phong lighting
 */

import * as mat4 from 'gl-mat4'
import { meshVert, meshFrag, vColorVert, vColorFrag, flatVert, flatFrag } from '../shaders/mesh.js'
import renderDefaults from '../renderDefaults.js'

/**
 * Create a draw command for a mesh entity
 * @param {Object} regl - The regl instance
 * @param {Object} params - Entity parameters
 * @returns {Function} Regl draw command
 */
const drawMesh = (regl, params = { extras: {} }) => {
  const defaults = {
    useVertexColors: true,
    dynamicCulling: true,
    geometry: undefined,
    color: renderDefaults.meshColor,
    visuals: {}
  }

  const { geometry, dynamicCulling, useVertexColors, color, visuals } = Object.assign({}, defaults, params)

  // Determine geometry properties
  const hasIndices = !!(geometry.indices && geometry.indices.length > 0)
  const hasNormals = !!(geometry.normals && geometry.normals.length > 0)
  const transparent = 'transparent' in visuals ? visuals.transparent : false
  const hasVertexColors = !!(useVertexColors && geometry.colors && geometry.colors.length > 0)
  const transforms = geometry.transforms || mat4.create()

  // Dynamic culling based on transform determinant (flip for mirrored geometry)
  const flip = mat4.determinant(transforms) < 0
  const cullFace = dynamicCulling ? (flip ? 'front' : 'back') : 'back'

  // Select shaders based on normals and vertex colors
  // If no normals provided, use flat shading (compute normals in fragment shader via dFdx/dFdy)
  let vert, frag
  if (!hasNormals) {
    // GPU-computed flat normals - no normal attribute needed
    vert = flatVert
    frag = flatFrag
  } else if (hasVertexColors) {
    vert = vColorVert
    frag = vColorFrag
  } else {
    vert = meshVert
    frag = meshFrag
  }

  // Compute inverse model matrix for normal transformation
  const modelMatrixInv = mat4.invert(mat4.create(), transforms)

  let commandParams = {
    primitive: 'triangles',
    vert,
    frag,

    uniforms: {
      model: (_context, _props) => transforms,
      ucolor: (_context, props) => (props && props.color) ? props.color : color,
      // Toggle between vertex colors and uniform color
      vColorToggler: (_context, props) => (props && props.useVertexColors && props.useVertexColors === true) ? 1.0 : 0.0,
      // Normal matrix = transpose(inverse(modelView)) = transpose(inverse(model) * inverse(view))
      unormal: (context, props) => {
        const inverseView = mat4.invert(mat4.create(), props.camera.view)
        const inverseModelView = mat4.multiply(mat4.create(), modelMatrixInv, inverseView)
        const normalMatrix = mat4.transpose(mat4.create(), inverseModelView)
        return normalMatrix
      }
    },

    attributes: {
      position: regl.buffer({ usage: 'static', type: 'float', data: geometry.positions })
    },

    cull: {
      enable: true,
      face: cullFace
    },

    depth: {
      enable: true,
      mask: !transparent // Don't write to depth buffer for transparent objects
    }
  }

  // Alpha blending for transparent objects
  if (transparent) {
    commandParams.blend = {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' }
    }
  }

  // Set up index buffer
  if (geometry.cells) {
    commandParams.elements = geometry.cells
  } else if (hasIndices) {
    // Determine index type based on array type
    const indexType = geometry.indices instanceof Uint32Array ? 'uint32' : 'uint16'
    commandParams.elements = regl.elements({ usage: 'static', type: indexType, data: geometry.indices })
  } else if (geometry.triangles) {
    commandParams.elements = geometry.triangles
  } else {
    commandParams.count = geometry.positions.length / 3
  }

  // Normal attribute
  if (hasNormals) {
    commandParams.attributes.normal = regl.buffer({ usage: 'static', type: 'float', data: geometry.normals })
  }

  // Vertex color attribute
  if (hasVertexColors) {
    commandParams.attributes.color = regl.buffer({ usage: 'static', type: 'float', data: geometry.colors })
  }

  // Merge any extra params
  commandParams = Object.assign({}, commandParams, params.extras)

  // Track created buffers for cleanup (C1 fix - WebGL memory leak)
  const createdBuffers = []
  if (commandParams.attributes.position) {
    createdBuffers.push(commandParams.attributes.position)
  }
  if (commandParams.attributes.normal) {
    createdBuffers.push(commandParams.attributes.normal)
  }
  if (commandParams.attributes.color) {
    createdBuffers.push(commandParams.attributes.color)
  }
  if (commandParams.elements && typeof commandParams.elements.destroy === 'function') {
    createdBuffers.push(commandParams.elements)
  }

  const command = regl(commandParams)

  // Attach cleanup method to command
  command.destroy = () => {
    createdBuffers.forEach(buffer => {
      if (buffer && typeof buffer.destroy === 'function') {
        buffer.destroy()
      }
    })
  }

  return command
}

export default drawMesh
