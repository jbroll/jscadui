/**
 * Draw command factory for instanced mesh rendering
 * Efficiently renders many copies of the same geometry with different transforms
 */

import {
  instancedMeshVert,
  instancedMeshFrag,
  instancedVColorVert,
  instancedVColorFrag
} from '../shaders/meshInstanced.js'
import renderDefaults from '../renderDefaults.js'

/**
 * Create an instanced mesh draw command
 * @param {Object} regl - Regl instance
 * @param {Object} entity - Entity with geometry, visuals, instanceMatrices, instanceCount
 * @returns {Function} Regl draw command
 */
export default function drawMeshInstanced(regl, entity) {
  const { geometry, visuals, instanceMatrices, instanceCount } = entity
  const hasVertexColors = visuals.useVertexColors && geometry.colors

  // Create instance matrix buffer
  // Each matrix is 16 floats, we pass as 4 vec4 attributes
  const instanceBuffer = regl.buffer({
    data: instanceMatrices,
    usage: 'static'
  })

  // Build attributes object
  const attributes = {
    position: geometry.positions,
    normal: geometry.normals,
    // Instance matrix columns with divisor=1 (one per instance)
    instanceMatrix0: {
      buffer: instanceBuffer,
      divisor: 1,
      stride: 64, // 16 floats * 4 bytes
      offset: 0
    },
    instanceMatrix1: {
      buffer: instanceBuffer,
      divisor: 1,
      stride: 64,
      offset: 16 // 4 floats * 4 bytes
    },
    instanceMatrix2: {
      buffer: instanceBuffer,
      divisor: 1,
      stride: 64,
      offset: 32
    },
    instanceMatrix3: {
      buffer: instanceBuffer,
      divisor: 1,
      stride: 64,
      offset: 48
    }
  }

  if (hasVertexColors) {
    attributes.vcolor = geometry.colors
  }

  // Select shaders based on vertex colors
  const vert = hasVertexColors ? instancedVColorVert : instancedMeshVert
  const frag = hasVertexColors ? instancedVColorFrag : instancedMeshFrag

  // Build uniforms
  const uniformsObj = {
    view: regl.prop('camera.view'),
    projection: regl.prop('camera.projection'),
    lightDirection: renderDefaults.lightDirection,
    lightColor: renderDefaults.lightColor,
    ambientAmount: renderDefaults.ambientLightAmount,
    diffuseAmount: renderDefaults.diffuseLightAmount,
    specularAmount: renderDefaults.specularLightAmount,
    shininess: renderDefaults.materialShininess
  }

  if (!hasVertexColors) {
    uniformsObj.color = regl.prop('color')
  }

  // Build command config
  const commandConfig = {
    vert,
    frag,
    attributes,
    uniforms: uniformsObj,
    instances: instanceCount,
    cull: {
      enable: true,
      face: 'back'
    },
    depth: {
      enable: true,
      mask: true
    }
  }

  // Handle indexed geometry
  if (geometry.indices) {
    commandConfig.elements = geometry.indices
  } else {
    commandConfig.count = geometry.positions.length / 3
  }

  // Handle transparency
  if (visuals.transparent) {
    commandConfig.blend = {
      enable: true,
      func: {
        srcRGB: 'src alpha',
        srcAlpha: 'one',
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha'
      }
    }
    commandConfig.depth.mask = false
  }

  const command = regl(commandConfig)

  // Attach cleanup method to command (C1 fix - WebGL memory leak)
  command.destroy = () => {
    if (instanceBuffer && typeof instanceBuffer.destroy === 'function') {
      instanceBuffer.destroy()
    }
  }

  return command
}
