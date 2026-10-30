// The eval's `view` tool: the app's handler (src/viewHandler.js) over the
// conversation's last build, its triangles from the executor and its shots
// drawn by eval/render.js in this process.
import { dispatchTool } from '../src/dispatchTool.js'
import { createViewHandler } from '../src/viewHandler.js'
import { NO_TRIANGLES } from './mesh.js'

const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

const partsCenter = (parts) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 1) {
      min[i % 3] = Math.min(min[i % 3], positions[i])
      max[i % 3] = Math.max(max[i % 3], positions[i])
    }
  }
  return min.map((low, k) => (low + max[k]) / 2)
}

/**
 * @param {{
 *   mesh: () => Promise<{parts?: Array<{color: number[]|null, positions: Float32Array}>, error?: string}>,
 *   requestTool: (name: string, input: object) => Promise<string>,
 *   renderShots: (parts: Array<object>, plan: object) => Promise<Array<{pngDataUrl: string, camera: object}>>,
 * }} deps the conversation backend's `mesh` and `requestTool`, and the run's renderer
 * @returns {(input: unknown) => Promise<object|string>} `{ok: true, shots}`, or a tool error's JSON
 */
export const createEvalView = ({ mesh, requestTool, renderShots }) => {
  const measured = async (options) => JSON.parse(await requestTool('measure', options))
  const handler = createViewHandler({
    getMesh: async () => {
      const got = await mesh()
      if (got.parts) return got.parts
      if (got.error === NO_TRIANGLES) return []
      throw named('ViewRenderError', got.error)
    },
    // measure on an unbuilt model answers the last build's own no-geometry error.
    noGeometry: () => measured({}),
    measure: async (options) => {
      const result = await measured(options)
      if (result?.ok === false) throw named(result.error?.name ?? 'Error', result.error?.message ?? 'measure failed')
      return result
    },
    render: renderShots,
    center: partsCenter,
  })
  return async (input) => {
    const out = await dispatchTool('view', input, { view: handler })
    return out?.ok === false ? JSON.stringify(out) : out
  }
}

// What the live log and the result file keep of a view result: the camera stub the loop sends as text, no image data.
export const viewStub = (result) =>
  typeof result === 'string' ? result : JSON.stringify({ ok: result?.ok ?? true, cameras: (result?.shots ?? []).map((shot) => shot.camera) })

export const withoutImages = (message) => {
  if (message.role !== 'tool' || message.images === undefined) return message
  const { images: _images, ...rest } = message
  return rest
}
