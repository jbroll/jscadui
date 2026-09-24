const FIELDS = ['vertices', 'indices', 'normals', 'colors']

// Two 32-bit FNV-1a lanes with different offsets make a 64-bit hash
export const meshHash = (entity) => {
  let a = 0x811c9dc5
  let b = 0xcbf29ce4
  const feed = (byte) => {
    a = Math.imul(a ^ byte, 0x01000193)
    b = Math.imul(b ^ byte, 0x01000193) ^ (a >>> 15)
  }
  const feedString = (s) => { for (let i = 0; i < s.length; i++) feed(s.charCodeAt(i) & 0xff) }
  feedString(entity.type ?? '')
  for (const field of FIELDS) {
    const view = entity[field]
    if (!ArrayBuffer.isView(view)) continue
    feedString(field)
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    feedString(String(bytes.length))
    for (let i = 0; i < bytes.length; i++) feed(bytes[i])
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
