import { boundingBox } from '@jscadui/format-common'
import { capGeometry, checkBuffers, checkLimits, DEFAULT_CAPS, geometryBytes, STREAM_CAPS } from './caps.js'
import { countGeometry } from './stats.js'

const mergeBox = (a, b) => a ? {
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
} : b

const hasVertices = (entities) => entities.some((e) => e?.vertices?.length)

const lostError = (lost) => {
  const leaves = lost.map((leaf) => `${leaf?.url} (${leaf?.reason})`).join(' ')
  const error = new Error(`${lost.length} grid model(s) stopped: ${leaves}`)
  error.name = lost.every((leaf) => leaf?.reason === 'TimeoutError') ? 'TimeoutError' : 'Error'
  return error
}

/**
 * One streamed run at a time: the batches a grid sends while the load or
 * parameter change that started it is current. Batches and the final result
 * carry the request's runId, so an older request's late cells are dropped.
 * @param {{draw: (entities: object[], box: object | null) => void, onCells: (count: number) => void, onError: (error: Error) => void, resolve?: (entities: object[]) => object[], delayMs?: number}} options
 */
export const createStreamRuns = ({ draw, onCells, onError, resolve = (e) => e, delayMs = 250 }) => {
  let run = null
  const owns = (runId) => run !== null && run.id === runId

  const flush = (always = false) => {
    if (!run) return
    clearTimeout(run.timer)
    run.timer = null
    if (run.isStale() || !(run.dirty || always)) return
    run.dirty = false
    draw(run.entities, run.box)
  }

  const stop = () => {
    flush()
    run = null
  }

  const drop = () => {
    if (run) clearTimeout(run.timer)
    run = null
  }

  return {
    begin(isStale, runId) {
      if (run) clearTimeout(run.timer)
      run = { id: runId, isStale, entities: [], bytes: 0, cells: 0, vertices: 0, triangles: 0, box: null, timer: null, dirty: false }
    },
    accept(batch, runId) {
      if (!owns(runId) || run.isStale()) return false
      // Drop non-object entries here so nothing downstream (caps, countGeometry) has to guard against them.
      let entities = (Array.isArray(batch) ? batch : []).filter((e) => e && typeof e === 'object')
      let bytes, counts, box
      try {
        entities = resolve(entities)
        checkBuffers(entities)
        capGeometry(entities, DEFAULT_CAPS)
        bytes = geometryBytes(entities)
        checkLimits(run.entities.length + entities.length, run.bytes + bytes, STREAM_CAPS)
        counts = countGeometry(entities)
        box = hasVertices(entities) ? mergeBox(run.box, boundingBox(entities)) : run.box
      } catch (error) {
        stop()
        onError(error)
        return false
      }
      for (const entity of entities) run.entities.push(entity)
      run.bytes += bytes
      run.vertices += counts.vertices
      run.triangles += counts.triangles
      run.box = box
      run.cells++
      onCells(run.cells)
      run.dirty = true
      run.timer ??= setTimeout(flush, delayMs)
      return true
    },
    // A leaf that timed out on its worker leaves its cell empty; the rest stay drawn.
    finish(runId, lost = []) {
      if (!owns(runId)) return null
      if (run.isStale()) {
        drop()
        return null
      }
      flush(true)
      const { cells, vertices, triangles } = run
      run = null
      const missing = Array.isArray(lost) ? lost : []
      if (missing.length) onError(lostError(missing))
      return { cells, vertices, triangles, lost: missing.length }
    },
    end(runId) {
      if (owns(runId)) stop()
    },
    // A whole result replaced the model, so a pending redraw must not paint over it.
    discard: drop,
  }
}
