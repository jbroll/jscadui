/**
 * Self-contained Regl renderer for JSCAD
 * Can work standalone with built-in shaders, or use external @jscad/regl-renderer
 */

import { CommonToRegl } from '@jscadui/format-regl'

// Internal modules
import perspectiveCamera from './src/camera/perspective.js'
import orbitControls from './src/controls/orbitControls.js'
import renderDefaults from './src/renderDefaults.js'
import renderContext from './src/renderContext.js'
import { createDrawCommands } from './src/commands/createCommands.js'

/**
 * Create a Regl renderer
 * @param {Object|Function} reglOrOptions - Either the regl library function, or an options object with external renderer
 * @returns {Function} Viewer factory function
 */
export function RenderRegl(reglOrOptions) {
  // Determine if we're using external @jscad/regl-renderer or standalone mode
  const isExternalRenderer = reglOrOptions && typeof reglOrOptions === 'object' &&
    'prepareRender' in reglOrOptions && 'drawCommands' in reglOrOptions

  // External renderer mode (backward compatible)
  let externalPrepareRender, externalDrawCommands, externalCameras, externalControls

  if (isExternalRenderer) {
    externalPrepareRender = reglOrOptions.prepareRender
    externalDrawCommands = reglOrOptions.drawCommands
    externalCameras = reglOrOptions.cameras
    externalControls = reglOrOptions.controls
  }

  // Camera/control speeds
  const rotateSpeed = 0.002
  const panSpeed = 1
  const zoomSpeed = 0.08

  // State variables (per-viewer closure)
  let rotateDelta = [0, 0]
  let panDelta = [0, 0]
  let zoomDelta = 0
  let updateRender = true
  let meshColor = [1, 1, 1]
  let currentOrbitControls, renderOptions, renderer

  const csgConvert = CommonToRegl()
  const entities = []

  /**
   * Create a WebGL context with fallback chain
   * Prefer WebGL 1 over WebGL 2 because regl's uint32 element support
   * relies on the OES_element_index_uint extension which doesn't exist in WebGL 2
   * (it's built into the core, but regl doesn't detect this properly)
   */
  function createContext(canvas, contextAttributes) {
    function get(type) {
      try {
        return { gl: canvas.getContext(type, contextAttributes), type }
      } catch (_e) {
        return null
      }
    }
    // Prefer WebGL 1 for proper uint32 element index extension support
    return get('webgl') || get('experimental-webgl') || get('webgl-experimental') || get('webgl2')
  }

  const state = {}
  let currentPerspectiveCamera

  /**
   * Start the renderer
   */
  const startRenderer = ({ canvas, cameraPosition = [180, -180, 220], cameraTarget = [0, 0, 0], bg = [1, 1, 1] }) => {
    // Use external or internal camera/controls
    currentPerspectiveCamera = isExternalRenderer ? externalCameras.perspective : perspectiveCamera
    currentOrbitControls = isExternalRenderer ? externalControls.orbit : orbitControls

    state.canvas = canvas
    canvas.style.background = 'black'

    // Initialize camera state
    state.camera = Object.assign({}, currentPerspectiveCamera.defaults)
    if (cameraPosition) state.camera.position = cameraPosition
    if (cameraTarget) state.camera.target = cameraTarget

    resize({ width: canvas.width, height: canvas.height })

    // Initialize controls state
    state.controls = Object.assign({}, currentOrbitControls.defaults)

    // Create WebGL context
    const { gl, type: _type } = createContext(canvas)
    if (!gl) {
      throw new Error('WebGL not supported')
    }

    // Setup options
    // Always request uint32 element index extension (required for large meshes)
    // WebGL 2 has it built-in, but regl still needs to know about it
    // Also request OES_standard_derivatives for dFdx/dFdy in flat shading
    const setupOptions = {
      glOptions: {
        gl,
        optionalExtensions: ['oes_element_index_uint', 'oes_standard_derivatives']
      }
    }

    // Create renderer
    if (isExternalRenderer) {
      // Use external prepareRender
      renderer = externalPrepareRender(setupOptions)
    } else {
      // Use internal renderer
      // Dynamically import regl and create renderer
      import('regl').then(reglModule => {
        const createRegl = reglModule.default
        const regl = createRegl(setupOptions.glOptions)

        // Create draw cache
        const drawCache = new Map()
        const drawCommands = createDrawCommands()
        const contextWrapper = renderContext(regl)

        // Create render function
        renderer = (props) => {
          props.rendering = Object.assign({}, renderDefaults, props.rendering)

          contextWrapper(props, () => {
            regl.clear({
              color: props.rendering.background,
              depth: 1
            })

            if (props.entities) {
              props.entities
                .sort((a, b) => {
                  const aTransparent = a.visuals?.transparent ?? false
                  const bTransparent = b.visuals?.transparent ?? false
                  return (aTransparent === bTransparent) ? 0 : aTransparent ? 1 : -1
                })
                .forEach((entity) => {
                  const { visuals } = entity
                  const show = visuals?.show ?? true

                  if (show && visuals.drawCmd && drawCommands[visuals.drawCmd]) {
                    let drawCmd

                    if (visuals.cacheId !== undefined) {
                      drawCmd = drawCache.get(visuals.cacheId)
                    }

                    if (!drawCmd) {
                      visuals.cacheId = drawCache.size
                      drawCmd = drawCommands[visuals.drawCmd](regl, entity)
                      drawCache.set(visuals.cacheId, drawCmd)
                    }

                    drawCmd({
                      ...entity,
                      ...visuals,
                      camera: props.camera
                    })
                  }
                })
            }
          })

          regl.poll()
        }

        // Attach cleanup method to renderer (C1 fix - WebGL memory leak)
        renderer.destroy = () => {
          // Destroy all cached draw commands and their WebGL buffers
          drawCache.forEach(cmd => {
            if (cmd && typeof cmd.destroy === 'function') {
              cmd.destroy()
            }
          })
          drawCache.clear()
          // Destroy the regl instance
          if (regl && typeof regl.destroy === 'function') {
            regl.destroy()
          }
        }

        updateView()
      }).catch(err => {
        console.error('Failed to load regl:', err)
        throw err
      })
    }

    // Assemble render options
    renderOptions = {
      camera: state.camera,
      rendering: {
        background: bg
      },
      drawCommands: isExternalRenderer ? {
        drawAxis: externalDrawCommands.drawAxis,
        drawGrid: externalDrawCommands.drawGrid,
        drawLines: externalDrawCommands.drawLines,
        drawMesh: externalDrawCommands.drawMesh
      } : {},
      entities
    }

    // H15 fix: Only call updateView here for external renderer
    // Internal renderer calls updateView inside the dynamic import .then() callback
    if (isExternalRenderer) {
      updateView()
    }
  }

  let renderTimer
  const tmFunc = typeof requestAnimationFrame === 'undefined' ? setTimeout : requestAnimationFrame

  function updateView(delay = 8) {
    if (renderTimer || !renderer) return
    renderTimer = tmFunc(updateAndRender, delay)
  }

  const doRotatePanZoom = () => {
    if (rotateDelta[0] || rotateDelta[1]) {
      const updated = currentOrbitControls.rotate(
        { controls: state.controls, camera: state.camera, speed: rotateSpeed },
        rotateDelta
      )
      state.controls = { ...state.controls, ...updated.controls }
      rotateDelta = [0, 0]
    }

    if (panDelta[0] || panDelta[1]) {
      const updated = currentOrbitControls.pan(
        { controls: state.controls, camera: state.camera, speed: panSpeed },
        panDelta
      )
      state.controls = { ...state.controls, ...updated.controls }
      panDelta = [0, 0]
      state.camera.position = updated.camera.position
      state.camera.target = updated.camera.target
    }

    if (zoomDelta) {
      const updated = currentOrbitControls.zoom(
        { controls: state.controls, camera: state.camera, speed: zoomSpeed },
        zoomDelta
      )
      state.controls = { ...state.controls, ...updated.controls }
      zoomDelta = 0
    }
  }

  const updateAndRender = _timestamp => {
    renderTimer = null
    doRotatePanZoom()

    const updates = currentOrbitControls.update({ controls: state.controls, camera: state.camera })
    state.controls = { ...state.controls, ...updates.controls }
    if (state.controls.changed) updateView(16) // Elasticity animation

    state.camera.position = updates.camera.position
    currentPerspectiveCamera.update(state.camera)
    renderOptions.entities = entities

    if (renderer) {
      renderer(renderOptions)
    }

    if (updateRender) {
      updateRender = ''
    }
  }

  function resize({ width, height }) {
    state.canvas.width = width
    state.canvas.height = height
    currentPerspectiveCamera.setProjection(state.camera, state.camera, { width, height })
    currentPerspectiveCamera.update(state.camera, state.camera)
    updateView()
  }

  const setBg = (bg = [1, 1, 1]) => {
    renderOptions.rendering.background = bg
    updateView()
  }

  const setMeshColor = (color = [1, 1, 1]) => {
    meshColor = color
  }

  const handlers = {
    pan: ({ dx, dy }) => {
      panDelta[0] += dx
      panDelta[1] += dy
      updateView()
    },
    resize,
    rotate: ({ dx, dy }) => {
      rotateDelta[0] -= dx
      rotateDelta[1] -= dy
      updateView()
    },
    zoom: ({ dy }) => {
      zoomDelta += dy
      updateView()
    }
  }

  function receiveCmd(cmd) {
    const fn = handlers[cmd.action]
    if (!fn) {
      throw new Error('no handler for type: ' + cmd.action)
    }
    fn(cmd)
  }

  function sendCmd(cmd) {
    receiveCmd(cmd)
  }

  // Pointer event handlers (currently disabled in favor of external orbit controls)
  let lastX = 0
  let lastY = 0
  let pointerDown = false
  let canvas

  const _moveHandler = ev => {
    if (!pointerDown) return
    const cmd = {
      dx: lastX - ev.pageX,
      dy: ev.pageY - lastY
    }
    const shiftKey = ev.shiftKey === true || (ev.touches && ev.touches.length > 2)
    cmd.action = shiftKey ? 'pan' : 'rotate'
    sendCmd(cmd)
    lastX = ev.pageX
    lastY = ev.pageY
    ev.preventDefault()
  }

  const _downHandler = ev => {
    pointerDown = true
    lastX = ev.pageX
    lastY = ev.pageY
    canvas.setPointerCapture(ev.pointerId)
  }

  const _upHandler = ev => {
    pointerDown = false
    canvas.releasePointerCapture(ev.pointerId)
  }

  const _wheelHandler = ev => {
    sendCmd({ action: 'zoom', dy: ev.deltaY })
    ev.preventDefault()
  }

  /**
   * Create a viewer instance
   */
  return function JscadReglViewer(el, { camera = {}, bg = [1, 1, 1] } = {}) {
    canvas = document.createElement('CANVAS')
    el.appendChild(canvas)

    const destroy = () => {
      if (renderTimer) {
        cancelAnimationFrame(renderTimer)
        renderTimer = null
      }
      entities.length = 0
      renderer?.destroy?.()
      renderer = null
      el.removeChild(canvas)
    }

    try {
      startRenderer({ canvas, cameraPosition: camera.position, cameraTarget: camera.target, bg })

      // Orbit controls disabled by default (use external @jscadui/orbit)
      // Uncomment to enable built-in controls:
      // canvas.onpointermove = moveHandler
      // canvas.onpointerdown = downHandler
      // canvas.onpointerup = upHandler
      // canvas.onwheel = wheelHandler
    } catch (error) {
      destroy()
      throw error
    }

    function setCamera({ position, target }) {
      if (position) state.camera.position = position
      if (target) state.camera.target = target
      updateView()
    }

    function getCamera() {
      return {
        position: Array.from(state.camera.position),
        target: state.camera.target,
        // Convert fov from radians to degrees for consistency with Three.js
        fov: state.camera.fov * (180 / Math.PI),
        aspect: state.camera.aspect
      }
    }

    const getViewerEnv = () => ({
      forceColors4: false,
      forceIndex: false,
      forceNormals: true,
      useInstances: true
    })

    function setScene(_scene) {
      entities.length = 0
      const transparent = []
      _scene.items.forEach(item => {
        item.items.forEach(obj => {
          const entity = csgConvert(obj, _scene, meshColor)
          if (entity.transparent) {
            transparent.push(entity)
          } else {
            entities.push(entity)
          }
        })
      })
      // Transparent entities rendered last
      transparent.forEach(e => entities.push(e))
      updateView()
    }

    return { sendCmd, resize, destroy, state, getCamera, setCamera, setBg, setMeshColor, getViewerEnv, setScene }
  }
}

// Also export the internal modules for direct usage
export { perspectiveCamera, orbitControls, renderDefaults, createDrawCommands }

// Export scene helpers (grid, axes)
export { makeGrid, makeAxes, createSceneHelpers, gridColors } from './src/helpers/sceneHelpers.js'

// Export bounds utilities
export { boundingBox, computeBounds, computeEntityBounds } from './src/utils/bounds.js'
