/**
 * Perspective camera module
 * Handles view and projection matrix calculations
 */

import * as mat4 from 'gl-mat4'
import * as vec3 from 'gl-vec3'

// Default camera state
export const cameraState = {
  view: mat4.identity(new Float32Array(16)),
  projection: mat4.identity(new Float32Array(16)),
  matrix: mat4.identity(new Float32Array(16)),
  near: 1,
  far: 50000,
  up: [0, 0, 1], // Z-up coordinate system (CAD convention)
  eye: new Float32Array(3),
  position: [180, -180, 220],
  target: [0, 0, 0],
  fov: Math.PI / 4, // 45 degrees
  aspect: 1,
  viewport: [0, 0, 0, 0],
  projectionType: 'perspective'
}

export const defaults = Object.assign({}, cameraState)

/**
 * Set the projection matrix based on viewport dimensions
 * @param {Object} output - Output object to store results (optional)
 * @param {Object} camera - Camera state
 * @param {Object} input - Input dimensions { width, height }
 * @returns {Object} Updated camera state with projection
 */
export const setProjection = (output, camera, input) => {
  const aspect = input.width / input.height

  const projection = mat4.perspective(
    mat4.identity([]),
    camera.fov,
    aspect,
    camera.near,
    camera.far
  )
  const viewport = [0, 0, input.width, input.height]

  const out = output || {}
  out.projection = projection
  out.aspect = aspect
  out.viewport = viewport

  return out
}

/**
 * Update the view matrix based on camera position and target
 * @param {Object} output - Output object to store results (optional)
 * @param {Object} camera - Camera state (optional, uses output if not provided)
 * @returns {Object} Updated camera state with view matrix
 */
export const update = (output, camera) => {
  if (!camera) {
    camera = output
  }
  const { position, target, up } = camera
  const offset = vec3.subtract([], position, target)
  const newPosition = vec3.add(vec3.create(), target, offset)
  const newView = mat4.lookAt(mat4.create(), newPosition, target, up)

  const out = output || {}
  out.position = newPosition
  out.view = newView
  return out
}

export default { cameraState, defaults, setProjection, update }
