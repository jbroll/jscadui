const FIELDS = ['vertices', 'indices', 'normals', 'colors']

// Two 32-bit FNV-1a lanes with different offsets make a 64-bit hash. Buffers
// are fed a 32-bit word at a time; the shift carries high bits down, which a
// multiply alone never does.
export const meshHash = (entity) => {
  let a = 0x811c9dc5
  let b = 0xcbf29ce4
  const feed = (value) => {
    a = Math.imul(a ^ value, 0x01000193)
    a ^= a >>> 15
    b = Math.imul(b ^ value, 0x01000193) ^ (a >>> 15)
  }
  const feedString = (s) => { for (let i = 0; i < s.length; i++) feed(s.charCodeAt(i) & 0xff) }
  const feedWords = (view) => {
    const words = view.byteLength >>> 2
    if (view.byteOffset % 4 === 0) {
      const aligned = new Uint32Array(view.buffer, view.byteOffset, words)
      for (let i = 0; i < words; i++) feed(aligned[i])
    } else {
      // Little-endian like the typed array a browser would give, so alignment never changes the hash
      const data = new DataView(view.buffer, view.byteOffset, view.byteLength)
      for (let i = 0; i < words; i++) feed(data.getUint32(i * 4, true))
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset + words * 4, view.byteLength - words * 4)
    for (let i = 0; i < bytes.length; i++) feed(bytes[i])
  }
  feedString(entity.type ?? '')
  for (const field of FIELDS) {
    const view = entity[field]
    if (!ArrayBuffer.isView(view)) continue
    feedString(field)
    feedString(String(view.byteLength))
    feedWords(view)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
