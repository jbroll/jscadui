import { meshHash } from '@jscadui/format-common'

const BUFFERS = ['vertices', 'indices', 'normals', 'colors']
const REF_FIELDS = ['color', 'transforms', 'isTransparent', 'opacity', 'id']

const buffersOf = (entity) => BUFFERS.map(field => entity[field]).filter(view => ArrayBuffer.isView(view))

/**
 * Replaces each mesh the page already holds with a reference to it by hash,
 * and takes the buffers of those meshes off the transfer list.
 * @param {object[]} entities
 * @param {Set<string>} held
 * @param {unknown[]} transferable
 * @returns {object[]}
 */
export const toRefs = (entities, held, transferable) => {
  const dropped = []
  const out = entities.map(entity => {
    if (entity.type !== 'mesh') return entity
    const hash = meshHash(entity)
    if (!held.has(hash)) return { ...entity, hash }
    const ref = { type: entity.type, hash, ref: true }
    for (const field of REF_FIELDS) if (field in entity) ref[field] = entity[field]
    dropped.push(...buffersOf(entity))
    return ref
  })
  // A held mesh can share an array with an unheld entity in the same batch, which still needs it sent
  const kept = new Set(out.flatMap(buffersOf))
  for (const view of dropped) {
    const i = transferable.indexOf(view)
    if (i !== -1 && !kept.has(view)) transferable.splice(i, 1)
  }
  return out
}
