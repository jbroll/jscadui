import { boundingBox } from '@jscadui/format-common'
import { capGeometry, checkLimits, DEFAULT_CAPS, geometryBytes, STREAM_CAPS } from './caps.js'
import { countGeometry } from './stats.js'

const mergeBox = (a, b) => a ? {
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
} : b

const hasVertices = (entities) => entities.some((e) => e?.vertices?.length)

/**
 * One streamed run at a time: the batches a grid sends while the load or
 * parameter change that started it is current.
 * @param {{draw: (entities: object[], box: object | null) => void, onCells: (count: number) => void, onError: (error: Error) => void, delayMs?: number}} options
 */
export const createStreamRuns = ({ draw, onCells, onError, delayMs = 250 }) => {
  let run = null

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

  return {
    begin(isStale) {
      if (run) clearTimeout(run.timer)
      run = { isStale, entities: [], bytes: 0, cells: 0, vertices: 0, triangles: 0, box: null, timer: null, dirty: false }
    },
    accept(batch) {
      if (!run || run.isStale()) return false
      const entities = Array.isArray(batch) ? batch : []
      try {
        capGeometry(entities, DEFAULT_CAPS)
        const bytes = geometryBytes(entities)
        checkLimits(run.entities.length + entities.length, run.bytes + bytes, STREAM_CAPS)
        run.bytes += bytes
      } catch (error) {
        stop()
        onError(error)
        return false
      }
      for (const entity of entities) run.entities.push(entity)
      const { vertices, triangles } = countGeometry(entities)
      run.vertices += vertices
      run.triangles += triangles
      if (hasVertices(entities)) run.box = mergeBox(run.box, boundingBox(entities))
      run.cells++
      onCells(run.cells)
      run.dirty = true
      run.timer ??= setTimeout(flush, delayMs)
      return true
    },
    finish() {
      if (!run || run.isStale()) {
        if (run) clearTimeout(run.timer)
        run = null
        return null
      }
      flush(true)
      const { cells, vertices, triangles } = run
      run = null
      return { cells, vertices, triangles }
    },
    end: stop,
  }
}
