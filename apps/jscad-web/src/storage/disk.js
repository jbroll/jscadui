import { kindFromEntry } from './local.js'

const ID = 'disk'

// ignoreBOM keeps a leading BOM in the string so a write-back reproduces the file.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const decode = (bytes) => {
  if (bytes.includes(0)) return bytes
  try {
    return decoder.decode(bytes)
  } catch {
    return bytes
  }
}

const sameContent = (a, b) => {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const sameStat = (known, file) =>
  known !== undefined && known.size === file.size && known.mtimeMs === file.mtimeMs

export function createDiskStorage(options = {}) {
  const { base = '/api/fs', fetch = globalThis.fetch, EventSource = globalThis.EventSource } = options
  // path -> { size, mtimeMs, content }; a stat of undefined after our own PUT forces one re-read.
  const known = new Map()
  // One map per watcher of what it has reported, so a readProject in between cannot swallow a change.
  const watchers = new Set()
  let entry = 'main.js'
  let name
  let conversation = null

  const urlFor = (path) => `${base}/${path.split('/').map(encodeURIComponent).join('/')}`

  const request = async (method, url, path, body) => {
    const res = await fetch(url, body === undefined ? { method } : { method, body })
    if (!res.ok) throw new Error(`disk storage: ${method} ${path} failed (${res.status})`)
    return res
  }

  const list = async () => {
    const { files, truncated } = await (await request('GET', base, '/')).json()
    const paths = new Set(files.map((file) => file.path))
    if (!truncated) {
      for (const path of known.keys()) if (!paths.has(path)) known.delete(path)
    }
    return { files, paths, truncated }
  }

  const contentOf = async (file) => {
    const cached = known.get(file.path)
    if (sameStat(cached, file)) return cached.content
    const res = await request('GET', urlFor(file.path), file.path)
    const content = decode(new Uint8Array(await res.arrayBuffer()))
    known.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, content })
    return content
  }

  const put = async (path, content) => {
    await request('PUT', urlFor(path), path, content)
    known.set(path, { size: undefined, mtimeMs: undefined, content })
    for (const seen of watchers) seen.set(path, { size: undefined, mtimeMs: undefined, content })
  }

  const row = () => ({ id: ID, name: name ?? entry, entry, kind: kindFromEntry(entry), mode: 'disk' })

  const readProject = async () => {
    const { files } = await list()
    const contents = await Promise.all(files.map(contentOf))
    return { ...row(), files: Object.fromEntries(files.map((file, i) => [file.path, contents[i]])) }
  }

  const writeFiles = async (_id, files, options = {}) => {
    const pending = Object.entries(files).filter(([path, content]) => !sameContent(known.get(path)?.content, content))
    await Promise.all(pending.map(([path, content]) => put(path, content)))
    entry = options.entry ?? entry
    name = options.name ?? name
    return { id: ID, entry, kind: kindFromEntry(entry) }
  }

  const watch = (onChange, { onError = (err) => console.warn('disk storage: watch refresh failed', err) } = {}) => {
    const seen = new Map([...known].map(([path, stat]) => [path, { ...stat }]))
    watchers.add(seen)
    let stopped = false
    let queue = Promise.resolve()

    const refresh = async () => {
      if (stopped) return
      const { files, paths, truncated } = await list()
      const stale = files.filter((file) => !sameStat(seen.get(file.path), file))
      const contents = await Promise.all(stale.map(contentOf))
      const changed = {}
      stale.forEach((file, i) => {
        const prior = seen.get(file.path)
        if (!prior || !sameContent(prior.content, contents[i])) changed[file.path] = contents[i]
        seen.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, content: contents[i] })
      })
      const removed = truncated ? [] : [...seen.keys()].filter((path) => !paths.has(path))
      for (const path of removed) seen.delete(path)
      if (stopped) return
      if (Object.keys(changed).length > 0 || removed.length > 0) onChange({ changed, removed })
    }

    const source = new EventSource(`${base}/events`)
    source.addEventListener('message', () => {
      queue = queue.then(refresh).catch(onError)
    })
    return () => {
      stopped = true
      watchers.delete(seen)
      source.close()
    }
  }

  return {
    listProjects: async () => [row()],
    readProject,
    writeFiles,
    writeFile: (path, bytes) => put(path, bytes),
    snapshot: async () => {},
    listVersions: async () => [],
    readVersion: async () => {
      throw new Error("disk storage keeps no snapshots; read history from the directory's own git")
    },
    readConversation: async () => conversation,
    writeConversation: async (_projectId, messages) => {
      conversation = { messages, updated: Date.now() }
    },
    watch,
  }
}
