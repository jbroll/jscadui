/**
 * Render context wrapper
 * Sets up global uniforms for all draw commands (camera, lighting)
 */

import * as mat4 from 'gl-mat4'
import * as vec3 from 'gl-vec3'
import renderDefaults from './renderDefaults.js'

// Identity matrix fallback for invalid view matrices
const IDENTITY = mat4.identity([])

// Transform a direction vector by the rotation part of a 4x4 matrix
const transformDirection = (out, dir, mat) => {
  out[0] = mat[0] * dir[0] + mat[4] * dir[1] + mat[8] * dir[2]
  out[1] = mat[1] * dir[0] + mat[5] * dir[1] + mat[9] * dir[2]
  out[2] = mat[2] * dir[0] + mat[6] * dir[1] + mat[10] * dir[2]
  return vec3.normalize(out, out)
}

/**
 * Creates a render wrapper command that injects global uniforms
 * @param {Object} regl - The regl instance
 * @param {Object} params - Optional parameters
 * @returns {Function} Render wrapper command
 */
const renderContext = (regl, params = {}) => {
  const { fbo } = params

  const commandParams = {
    // Enable backface culling by default
    cull: {
      enable: true
    },

    // Global context values (computed once per scope, accessible to uniforms)
    context: {
      lightDirection: renderDefaults.lightDirection,
      // Compute inverse view once per frame - regl caches context values for the scope
      inverseView: (context, props) => {
        const view = props.camera?.view
        if (!view) return IDENTITY
        const inv = mat4.invert([], view)
        return inv || IDENTITY
      }
    },

    // Global uniforms available to all nested draw commands
    uniforms: {
      // Camera matrices
      view: (context, props) => props.camera.view,
      eye: (context, props) => props.camera.position,
      projection: (context, props) => props.camera.projection,
      camNear: (context, props) => props.camera.near,
      camFar: (context, props) => props.camera.far,

      // Inverted view matrix - reuse cached value from context
      invertedView: (context) => context.inverseView,

      // Lighting uniforms
      lightPosition: (context, props) =>
        props?.rendering?.lightPosition ?? renderDefaults.lightPosition,

      // Light direction follows camera (like Three.js directionalLight attached to camera)
      // Transform view-space light direction to world space (reuses cached inverse view)
      lightDirection: (context, props) => {
        const viewSpaceLight = props?.rendering?.lightDirection ?? renderDefaults.lightDirection
        return transformDirection([], viewSpaceLight, context.inverseView)
      },

      lightView: (context) =>
        mat4.lookAt([], context.lightDirection, [0.0, 0.0, 0.0], [0.0, 0.0, 1.0]),

      lightProjection: mat4.ortho([], -25, -25, -20, 20, -25, 25),

      lightColor: (context, props) =>
        props?.rendering?.lightColor ?? renderDefaults.lightColor,

      ambientLightAmount: (context, props) =>
        props?.rendering?.ambientLightAmount ?? renderDefaults.ambientLightAmount,

      diffuseLightAmount: (context, props) =>
        props?.rendering?.diffuseLightAmount ?? renderDefaults.diffuseLightAmount,

      specularLightAmount: (context, props) =>
        props?.rendering?.specularLightAmount ?? renderDefaults.specularLightAmount,

      uMaterialShininess: (context, props) =>
        props?.rendering?.materialShininess ?? renderDefaults.materialShininess,

      // Material colors (not typically used, but available)
      materialAmbient: [0.5, 0.8, 0.3],
      materialDiffuse: [0.5, 0.8, 0.3],
      materialSpecular: [0.5, 0.8, 0.3]
    },

    // Optional framebuffer for off-screen rendering
    framebuffer: fbo
  }

  return regl(Object.assign({}, commandParams, params.extras))
}

export default renderContext
