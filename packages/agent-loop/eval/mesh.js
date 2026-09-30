// The grade executor's `mesh` request: each part's colour and triangles in pages under the reply cap.
import { createHash } from 'node:crypto'
import { wrapOne } from '@jscadui/model-tools/src/array-geom.js'
import { isRecord } from './executor-protocol.js'

export const MAX_MESH_BYTES = 24 * 1024 * 1024
const TRIANGLE_BYTES = 9 * 4
const TRIANGLE_CHARS = (TRIANGLE_BYTES / 3) * 4
// A page's pieces in JSON characters, under the 1 MiB reply cap; a piece's JSON besides its data stays under PIECE_CHARS.
export const MESH_PAGE_CHARS = 960 * 1024
const PIECE_CHARS = 128
// Every page but the last is full to within one piece and every part has a triangle, so the byte cap bounds the pages.
const MAX_TRIANGLES = Math.floor(MAX_MESH_BYTES / TRIANGLE_BYTES)
export const MAX_MESH_PAGES = Math.ceil((MAX_TRIANGLES * (TRIANGLE_CHARS + PIECE_CHARS)) / (MESH_PAGE_CHARS - 2 * PIECE_CHARS - TRIANGLE_CHARS)) + 1
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const colorOf = (color) =>
  Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every((c) => typeof c === 'number' && Number.isFinite(c))
    ? color.slice(0, 3).map((c) => Math.min(1, Math.max(0, c)))
    : null

const triangleCount = (polygons) => polygons.reduce((n, { vertices }) => n + Math.max(0, vertices.length - 2), 0)

const partsOf = (geometry) =>
  [geometry]
    .flat(Infinity)
    .map(wrapOne)
    .filter((g) => typeof g?.toPolygons === 'function')
    .map((g) => ({ color: colorOf(g.color), polygons: g.toPolygons() }))
    .filter((p) => triangleCount(p.polygons) > 0)

// Each polygon fanned from its first vertex.
const positionsOf = (polygons) => {
  const positions = new Float32Array(triangleCount(polygons) * 9)
  let at = 0
  for (const { vertices } of polygons) {
    for (let i = 1; i + 1 < vertices.length; i += 1) {
      positions.set(vertices[0], at)
      positions.set(vertices[i], at + 3)
      positions.set(vertices[i + 1], at + 6)
      at += 9
    }
  }
  return positions
}

const toBase64 = (chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64')

// Consecutive parts share a page; a part that does not fit in what is left of one goes on over the next.
const pack = (parts) => {
  const pages = []
  let page = []
  let room = MESH_PAGE_CHARS
  parts.forEach(({ color, polygons }, part) => {
    const positions = positionsOf(polygons)
    for (let at = 0; at < positions.length; ) {
      const fits = Math.floor((room - PIECE_CHARS) / TRIANGLE_CHARS) * 9
      if (fits <= 0) {
        pages.push(page)
        page = []
        room = MESH_PAGE_CHARS
        continue
      }
      const chunk = positions.subarray(at, at + fits)
      page.push({ part, color, data: toBase64(chunk) })
      room -= PIECE_CHARS + (chunk.length / 9) * TRIANGLE_CHARS
      at += chunk.length
    }
  })
  return page.length ? [...pages, page] : pages
}

// Executor side. The size is counted before any array is allocated, so a huge model cannot run the executor out of memory here.
export const meshPages = (geometry) => {
  const parts = partsOf(geometry)
  const bytes = parts.reduce((n, p) => n + triangleCount(p.polygons) * TRIANGLE_BYTES, 0)
  return bytes > MAX_MESH_BYTES ? { bytes, pages: [] } : { bytes, pages: pack(parts) }
}

export const meshPage = ({ bytes, pages }, index) => ({ pages: pages.length, bytes, ...(pages[index] ? { pieces: pages[index] } : {}) })

const isColor = (color) => color === null || (Array.isArray(color) && color.length === 3 && color.every((c) => typeof c === 'number' && c >= 0 && c <= 1))

const sameColor = (a, b) => (a === null ? b === null : b !== null && a.every((c, i) => c === b[i]))

// Whole triangles of finite Float32 numbers from a piece's base64, or null.
const decodeTriangles = (data) => {
  if (typeof data !== 'string' || data.length % 4 !== 0 || !BASE64.test(data)) return null
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length % TRIANGLE_BYTES !== 0) return null
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
  return values.every((v) => Number.isFinite(v)) ? values : null
}

const concat = (chunks) => {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

// A piece that goes on the part before it must keep its colour; any other must start a later part.
const pieceFits = (piece, last) =>
  isRecord(piece) &&
  Number.isInteger(piece.part) &&
  piece.part >= (last?.part ?? 0) &&
  isColor(piece.color) &&
  (piece.part !== last?.part || sameColor(last.color, piece.color))

// Parent side: every page through `fetchPage(index)`, each piece checked, parts joined in order.
export const collectMesh = async (fetchPage) => {
  const first = await fetchPage(0)
  if (!isRecord(first) || !Number.isInteger(first.pages) || !Number.isInteger(first.bytes)) return { error: 'the mesh reply was malformed' }
  if (first.bytes > MAX_MESH_BYTES) return { error: `the mesh is ${first.bytes} bytes, over the ${MAX_MESH_BYTES}-byte limit` }
  if (first.pages > MAX_MESH_PAGES) return { error: `the mesh came in ${first.pages} pages, over the ${MAX_MESH_PAGES}-page limit` }
  if (first.pages < 1) return { error: 'the model has no triangles' }
  const parts = []
  let bytes = 0
  for (let index = 0; index < first.pages; index += 1) {
    const page = index === 0 ? first : await fetchPage(index)
    if (!isRecord(page) || page.pages !== first.pages || !Array.isArray(page.pieces) || page.pieces.length === 0) {
      return { error: `mesh page ${index} was malformed` }
    }
    for (const piece of page.pieces) {
      const last = parts.at(-1)
      if (!pieceFits(piece, last)) return { error: `mesh page ${index} was malformed` }
      const triangles = decodeTriangles(piece.data)
      if (!triangles) return { error: `mesh page ${index} is not whole triangles of finite numbers` }
      bytes += triangles.byteLength
      if (bytes > MAX_MESH_BYTES) return { error: `the mesh passed the ${MAX_MESH_BYTES}-byte limit` }
      if (piece.part === last?.part) last.chunks.push(triangles)
      else parts.push({ part: piece.part, color: piece.color, chunks: [triangles] })
    }
  }
  return { parts: parts.map(({ color, chunks }) => ({ color, positions: concat(chunks) })) }
}

export const meshSha256 = (parts) => {
  const hash = createHash('sha256')
  for (const { color, positions } of parts) {
    hash.update(JSON.stringify(color))
    hash.update(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength))
  }
  return hash.digest('hex')
}
