// Read/write/watch API over the model directory for the local launcher, so the
// app can treat the directory on disk as the open project.
import { execFile } from 'node:child_process'
import { watch as fsWatch } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { mimeOf } from '../static.js'

const MAX_BYTES = 50 * 1024 * 1024
const MAX_FILES = 2000
const DEBOUNCE_MS = 100

const hiddenSegment = (s) => s.startsWith('.') || s === 'node_modules'

const listable = (rel) => !rel.split('/').some(hiddenSegment)

const segmentsOf = (raw) => {
  let rel
  try { rel = decodeURIComponent(raw) } catch { return null }
  if (!rel || isAbsolute(rel) || rel.includes('..') || rel.includes('\0')) return null
  const segs = rel.split(/[/\\]/)
  if (segs.some((s) => s === '' || hiddenSegment(s))) return null
  return segs
}

const inside = (root, p) => p === root || p.startsWith(root + sep)

// A dangling symlink has no realpath but would still be followed by a write.
const resolvesInside = async (root, abs) => {
  for (let cur = abs; ; cur = dirname(cur)) {
    try {
      return inside(root, await realpath(cur))
    } catch (e) {
      if (e.code !== 'ENOENT') return false
      if (await lstat(cur).then(() => true, () => false)) return false
      if (dirname(cur) === cur) return false
    }
  }
}

const gitFiles = (dir) => new Promise((resolve) => {
  execFile('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
    resolve(err ? null : stdout.split('\0').filter(Boolean))
  })
})

const walkFiles = async (dir, limit) => {
  const out = []
  const walk = async (rel) => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      if (out.length > limit) return
      if (hiddenSegment(e.name)) continue
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(path)
      else if (e.isFile() || e.isSymbolicLink()) out.push(path)
    }
  }
  await walk('')
  return out
}

const listFiles = async (dir, root, limit) => {
  const candidates = ((await gitFiles(dir)) ?? (await walkFiles(dir, limit))).filter(listable).sort()
  const files = []
  for (const path of candidates) {
    const abs = join(dir, path)
    const st = await stat(abs).catch(() => null)
    if (!st?.isFile() || !(await resolvesInside(root, abs))) continue
    if (files.length === limit) return { files, truncated: true }
    files.push({ path, size: st.size, mtimeMs: st.mtimeMs })
  }
  return { files, truncated: false }
}

const readBody = async (req, max) => {
  if (Number(req.headers['content-length']) > max) { req.resume(); return null }
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size <= max) chunks.push(c)
  }
  return size > max ? null : Buffer.concat(chunks)
}

// A DNS-rebound page is same-origin to itself, so its requests name a foreign Host.
const appHosts = (appOrigin) => {
  const { port } = new URL(appOrigin)
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`])
}

const fromApp = (req, appOrigin, hosts) => {
  if (!hosts.has(req.headers.host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return req.headers['sec-fetch-site'] === 'same-origin'
  return origin === appOrigin
}

const send = (res, status, body = '', headers = {}) => {
  res.writeHead(status, headers)
  res.end(body)
}

const streamEvents = (req, res, dir, watch) => {
  let watcher
  try {
    watcher = watch(dir, { recursive: true })
  } catch {
    send(res, 500, 'watch failed')
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.flushHeaders()
  const pending = new Set()
  let timer = null
  const flush = () => {
    timer = null
    res.write(`data: ${JSON.stringify({ paths: [...pending].sort() })}\n\n`)
    pending.clear()
  }
  watcher.on('change', (_type, name) => {
    const path = name ? String(name).split(sep).join('/') : null
    if (path !== null && !listable(path)) return
    if (path !== null) pending.add(path)
    timer ??= setTimeout(flush, DEBOUNCE_MS)
  })
  const stop = () => {
    clearTimeout(timer)
    watcher.close()
    res.end()
  }
  watcher.on('error', stop)
  req.on('close', stop)
}

export const createFsHandler = ({ modelDir, appOrigin, watch = fsWatch }) => {
  const hosts = appHosts(appOrigin)
  let rootPromise = null
  const realRoot = () => (rootPromise ??= realpath(modelDir))

  const serveFile = async (req, res, raw) => {
    const segs = segmentsOf(raw)
    if (!segs) return send(res, 403, 'forbidden')
    const root = await realRoot()
    const abs = join(root, ...segs)
    if (!(await resolvesInside(root, abs))) return send(res, 403, 'forbidden')
    if (req.method === 'GET') {
      try {
        const content = await readFile(abs)
        return send(res, 200, content, { 'content-type': mimeOf(abs) })
      } catch (e) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(e.code)) return send(res, 404, 'not found')
        throw e
      }
    }
    const body = await readBody(req, MAX_BYTES)
    if (body === null) return send(res, 413, 'too large')
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, body)
    send(res, 204)
  }

  return async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/api/fs' && !path.startsWith('/api/fs/')) return false
    if (!fromApp(req, appOrigin, hosts)) { send(res, 403, 'untrusted origin'); return true }
    const rest = path.slice('/api/fs/'.length)
    const isFile = rest !== '' && rest !== 'events'
    if (req.method !== 'GET' && !(req.method === 'PUT' && isFile)) { send(res, 405, 'method not allowed', { allow: isFile ? 'GET, PUT' : 'GET' }); return true }
    try {
      if (rest === '') {
        const listing = await listFiles(modelDir, await realRoot(), MAX_FILES)
        send(res, 200, JSON.stringify(listing), { 'content-type': 'application/json' })
      } else if (rest === 'events') {
        streamEvents(req, res, modelDir, watch)
      } else {
        await serveFile(req, res, rest)
      }
    } catch (e) {
      if (!res.headersSent) send(res, 500, String(e?.message ?? e))
      else res.end()
    }
    return true
  }
}
