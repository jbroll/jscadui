/**
 * Orbit controls for camera manipulation
 * Handles rotate, pan, zoom with momentum/elasticity
 */

import * as vec3 from 'gl-vec3'
import * as mat4 from 'gl-mat4'

const { max, min, sqrt, PI, sin, cos, atan2 } = Math

// Control properties
export const controlsProps = {
  limits: {
    minDistance: 0.01,
    maxDistance: 10000
  },
  drag: 0.27, // Momentum decay per frame
  EPS: 0.000001,
  userControl: {
    zoom: true,
    zoomSpeed: 1.0,
    rotate: true,
    rotateSpeed: 1.0,
    pan: true,
    panSpeed: 1.0
  },
  autoRotate: {
    enabled: false,
    speed: 1.0
  }
}

// Control state
export const controlsState = {
  thetaDelta: 0,
  phiDelta: 0,
  scale: 1
}

export const defaults = Object.assign({}, controlsState, controlsProps)

/**
 * Update camera position based on control state (with momentum)
 */
export const update = ({ controls, camera }, _output) => {
  const { EPS, drag } = controls
  const { position, target } = camera
  const up = controls.up ? controls.up : camera.up

  let curThetaDelta = controls.thetaDelta
  const curPhiDelta = controls.phiDelta
  const curScale = controls.scale

  const offset = vec3.subtract([], position, target)
  let theta
  let phi

  if (up[2] === 1) {
    // Z-up coordinate system
    theta = atan2(offset[0], offset[1])
    phi = atan2(sqrt(offset[0] * offset[0] + offset[1] * offset[1]), offset[2])
  } else {
    // Y-up coordinate system
    theta = atan2(offset[0], offset[2])
    phi = atan2(sqrt(offset[0] * offset[0] + offset[2] * offset[2]), offset[1])
  }

  if (controls.autoRotate?.enabled && controls.userControl?.rotate) {
    curThetaDelta += 2 * Math.PI / 60 / 60 * controls.autoRotate.speed
  }

  theta += curThetaDelta
  phi += curPhiDelta

  // Restrict phi to be between EPS and PI-EPS
  phi = max(EPS, min(PI - EPS, phi))

  // Apply scale and restrict radius to limits
  const radius = max(
    controls.limits.minDistance,
    min(controls.limits.maxDistance, vec3.length(offset) * curScale)
  )

  if (up[2] === 1) {
    offset[0] = radius * sin(phi) * sin(theta)
    offset[2] = radius * cos(phi)
    offset[1] = radius * sin(phi) * cos(theta)
  } else {
    offset[0] = radius * sin(phi) * sin(theta)
    offset[1] = radius * cos(phi)
    offset[2] = radius * sin(phi) * cos(theta)
  }

  const newPosition = vec3.add(vec3.create(), target, offset)
  const newView = mat4.lookAt(mat4.create(), newPosition, target, up)

  const dragEffect = 1 - max(min(drag, 1.0), 0.01)
  const positionChanged = vec3.distance(position, newPosition) > 0.001

  return {
    controls: {
      thetaDelta: curThetaDelta * dragEffect,
      phiDelta: curPhiDelta * dragEffect,
      scale: 1,
      changed: positionChanged
    },
    camera: {
      position: newPosition,
      view: newView
    }
  }
}

/**
 * Compute camera state for rotation
 */
export const rotate = ({ controls, camera, speed = 1 }, angle) => {
  let { thetaDelta, phiDelta } = controls

  if (controls.userControl?.rotate) {
    thetaDelta += (angle[0] * speed)
    phiDelta += (angle[1] * speed)
  }

  return {
    controls: { thetaDelta, phiDelta },
    camera
  }
}

/**
 * Compute camera state for zoom
 */
export const zoom = ({ controls, camera, speed = 1 }, zoomDelta = 0) => {
  let { scale } = controls

  if (controls.userControl?.zoom && camera && zoomDelta !== undefined && zoomDelta !== 0 && !isNaN(zoomDelta)) {
    const sign = Math.sign(zoomDelta) === 0 ? 1 : Math.sign(zoomDelta)
    zoomDelta = (zoomDelta / zoomDelta) * sign * speed

    const newScale = (zoomDelta + controls.scale)
    const newDistance = vec3.distance(camera.position, camera.target) * newScale

    if (newDistance > controls.limits.minDistance && newDistance < controls.limits.maxDistance) {
      scale += zoomDelta
    }
  }
  return { controls: { scale }, camera }
}

/**
 * Compute camera state for panning
 */
export const pan = ({ controls, camera, speed = 1 }, delta) => {
  const { view } = camera

  // Simple pan calculation based on screen delta
  const eyeDistance = vec3.distance(camera.position, camera.target)
  const panScale = eyeDistance * 0.002 * speed

  const right = [view[0], view[4], view[8]]
  const up = [view[1], view[5], view[9]]

  const offset = vec3.create()
  vec3.scaleAndAdd(offset, offset, right, -delta[0] * panScale)
  vec3.scaleAndAdd(offset, offset, up, delta[1] * panScale)

  return {
    controls,
    camera: {
      position: vec3.add(vec3.create(), camera.position, offset),
      target: vec3.add(vec3.create(), camera.target, offset)
    }
  }
}

/**
 * Compute camera state to fit entities on screen
 * @param {Object} params - { controls, camera, bounds }
 * @param {Object} bounds - { center, dia } from computeBounds
 * @param {number} tightness - How close the fit should be (lower = tighter, default 1.5)
 * @returns {Object} Updated { controls, camera }
 */
export const zoomToFit = ({ controls, camera, bounds }, tightness = 1.5) => {
  if (!bounds || bounds.dia === 0) {
    return { controls, camera }
  }

  const { fov, target, position } = camera
  const { center, dia } = bounds

  // Calculate ideal distance from camera to fit the bounding sphere
  const idealDistance = (dia * tightness) / Math.tan(fov / 2.0)
  const currentDistance = vec3.distance(target, position)
  const scaleForIdealDistance = idealDistance / currentDistance

  return {
    camera: { target: center },
    controls: { scale: scaleForIdealDistance }
  }
}

/**
 * Reset controls and camera to a desired state
 * @param {Object} params - { controls, camera }
 * @param {Object} desiredState - State to reset to (defaults to initial defaults)
 * @returns {Object} Updated { controls, camera }
 */
export const reset = ({ controls: _controls, camera }, desiredState = {}) => {
  const defaultCamera = {
    position: [180, -180, 220],
    target: [0, 0, 0]
  }

  const defaultControls = {
    thetaDelta: 0,
    phiDelta: 0,
    scale: 1
  }

  const targetCamera = desiredState.camera || defaultCamera
  const targetControls = desiredState.controls || defaultControls

  const up = camera.up || [0, 0, 1]
  const newPosition = targetCamera.position || defaultCamera.position
  const newTarget = targetCamera.target || defaultCamera.target
  const newView = mat4.lookAt(mat4.create(), newPosition, newTarget, up)

  // Recompute projection if camera has fov/aspect
  let projection = camera.projection
  if (camera.fov && camera.aspect) {
    projection = mat4.perspective([], camera.fov, camera.aspect, camera.near || 1, camera.far || 50000)
  }

  return {
    camera: {
      position: newPosition,
      target: newTarget,
      view: newView,
      projection
    },
    controls: {
      thetaDelta: targetControls.thetaDelta ?? 0,
      phiDelta: targetControls.phiDelta ?? 0,
      scale: targetControls.scale ?? 1
    }
  }
}

/**
 * Set auto-rotate state
 * @param {Object} controls - Current controls state
 * @param {boolean} enabled - Enable/disable auto-rotate
 * @param {number} speed - Rotation speed (default 1.0)
 * @returns {Object} Updated controls
 */
export const setAutoRotate = (currentControls, enabled, speed = 1.0) => {
  return {
    ...currentControls,
    autoRotate: {
      enabled,
      speed
    }
  }
}

export default {
  controlsProps,
  controlsState,
  defaults,
  update,
  rotate,
  zoom,
  pan,
  zoomToFit,
  reset,
  setAutoRotate
}
