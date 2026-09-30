// apps/jscad-web/scripts/local/fsApi.test.js
import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsHandler } from './fsApi.js'

const open = []

afterEach(() => {
  for (const s of open.splice(0)) {
    s.closeAllConnections()
    s.close()
  }
})

const tempDir = () => mkdtempSync(join(tmpdir(), 'jscad-fsapi-'))

const serve = async (modelDir) => {
  const server = http.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  open.push(server)
  const port = server.address().port
  const appOrigin = `http://localhost:${port}`
  const handler = createFsHandler({ modelDir, appOrigin })
  server.on('request', (req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  return { base: `http://127.0.0.1:${port}`, appOrigin, frameOrigin: `http://localhost:${port + 1}` }
}

const setup = async (files = {}) => {
  const dir = tempDir()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  const srv = await serve(dir)
  const get = (path, headers = {}) => fetch(`${srv.base}${path}`, { headers: { origin: srv.appOrigin, ...headers } })
  const put = (path, body, headers = {}) => fetch(`${srv.base}${path}`, { method: 'PUT', body, headers: { origin: srv.appOrigin, ...headers }, duplex: 'half' })
  return { dir, ...srv, get, put }
}

describe('fs api origin rules', () => {
  it('serves the app origin and sends no CORS header', async () => {
    const { get } = await setup({ 'main.js': 'x' })
    const res = await get('/api/fs')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('serves a same-origin request that carries no Origin', async () => {
    const { base } = await setup({ 'main.js': 'x' })
    const res = await fetch(`${base}/api/fs/main.js`, { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(res.status).toBe(200)
  })

  it('refuses a foreign origin, the frame origin, and a request with neither Origin nor same-origin', async () => {
    const { base, frameOrigin } = await setup({ 'main.js': 'x' })
    for (const headers of [
      { origin: 'https://evil.test' },
      { origin: frameOrigin },
      {},
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' },
    ]) {
      for (const path of ['/api/fs', '/api/fs/main.js', '/api/fs/events']) {
        const res = await fetch(`${base}${path}`, { headers })
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(403)
        expect(res.headers.get('access-control-allow-origin')).toBeNull()
      }
      const res = await fetch(`${base}/api/fs/evil.js`, { method: 'PUT', body: 'x', headers })
      expect(res.status).toBe(403)
    }
  })

  it('refuses a rebound host even when the request looks same-origin', async () => {
    const { base } = await setup({ 'main.js': 'x' })
    const { port } = new URL(base)
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/fs/main.js', headers: { host: `evil.test:${port}`, 'sec-fetch-site': 'same-origin' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      }).on('error', reject)
    })
    expect(status).toBe(403)
  })

  it('answers 405 for other methods', async () => {
    const { base, appOrigin } = await setup({ 'main.js': 'x' })
    for (const method of ['DELETE', 'POST', 'PATCH']) {
      expect((await fetch(`${base}/api/fs/main.js`, { method, headers: { origin: appOrigin } })).status).toBe(405)
    }
  })

  it('leaves other routes to the caller', async () => {
    const { get } = await setup()
    expect((await get('/api/fsx')).status).toBe(404)
    expect((await get('/models/main.js')).status).toBe(404)
  })
})

describe('fs api paths', () => {
  it('refuses traversal, absolute, dot, node_modules, empty and malformed paths', async () => {
    const { get, put, dir } = await setup({ 'main.js': 'x', '.env': 's', 'node_modules/p/index.js': 'm', 'a/.hidden/x.js': 'h' })
    for (const path of [
      '..%2Fsecret',
      'a%2F..%2F..%2Fsecret',
      '%2Fetc%2Fpasswd',
      '.env',
      '.git%2Fconfig',
      'a/.hidden/x.js',
      'node_modules/p/index.js',
      'a/node_modules/x.js',
      'a//b.js',
      '%E0%A4%A',
    ]) {
      expect((await get(`/api/fs/${path}`)).status, path).toBe(403)
      expect((await put(`/api/fs/${path}`, 'x')).status, path).toBe(403)
    }
    expect(existsSync(join(dir, '..', 'secret'))).toBe(false)
  })

  it('refuses a path that escapes through a symlink, for reads and writes', async () => {
    const outside = tempDir()
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    const { dir, get, put } = await setup({ 'main.js': 'x' })
    symlinkSync(outside, join(dir, 'link'))
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'secret.txt'))
    symlinkSync(join(outside, 'dangling.txt'), join(dir, 'dangling.txt'))
    expect((await get('/api/fs/link/secret.txt')).status).toBe(403)
    expect((await get('/api/fs/secret.txt')).status).toBe(403)
    expect((await put('/api/fs/link/new.txt', 'x')).status).toBe(403)
    expect((await put('/api/fs/link/deep/new.txt', 'x')).status).toBe(403)
    expect((await put('/api/fs/dangling.txt', 'x')).status).toBe(403)
    expect(existsSync(join(outside, 'new.txt'))).toBe(false)
    expect(existsSync(join(outside, 'deep'))).toBe(false)
    expect(existsSync(join(outside, 'dangling.txt'))).toBe(false)
  })

  it('follows a symlink that stays inside the model dir', async () => {
    const { dir, get } = await setup({ 'lib/part.js': 'part' })
    symlinkSync(join(dir, 'lib'), join(dir, 'alias'))
    const res = await get('/api/fs/alias/part.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('part')
  })
})

describe('fs api read and write', () => {
  it('returns raw bytes with a content type by extension', async () => {
    const bytes = Buffer.from([0, 1, 2, 255])
    const { get } = await setup({ 'main.js': 'const a = 1', 'mesh.bin': bytes, 'data.json': '{}' })
    const js = await get('/api/fs/main.js')
    expect(js.headers.get('content-type')).toBe('application/javascript')
    expect(await js.text()).toBe('const a = 1')
    expect((await get('/api/fs/data.json')).headers.get('content-type')).toBe('application/json')
    const bin = await get('/api/fs/mesh.bin')
    expect(bin.headers.get('content-type')).toBe('application/octet-stream')
    expect(Buffer.from(await bin.arrayBuffer())).toEqual(bytes)
  })

  it('404s a missing file or a directory', async () => {
    const { get } = await setup({ 'lib/part.js': 'x' })
    expect((await get('/api/fs/missing.js')).status).toBe(404)
    expect((await get('/api/fs/lib')).status).toBe(404)
  })

  it('decodes percent-encoded paths', async () => {
    const { get, put, dir } = await setup({ 'my part.js': 'spaced' })
    expect(await (await get('/api/fs/my%20part.js')).text()).toBe('spaced')
    expect((await put('/api/fs/sub%20dir/new%20file.js', 'n')).status).toBe(204)
    expect(readFileSync(join(dir, 'sub dir', 'new file.js'), 'utf-8')).toBe('n')
  })

  it('PUT writes the raw body and creates parent dirs', async () => {
    const { dir, put, get } = await setup()
    const bytes = Buffer.from([9, 0, 8, 255, 7])
    const res = await put('/api/fs/a/b/c/part.stl', bytes)
    expect(res.status).toBe(204)
    expect(readFileSync(join(dir, 'a', 'b', 'c', 'part.stl'))).toEqual(bytes)
    expect((await put('/api/fs/a/b/c/part.stl', 'replaced')).status).toBe(204)
    expect(await (await get('/api/fs/a/b/c/part.stl')).text()).toBe('replaced')
  })

  it('PUT answers 413 past 50 MB, with or without a content-length', async () => {
    const { dir, put } = await setup()
    const big = Buffer.alloc(50 * 1024 * 1024 + 1)
    expect((await put('/api/fs/big.bin', big)).status).toBe(413)
    const stream = new ReadableStream({
      start (c) {
        for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(10 * 1024 * 1024))
        c.close()
      },
    })
    expect((await put('/api/fs/big2.bin', stream)).status).toBe(413)
    expect(existsSync(join(dir, 'big.bin'))).toBe(false)
    expect(existsSync(join(dir, 'big2.bin'))).toBe(false)
    expect((await put('/api/fs/ok.bin', Buffer.alloc(50 * 1024 * 1024))).status).toBe(204)
  }, 30_000)
})

describe('fs api listing', () => {
  it('lists files sorted with size and mtime, skipping dot entries and node_modules', async () => {
    const { get } = await setup({
      'main.js': 'abc',
      'lib/b.js': 'bb',
      'lib/a.js': 'a',
      '.env': 'secret',
      '.cache/x.js': 'x',
      'node_modules/p/index.js': 'm',
      'lib/node_modules/q.js': 'q',
    })
    const res = await get('/api/fs')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body = await res.json()
    expect(body.truncated).toBe(false)
    expect(body.files.map((f) => f.path)).toEqual(['lib/a.js', 'lib/b.js', 'main.js'])
    expect(body.files[2].size).toBe(3)
    expect(typeof body.files[2].mtimeMs).toBe('number')
    expect((await get('/api/fs/')).status).toBe(200)
  })

  it('omits git-ignored files and deleted tracked files inside a git work tree', async () => {
    const { dir, get } = await setup({
      '.gitignore': 'ignored.js\nout/\n',
      'main.js': 'm',
      'ignored.js': 'i',
      'out/model.stl': 's',
      'lib/part.js': 'p',
      'gone.js': 'g',
    })
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['-C', dir, 'add', 'gone.js'])
    unlinkSync(join(dir, 'gone.js'))
    const { files } = await (await get('/api/fs')).json()
    expect(files.map((f) => f.path)).toEqual(['lib/part.js', 'main.js'])
  })

  it('lists git paths relative to a model dir nested in the work tree', async () => {
    const root = tempDir()
    execFileSync('git', ['init', '-q', root])
    mkdirSync(join(root, 'models', 'lib'), { recursive: true })
    writeFileSync(join(root, 'top.js'), 't')
    writeFileSync(join(root, 'models', 'main.js'), 'm')
    writeFileSync(join(root, 'models', 'lib', 'part.js'), 'p')
    const { base, appOrigin } = await serve(join(root, 'models'))
    const { files } = await (await fetch(`${base}/api/fs`, { headers: { origin: appOrigin } })).json()
    expect(files.map((f) => f.path)).toEqual(['lib/part.js', 'main.js'])
  })

  it('caps the list at 2000 files and flags truncation', async () => {
    const files = {}
    for (let i = 0; i < 2001; i++) files[`f${String(i).padStart(4, '0')}.js`] = ''
    const { get } = await setup(files)
    const body = await (await get('/api/fs')).json()
    expect(body.files).toHaveLength(2000)
    expect(body.truncated).toBe(true)
  })
})

const readEvent = async (res, timeoutMs) => {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const timer = setTimeout(() => reader.cancel(), timeoutMs)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      text += decoder.decode(value, { stream: true })
      const m = text.match(/^data: (.*)$/m)
      if (m) return JSON.parse(m[1])
    }
  } finally {
    clearTimeout(timer)
    reader.cancel().catch(() => {})
  }
}

describe('fs api events', () => {
  it('streams one event naming the changed paths after a write', async () => {
    const { dir, get } = await setup({ 'main.js': 'x' })
    const res = await get('/api/fs/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const event = readEvent(res, 5000)
    writeFileSync(join(dir, 'main.js'), 'y')
    writeFileSync(join(dir, '.hidden.js'), 'h')
    expect(await event).toEqual({ paths: ['main.js'] })
  })

  it('reports changes in subdirectories with / separated paths', async () => {
    const { dir, get } = await setup({ 'lib/part.js': 'x' })
    const res = await get('/api/fs/events')
    const event = readEvent(res, 5000)
    writeFileSync(join(dir, 'lib', 'part.js'), 'y')
    expect(await event).toEqual({ paths: ['lib/part.js'] })
  })
})
