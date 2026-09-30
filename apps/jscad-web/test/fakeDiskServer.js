import { vi } from 'vitest'

const encoder = new TextEncoder()
const toBytes = (body) => (typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body))

// The launcher's /api/fs in memory: a stubbed fetch and EventSource for src/storage/disk.js.
export function fakeServer(seed = {}, base = '/api/fs') {
  const files = new Map()
  let clock = 1000
  const put = (path, body) => files.set(path, { bytes: toBytes(body), mtimeMs: clock++ })
  for (const [path, body] of Object.entries(seed)) put(path, body)
  const requests = []
  const fail = new Map()

  const fetch = vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET'
    requests.push({ method, url })
    if (fail.has(url)) return new Response('nope', { status: fail.get(url) })
    if (method === 'GET' && url === base) {
      const listed = [...files.keys()].sort().map((path) => {
        const { bytes, mtimeMs } = files.get(path)
        return { path, size: bytes.length, mtimeMs }
      })
      return Response.json({ files: listed, truncated: false })
    }
    const path = url.slice(base.length + 1).split('/').map(decodeURIComponent).join('/')
    if (method === 'GET') {
      const file = files.get(path)
      return file ? new Response(file.bytes) : new Response('missing', { status: 404 })
    }
    if (method === 'PUT') {
      put(path, init.body)
      return new Response(null, { status: 204 })
    }
    return new Response('bad method', { status: 405 })
  })

  const sources = []
  class EventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.listeners = []
      sources.push(this)
    }
    addEventListener(type, fn) {
      if (type === 'message') this.listeners.push(fn)
    }
    close() {
      this.closed = true
    }
    emit(paths) {
      for (const fn of this.listeners) fn({ data: JSON.stringify({ paths }) })
    }
  }

  return {
    fetch,
    EventSource,
    files,
    requests,
    sources,
    fail: (url, status) => fail.set(url, status),
    put,
    remove: (path) => files.delete(path),
    text: (path) => new TextDecoder().decode(files.get(path).bytes),
    puts: () => requests.filter((r) => r.method === 'PUT').map((r) => r.url),
    gets: () => requests.filter((r) => r.method === 'GET').map((r) => r.url),
    clear: () => requests.splice(0),
  }
}
