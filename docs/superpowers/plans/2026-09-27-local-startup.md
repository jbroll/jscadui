# Local single-script startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command run from a model folder boots app + frame + relay on ports 7377/7378.

**Architecture:** New `apps/jscad-web/scripts/local/` module: pure entry resolver, plain-`node:http` relay handler (no express/TS dependency), single-process static server reusing `serveFrame` from `serve.js` for the frame. Thin CLI `apps/jscad-web/scripts/jscad.mjs` plus a root `jscad` npm script.

**Tech Stack:** Node 21+, plain `node:http`/`node:fs`, existing `serve.js` `serveFrame`, vitest in `apps/jscad-web`.

## Global Constraints

- Targets modern browsers only, ES2022+ without polyfills.
- Default port `7377` (frame `7378`), never `5120`; override via `--port` / `JSCAD_PORT`.
- Model dir mounted read-only at `/models/`, never symlinked into `examples/`.
- Relay same-origin at `/api/relay/:kind`, no `localStorage jscad-ai.relay` override needed locally.
- No auth, no db, no rowboat in this path.
- TDD: failing test first, minimal implementation, commit per task.

---

### Task 1: Entry resolution

**Files:**
- Create: `apps/jscad-web/scripts/local/resolveEntry.js`
- Test: `apps/jscad-web/scripts/local/resolveEntry.test.js`

**Interfaces:**
- Consumes: nothing (pure, takes an injected `readdir`/`readFile` seam for tests).
- Produces: `resolveEntry(modelDir, { explicitFile?, readDir?, readJson? }) -> { entryFile, urlPath }` where `urlPath` is `/models/<entryFile>`. Used by Task 4.

- [ ] **Step 1: Write the failing test**

```js
// apps/jscad-web/scripts/local/resolveEntry.test.js
import { describe, expect, it } from 'vitest'
import { resolveEntry } from './resolveEntry.js'

const files = (names, json = null) => ({
  readDir: async () => names,
  readJson: async (p) => (p.endsWith('package.json') ? json : null),
})

describe('resolveEntry', () => {
  it('explicit file wins', async () => {
    const r = await resolveEntry('/m', { explicitFile: 'foo.js', ...files(['foo.js']) })
    expect(r).toEqual({ entryFile: 'foo.js', urlPath: '/models/foo.js' })
  })
  it('package.json main, then index.js, then <dirname>.js, then first *.js', async () => {
    expect((await resolveEntry('/m', files(['a.js', 'package.json'], { main: 'main.js' }))).entryFile).toBe('main.js')
    expect((await resolveEntry('/m', files(['index.js', 'b.js']))).entryFile).toBe('index.js')
    expect((await resolveEntry('/moo', files(['moo.js', 'z.js']))).entryFile).toBe('moo.js')
    expect((await resolveEntry('/m', files(['z.js', 'a.js']))).entryFile).toBe('a.js')
  })
  it('throws when no entry exists', async () => {
    await expect(resolveEntry('/m', files(['README.md']))).rejects.toThrow(/no entry/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/local/resolveEntry.test.js` (workdir `apps/jscad-web`)
Expected: FAIL with "Failed to resolve import" / "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```js
// apps/jscad-web/scripts/local/resolveEntry.js
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const resolveEntry = async (modelDir, opts = {}) => {
  const readDir = opts.readDir ?? (() => readdir(modelDir))
  const readJson = opts.readJson ?? (async (p) => JSON.parse(await readFile(join(modelDir, p), 'utf-8')))
  if (opts.explicitFile) return { entryFile: opts.explicitFile, urlPath: `/models/${opts.explicitFile}` }
  const names = await readDir()
  if (names.includes('package.json')) {
    try {
      const pkg = await readJson('package.json')
      if (pkg?.main && names.includes(pkg.main)) return { entryFile: pkg.main, urlPath: `/models/${pkg.main}` }
    } catch { /* fall through */ }
  }
  if (names.includes('index.js')) return { entryFile: 'index.js', urlPath: '/models/index.js' }
  const dirName = `${basename(modelDir)}.js`
  if (names.includes(dirName)) return { entryFile: dirName, urlPath: `/models/${dirName}` }
  const first = names.filter((n) => n.endsWith('.js')).sort()[0]
  if (first) return { entryFile: first, urlPath: `/models/${first}` }
  throw new Error(`jscad: no entry in ${modelDir} (need package.json main, index.js, <dirname>.js or any *.js)`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/local/resolveEntry.test.js` (workdir `apps/jscad-web`)
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/scripts/local/resolveEntry.js apps/jscad-web/scripts/local/resolveEntry.test.js
git commit -m "feat(jscad-web): model entry resolution for local startup script"
```

### Task 2: Local relay handler (plain node:http, no express)

**Files:**
- Create: `apps/jscad-web/scripts/local/relay.js`
- Test: `apps/jscad-web/scripts/local/relay.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createRelayHandler({ allowlist, trustedOrigins }) -> async (req, res) => boolean` returning `true` when it handled the request. Used by Task 3.

- [ ] **Step 1: Write the failing test**

```js
// apps/jscad-web/scripts/local/relay.test.js
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { createRelayHandler } from './relay.js'

const withServers = async (t) => {
  const upstream = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`echo:${req.url}:${b}`)
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const port = upstream.address().port
  const handler = createRelayHandler({
    allowlist: { test: `http://127.0.0.1:${port}` },
    trustedOrigins: ['http://app.test'],
    allowPrivateUpstream: true,
  })
  const front = http.createServer((req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  try {
    await t(`http://127.0.0.1:${front.address().port}`)
  } finally {
    front.close(); upstream.close()
  }
}

describe('relay', () => {
  it('forwards a trusted origin to the upstream sub-path', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/test/v1/chat`, {
        method: 'POST',
        headers: { origin: 'http://app.test', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'm' }),
      })
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('/v1/chat')
    })
  })
  it('403s an untrusted origin', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/test/v1/chat`, {
        method: 'POST',
        headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(403)
    })
  })
  it('404s an unknown kind', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/nope/v1/x`, {
        method: 'POST',
        headers: { origin: 'http://app.test', 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(404)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/local/relay.test.js` (workdir `apps/jscad-web`)
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```js
// apps/jscad-web/scripts/local/relay.js
import { readFileSync } from 'node:fs'

const FORWARD = new Set(['content-type', 'accept', 'authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'x-opencode-session'])

export const loadAllowlist = (path) => {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('relay: allowlist must be a {name: url} object')
  return parsed
}

export const defaultAllowlist = () => ({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
})

export const createRelayHandler = ({ allowlist, trustedOrigins, allowPrivateUpstream = false }) => {
  const allowed = new Set(trustedOrigins)
  const hits = new Map()
  return async (req, res) => {
    const m = (req.url ?? '').match(/^\/api\/relay\/([^/]+)(\/.*)?$/)
    if (!m || req.method !== 'POST') return false
    const origin = req.headers.origin
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'untrusted origin' }))
      return true
    }
    const now = Date.now()
    const seen = (hits.get(req.socket.remoteAddress ?? '') ?? []).filter((t) => now - t < 60_000)
    if (seen.length >= 60) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
      res.end(JSON.stringify({ error: 'rate limited' }))
      return true
    }
    seen.push(now)
    hits.set(req.socket.remoteAddress ?? '', seen)
    const base = allowlist[m[1]]
    if (!base) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unknown provider' }))
      return true
    }
    const sub = (m[2] ?? '').replace(/^\/+/, '')
    if (sub.split('/').includes('..')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'path traversal refused' }))
      return true
    }
    const upstream = `${base.replace(/\/+$/, '')}/${sub}`
    if (!allowPrivateUpstream && /127\.|localhost|10\.|192\.168\./.test(new URL(upstream).hostname)) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'private upstream refused' }))
      return true
    }
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (FORWARD.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    let up
    try {
      up = await fetch(upstream, { method: 'POST', headers, body: Buffer.concat(chunks) })
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream unreachable' }))
      return true
    }
    res.writeHead(up.status, {
      ...(up.headers.get('content-type') ? { 'content-type': up.headers.get('content-type') } : {}),
      'cache-control': 'no-cache',
      'access-control-allow-origin': origin,
      vary: 'Origin',
    })
    if (up.body) for await (const c of up.body) res.write(c)
    res.end()
    return true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/local/relay.test.js` (workdir `apps/jscad-web`)
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/scripts/local/relay.js apps/jscad-web/scripts/local/relay.test.js
git commit -m "feat(jscad-web): plain-http local relay handler for startup script"
```

### Task 3: Single-process local server

**Files:**
- Create: `apps/jscad-web/scripts/local/server.js`
- Test: `apps/jscad-web/scripts/local/server.test.js`

**Interfaces:**
- Consumes: `createRelayHandler` from Task 2, `serveFrame` from `../../serve.js`.
- Produces: `startLocal({ appDir, frameDir, modelDir, relayHandler, port }) -> { appServer, frameServer, url }`. Used by Task 4.

- [ ] **Step 1: Write the failing test**

```js
// apps/jscad-web/scripts/local/server.test.js
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelayHandler } from './relay.js'
import { startLocal } from './server.js'

describe('local server', () => {
  it('serves app, frame dir, /models and relay-origin rules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<h1>app</h1>')
    writeFileSync(join(root, 'models', 'cube.js'), 'module.exports = {}')
    const relayHandler = createRelayHandler({ allowlist: {}, trustedOrigins: ['http://x'] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    try {
      expect((await fetch(`${url}/index.html`)).status).toBe(200)
      expect((await fetch(`${url}/models/cube.js`)).status).toBe(200)
      expect(await (await fetch(`${url}/models/cube.js`)).text()).toContain('module.exports')
      expect((await fetch(`${url}/../index.html`)).status).toBe(403)
      const bad = await fetch(`${url}/api/relay/nope/v1/x`, {
        method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}',
      })
      expect(bad.status).toBe(403)
    } finally {
      appServer.close(); frameServer.close()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/local/server.test.js` (workdir `apps/jscad-web`)
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```js
// apps/jscad-web/scripts/local/server.js
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { serveFrame } from '../../serve.js'

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }

const safeJoin = (root, rel) => {
  const p = resolve(join(root, rel))
  if (p !== root && !p.startsWith(root + sep)) return null
  return p
}

export const startLocal = async ({ appDir, frameDir, modelDir, relayHandler, port }) => {
  const appOrigin = `http://localhost:${port === 0 ? 'PORT' : port}`
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path.startsWith('/api/relay/')) {
      if (await relayHandler(req, res)) return
      res.writeHead(404); res.end(); return
    }
    let file = null
    if (path.startsWith('/models/')) file = safeJoin(modelDir, decodeURIComponent(path.slice('/models/'.length)))
    else file = safeJoin(appDir, decodeURIComponent(path === '/' ? '/index.html' : path))
    if (!file) { res.writeHead(403); res.end('forbidden'); return }
    try {
      const content = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' })
      res.end(content)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const actual = server.address().port
  const origin = `http://localhost:${actual}`
  const frameServer = serveFrame(actual + 1, origin, frameDir)
  return { appServer: server, frameServer, url: origin }
}
```

Note: `serveFrame` logs its own line; the `appOrigin` placeholder above is unused — delete it before committing (kept here for signature clarity; frame origin is derived from the bound port).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/local/server.test.js` (workdir `apps/jscad-web`)
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/scripts/local/server.js apps/jscad-web/scripts/local/server.test.js
git commit -m "feat(jscad-web): single-process local server with /models mount"
```

### Task 4: CLI wiring, npm script, docs

**Files:**
- Create: `apps/jscad-web/scripts/jscad.mjs`
- Modify: `apps/jscad-web/package.json` (add `"jscad": "node scripts/jscad.mjs"`), root `package.json` (add `"jscad": "npm run jscad -w apps/jscad-web --"`).
- Modify: `apps/jscad-web/README.md` (short Local-model section).

**Interfaces:**
- Consumes: `resolveEntry` (Task 1), `createRelayHandler/defaultAllowlist/loadAllowlist` (Task 2), `startLocal` (Task 3).
- Produces: the `jscad` command. Nothing downstream.

- [ ] **Step 1: Write the CLI (no test — covered by Tasks 1-3; verify by boot)**

```js
#!/usr/bin/env node
// Usage: jscad [dir|file] [--port N] [--build|--no-build]
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEntry } from './local/resolveEntry.js'
import { createRelayHandler, defaultAllowlist, loadAllowlist } from './local/relay.js'
import { startLocal } from './local/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(here, '..')
const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = portArg === -1 ? Number(process.env.JSCAD_PORT) || 7377 : Number(args[portArg + 1])
const target = resolve(args.find((a) => !a.startsWith('--') && a !== args[portArg + 1]) ?? '.')
const { default: stat } = await import('node:fs/promises').then((m) => m)
const st = await stat(target).catch(() => null)
if (!st) { console.error(`jscad: no such file or directory: ${target}`); process.exit(1) }
const modelDir = st.isDirectory() ? target : dirname(target)

const pick = ['build', 'build_dev'].map((d) => join(webDir, d)).find((d) => existsSync(join(d, 'index.html')))
let out = pick
if (!out || args.includes('--build')) {
  if (args.includes('--no-build')) { console.error('jscad: no build output; run `npm run build` in apps/jscad-web or pass --build'); process.exit(1) }
  console.log('jscad: building web bundles…')
  const r = spawnSync('node', ['build.js', '--skipDocs'], { cwd: webDir, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
  out = join(webDir, existsSync(join(webDir, 'build', 'index.html')) ? 'build' : 'build_dev')
}
const { entryFile, urlPath } = await resolveEntry(modelDir, args.includes('--no-build') ? {} : {}).catch((e) => { console.error(e.message); process.exit(1) })
const allowlist = process.env.RELAY_ALLOWLIST && existsSync(process.env.RELAY_ALLOWLIST)
  ? loadAllowlist(process.env.RELAY_ALLOWLIST)
  : defaultAllowlist()
const origin = `http://localhost:${port}`
const relayHandler = createRelayHandler({ allowlist, trustedOrigins: [origin] })
const { url } = await startLocal({ appDir: out, frameDir: join(out, 'frame'), modelDir, relayHandler, port })
console.log(`jscad: ${modelDir} → ${url}/#url=${urlPath}  (frame :${port + 1})`)
```

Fix before committing: `resolveEntry(modelDir)` second-arg cruft and the unused `appOrigin` in Task 3 — simplify to `resolveEntry(modelDir, st.isDirectory() ? {} : { explicitFile: basename(target) })`.

- [ ] **Step 2: Wire npm scripts and docs**

`apps/jscad-web/package.json`: add `"jscad": "node scripts/jscad.mjs"`. Root `package.json`: add `"jscad": "npm run jscad -w apps/jscad-web --"`. `apps/jscad-web/README.md`: append:

```md
## Local model directory

From any model folder: `npx jscad` (or `node <checkout>/apps/jscad-web/scripts/jscad.mjs [dir|file] [--port N]`). Serves the app on `:7377`, frame on `:7378`, your folder at `/models/`, and a same-origin `/api/relay` so AI Chat works with your own key.
```

- [ ] **Step 3: Verify by boot**

Run: `node scripts/jscad.mjs --help`? (no help flag — instead) `mkdir -p /tmp/jscad-probe && echo 'const main=()=>{}; module.exports={main}' > /tmp/jscad-probe/cube.js && timeout 8 node scripts/jscad.mjs /tmp/jscad-probe --port 7399 || true` (workdir `apps/jscad-web`)
Expected: logs `jscad: /tmp/jscad-probe → http://localhost:7399/#url=/models/cube.js`, `curl http://localhost:7399/models/cube.js` 200 in parallel run.

- [ ] **Step 4: Run full local test files**

Run: `npx vitest run scripts/local/` (workdir `apps/jscad-web`)
Expected: all pass (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/scripts/jscad.mjs apps/jscad-web/package.json package.json apps/jscad-web/README.md
git commit -m "feat(jscad-web): single-script local startup (app+frame+relay on :7377)"
```

## Self-Review

- Spec coverage: §1 entry rules → Task 1 + Task 4 wiring; §2 one process + `/models` + relay + no-auth → Tasks 2-3; §3 port 7377/open URL/errors/tests → Tasks 3-4. Relay default same-origin holds because the relay is mounted on the app origin.
- Placeholders: none — code blocks are complete; Task 4 notes two pre-commit cleanups explicitly.
- Type consistency: `createRelayHandler({allowlist, trustedOrigins, allowPrivateUpstream?})`, `resolveEntry(dir, opts) -> {entryFile, urlPath}`, `startLocal({appDir, frameDir, modelDir, relayHandler, port}) -> {appServer, frameServer, url}` used identically across tasks.
