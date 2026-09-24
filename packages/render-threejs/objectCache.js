/**
 * Three.js objects built for each entity, kept across setScene calls so a
 * streamed grid's redraw builds only the cells that just arrived. Keyed by
 * the entity object: ids repeat when copies share a mesh.
 * @param {(obj3d: object) => void} dispose
 */
export const createObjectCache = (dispose) => {
  let kept = new Map()
  let next = new Map()
  let extra = []
  let staleExtra = []
  let timer = null
  let pendingStale = null

  const disposeAll = (list) => list.forEach((obj3d) => dispose(obj3d))

  return {
    begin(reset) {
      if (reset) {
        disposeAll([...kept.values(), ...extra])
        kept = new Map()
        extra = []
      }
      next = new Map()
      staleExtra = extra
      extra = []
    },
    get(entity, build) {
      if (next.has(entity)) {
        const obj3d = build(entity)
        if (obj3d) extra.push(obj3d)
        return obj3d
      }
      let obj3d = kept.get(entity)
      if (obj3d) kept.delete(entity)
      else obj3d = build(entity)
      if (obj3d) next.set(entity, obj3d)
      return obj3d
    },
    end() {
      // A scene can turn over faster than the setTimeout(0) below fires;
      // flush the still-pending stale list rather than let it outlive clear().
      if (pendingStale) {
        clearTimeout(timer)
        disposeAll(pendingStale)
      }
      const stale = [...kept.values(), ...staleExtra]
      kept = next
      next = new Map()
      staleExtra = []
      pendingStale = stale
      timer = setTimeout(() => {
        timer = null
        pendingStale = null
        disposeAll(stale)
      }, 0)
    },
    clear() {
      clearTimeout(timer)
      timer = null
      if (pendingStale) {
        disposeAll(pendingStale)
        pendingStale = null
      }
      disposeAll([...kept.values(), ...next.values(), ...extra, ...staleExtra])
      kept = new Map()
      next = new Map()
      extra = []
      staleExtra = []
    },
  }
}
