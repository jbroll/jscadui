import { describe, expect, it, vi } from 'vitest'
import { createDiskStorage } from '../src/storage/disk.js'

const encoder = new TextEncoder()
const toBytes = (body) => (typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body))

function fakeServer(seed = {}, base = '/api/fs') {
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

const storageFor = (server, options = {}) =>
  createDiskStorage({ fetch: server.fetch, EventSource: server.EventSource, ...options })

const nextChange = () => {
  const calls = []
  let resolve
  const onChange = vi.fn((change) => {
    calls.push(change)
    resolve?.(change)
  })
  const next = () => new Promise((r) => { resolve = r })
  return { onChange, next, calls }
}

describe('disk storage', () => {
  it('reads the directory as the one disk project', async () => {
    const server = fakeServer({ 'main.js': 'cube(5)', 'lib/teeth.js': 't' })
    const project = await storageFor(server).readProject('disk')
    expect(project).toEqual({
      id: 'disk',
      name: 'main.js',
      entry: 'main.js',
      kind: 'jscad',
      mode: 'disk',
      files: { 'lib/teeth.js': 't', 'main.js': 'cube(5)' },
    })
  })

  it('reads UTF-8 without NUL as a string and anything else as bytes', async () => {
    const server = fakeServer({
      'text.js': 'héllo',
      'bad.bin': new Uint8Array([0xff, 0xfe, 0x41]),
      'nul.bin': new Uint8Array([0x41, 0x00, 0x42]),
    })
    const { files } = await storageFor(server).readProject('disk')
    expect(files['text.js']).toBe('héllo')
    expect(files['bad.bin']).toBeInstanceOf(Uint8Array)
    expect([...files['bad.bin']]).toEqual([0xff, 0xfe, 0x41])
    expect(files['nul.bin']).toBeInstanceOf(Uint8Array)
    expect([...files['nul.bin']]).toEqual([0x41, 0x00, 0x42])
  })

  it('keeps a leading byte-order mark in text', async () => {
    const server = fakeServer({ 'bom.js': new Uint8Array([0xef, 0xbb, 0xbf, 0x61]) })
    const { files } = await storageFor(server).readProject('disk')
    expect(files['bom.js']).toBe('﻿a')
  })

  it('sets name and entry from writeFiles options and derives kind', async () => {
    const server = fakeServer({ 'part.scad': 'cube(5);' })
    const storage = storageFor(server)
    const written = await storage.writeFiles('disk', {}, { entry: 'part.scad', name: 'Bracket' })
    expect(written).toEqual({ id: 'disk', entry: 'part.scad', kind: 'openscad' })
    expect(await storage.readProject('disk')).toMatchObject({ name: 'Bracket', entry: 'part.scad', kind: 'openscad' })
    expect(await storage.listProjects()).toEqual([
      { id: 'disk', name: 'Bracket', entry: 'part.scad', kind: 'openscad', mode: 'disk' },
    ])
  })

  it('PUTs only paths whose content differs from what it last read or wrote', async () => {
    const server = fakeServer({ 'main.js': 'm', 'lib.js': 'l', 'logo.bin': new Uint8Array([0xff, 0x00]) })
    const storage = storageFor(server)
    const { files } = await storage.readProject('disk')
    await storage.writeFiles('disk', { ...files, 'lib.js': 'l2', 'new.js': 'n', 'logo.bin': new Uint8Array([0xff, 0x00]) })
    expect(server.puts().sort()).toEqual(['/api/fs/lib.js', '/api/fs/new.js'])
    expect(server.text('lib.js')).toBe('l2')
    expect(server.text('new.js')).toBe('n')

    server.clear()
    await storage.writeFiles('disk', { 'lib.js': 'l2', 'new.js': 'n' })
    expect(server.puts()).toEqual([])
  })

  it('never deletes files missing from a write', async () => {
    const server = fakeServer({ 'main.js': 'm', 'keep.js': 'k' })
    const storage = storageFor(server)
    await storage.writeFiles('disk', { 'main.js': 'm2' })
    expect(server.requests.some((r) => r.method !== 'PUT' && r.method !== 'GET')).toBe(false)
    expect(server.text('keep.js')).toBe('k')
  })

  it('PUTs again after the file disappears from the listing', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    server.remove('main.js')
    await storage.readProject('disk')
    await storage.writeFiles('disk', { 'main.js': 'm' })
    expect(server.puts()).toEqual(['/api/fs/main.js'])
  })

  it('encodes each path segment and keeps the separators', async () => {
    const server = fakeServer()
    await storageFor(server).writeFiles('disk', { 'my parts/a#b?.js': 'x' })
    expect(server.puts()).toEqual(['/api/fs/my%20parts/a%23b%3F.js'])
    expect(server.text('my parts/a#b?.js')).toBe('x')
  })

  it('writes one file with writeFile', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    await storageFor(server).writeFile('main.stl', new Uint8Array([1, 2, 3]))
    expect(server.puts()).toEqual(['/api/fs/main.stl'])
    expect([...server.files.get('main.stl').bytes]).toEqual([1, 2, 3])
  })

  it('throws with the status and path when a request fails', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    server.fail('/api/fs/main.js', 500)
    const storage = storageFor(server)
    await expect(storage.readProject('disk')).rejects.toThrow(/500.*main\.js|main\.js.*500/)
    await expect(storage.writeFiles('disk', { 'main.js': 'x' })).rejects.toThrow(/500.*main\.js|main\.js.*500/)
  })

  it('uses the base option for every URL', async () => {
    const server = fakeServer({ 'main.js': 'm' }, '/other')
    const storage = storageFor(server, { base: '/other' })
    await storage.readProject('disk')
    await storage.writeFiles('disk', { 'main.js': 'm2' })
    expect(server.requests.map((r) => r.url)).toEqual(['/other', '/other/main.js', '/other/main.js'])
    storage.watch(() => {})
    expect(server.sources[0].url).toBe('/other/events')
  })

  it('keeps no snapshots: git holds the history', async () => {
    const storage = storageFor(fakeServer())
    await expect(storage.snapshot('disk', { message: 'x' })).resolves.toBeUndefined()
    expect(await storage.listVersions('disk')).toEqual([])
    await expect(storage.readVersion('disk', 'v')).rejects.toThrow(/git/)
  })

  it('keeps the conversation in memory', async () => {
    const storage = storageFor(fakeServer())
    expect(await storage.readConversation('disk')).toBeNull()
    const messages = [{ role: 'user', content: 'make a gear' }]
    await storage.writeConversation('disk', messages)
    expect((await storage.readConversation('disk')).messages).toEqual(messages)
  })
})

describe('disk storage watch', () => {
  it('opens the events stream and reports new, changed and removed files', async () => {
    const server = fakeServer({ 'main.js': 'm', 'lib.js': 'l', 'old.js': 'o' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    const { onChange, next } = nextChange()
    storage.watch(onChange)
    expect(server.sources.map((s) => s.url)).toEqual(['/api/fs/events'])

    server.put('lib.js', 'l2')
    server.put('new.js', 'n')
    server.remove('old.js')
    server.clear()
    const change = next()
    server.sources[0].emit(['lib.js', 'new.js', 'old.js'])
    expect(await change).toEqual({ changed: { 'lib.js': 'l2', 'new.js': 'n' }, removed: ['old.js'] })
    expect(server.gets().sort()).toEqual(['/api/fs', '/api/fs/lib.js', '/api/fs/new.js'])
  })

  it('does not report a touched file whose content is unchanged', async () => {
    const server = fakeServer({ 'main.js': 'm', 'lib.js': 'l' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    const { onChange, next, calls } = nextChange()
    storage.watch(onChange)

    server.put('main.js', 'm')
    server.sources[0].emit(['main.js'])
    server.put('lib.js', 'l2')
    const change = next()
    server.sources[0].emit(['lib.js'])
    await change
    expect(calls).toEqual([{ changed: { 'lib.js': 'l2' }, removed: [] }])
  })

  it('does not report its own writes', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    const { onChange, next, calls } = nextChange()
    storage.watch(onChange)

    await storage.writeFiles('disk', { 'main.js': 'mine', 'added.js': 'a' })
    server.sources[0].emit(['main.js', 'added.js'])
    server.put('other.js', 'theirs')
    const change = next()
    server.sources[0].emit(['other.js'])
    await change
    expect(calls).toEqual([{ changed: { 'other.js': 'theirs' }, removed: [] }])
  })

  it('reports an external change even after another read picked it up', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    const { onChange, next } = nextChange()
    storage.watch(onChange)

    server.put('main.js', 'edited')
    await storage.readProject('disk')
    const change = next()
    server.sources[0].emit(['main.js'])
    expect(await change).toEqual({ changed: { 'main.js': 'edited' }, removed: [] })
  })

  it('stops: closes the stream and reports nothing more', async () => {
    const server = fakeServer({ 'main.js': 'm' })
    const storage = storageFor(server)
    await storage.readProject('disk')
    const onChange = vi.fn()
    const stop = storage.watch(onChange)
    stop()
    expect(server.sources[0].closed).toBe(true)
    server.put('main.js', 'late')
    server.sources[0].emit(['main.js'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onChange).not.toHaveBeenCalled()
  })
})
