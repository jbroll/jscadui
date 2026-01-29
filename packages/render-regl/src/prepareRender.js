/**
 * Prepare render function
 * Creates the main rendering pipeline with regl
 */

import renderContext from './renderContext.js'
import renderDefaults from './renderDefaults.js'
import { createDrawCommands } from './commands/createCommands.js'

/**
 * Prepares the rendering pipeline
 * @param {Object} params - Configuration parameters
 * @param {Object} params.glOptions - WebGL context options
 * @param {Object} params.regl - Optional pre-created regl instance
 * @returns {Function} Render function
 */
const prepareRender = (params) => {
  const defaults = {}
  const options = Object.assign(
    {},
    defaults,
    params.glOptions,
    {
      onDone: (err, callback) => {
        if (err) {
          throw err
        }
      }
    }
  )

  // Create regl instance (import dynamically or use provided)
  let regl
  if (params.regl) {
    regl = params.regl
  } else {
    // Dynamic import for regl - caller must provide gl context
    const createRegl = params.createRegl
    if (!createRegl) {
      throw new Error('prepareRender requires either params.regl or params.createRegl')
    }
    regl = createRegl(options)
  }

  // Draw command cache for performance
  const drawCache = new Map()

  // Get the draw command factories
  const drawCommands = createDrawCommands()

  // Create the render context wrapper
  const contextWrapper = renderContext(regl)

  // Main render command
  const command = (props) => {
    // Merge rendering defaults
    props.rendering = Object.assign({}, renderDefaults, props.rendering)

    // Execute within render context (sets up global uniforms)
    contextWrapper(props, (context) => {
      // Clear the framebuffer
      regl.clear({
        color: props.rendering.background,
        depth: 1
      })

      // Render entities
      if (props.entities) {
        // Sort: opaque first, then transparent
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

              // Check cache
              if (visuals.cacheId !== undefined) {
                drawCmd = drawCache.get(visuals.cacheId)
              }

              // Create and cache if not found
              if (!drawCmd) {
                visuals.cacheId = drawCache.size
                drawCmd = drawCommands[visuals.drawCmd](regl, entity)
                drawCache.set(visuals.cacheId, drawCmd)
              }

              // Execute draw command
              const drawParams = {
                ...entity,
                ...visuals,
                camera: props.camera
              }
              drawCmd(drawParams)
            }
          })
      }
    })
  }

  // Return the render function
  return function render(data) {
    // Poll for resize and other events
    regl.poll()
    // Execute render
    command(data)
  }
}

export default prepareRender
