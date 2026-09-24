import { modelError } from './caps.js'

const sameValue = (a, b) => {
  if (a === b) return true
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object' || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const ATTRIBUTES = ['color', 'transforms', 'isTransparent', 'opacity']

/**
 * The meshes the page drew for the last completed run, by content hash. A run
 * sends a `ref` in place of a mesh whose hash it was told the page holds.
 */
export const createMeshRefs = () => {
  let byHash = new Map()

  const resolveOne = (entity) => {
    if (!entity?.ref) return entity
    const held = byHash.get(entity.hash)
    if (!held) throw modelError(`geometry refers to mesh ${entity.hash}, which the page does not hold`)
    // The same object lets the renderer reuse what it built for it.
    if (ATTRIBUTES.every((key) => sameValue(held[key], entity[key]))) return held
    const { color, transforms, isTransparent, opacity } = entity
    return { ...held, color, transforms, isTransparent, opacity, ...('id' in entity && { id: entity.id }), ref: undefined }
  }

  return {
    held: () => [...byHash.keys()],
    /** @param {Array<object>} entities */
    resolve: (entities) => entities.map(resolveOne),
    /** @param {Array<object>} entities */
    remember(entities) {
      byHash = new Map()
      for (const entity of entities) if (entity?.hash && !entity.ref) byHash.set(entity.hash, entity)
    },
    forget() {
      byHash = new Map()
    },
  }
}
