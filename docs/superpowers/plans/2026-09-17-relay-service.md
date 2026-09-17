# Relay service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CORS passthrough relay to the studio Express server that forwards user-keyed provider requests to allowlisted hosts and streams responses back, storing nothing.

**Architecture:** New `apps/jscad-studio/server/src/relay/` module (allowlist loader, in-memory rate limiter, Express routes) mounted in `index.ts` beside the agent routes; per-kind relay URLs in `apps/jscad-web/src/aiChat.js`. No new dependencies — `express`, `node:dns/promises`, and `node:net` only.

**Tech Stack:** TypeScript, Express 5, supertest + vitest, `fetch` upstream with web-stream piping.

## Global Constraints

- TypeScript in the studio server; JSDoc-typed JS nowhere here — server code is TS like the existing agent code.
- Comments say why, never what; one or two lines; default to none.
- The relay never stores keys, bodies, or conversations; logs carry method, kind, status, and byte counts only.
- No new runtime dependencies (no `cors` package, no rate-limit library — the server already hand-rolls CORS in `index.ts:15-35`).
- Studio agent routes, auth, and git routes stay behaviorally untouched.
- Live deploy (`deploy-full.sh`, DNS) is an owner action, not a subagent task — the plan ships code plus smoke coverage.

---

### Task 1: Allowlist loader

**Files:**
- Create: `apps/jscad-studio/server/src/relay/allowlist.ts`
- Test: `apps/jscad-studio/server/test/relay-allowlist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadAllowlistFile(path: string): Record<string, string>` (throws `Error('relay: ...')` on missing file, bad JSON, non-string values, non-`https:` URLs, explicit ports, or literal private/loopback IPs); `isPublicHttpsUrl(url: string): boolean`; `resolveUpstream(entry: string, subPath: string): string` (joins base + sub-path without `..` escape — throws on traversal).

- [ ] **Step 1: Write the failing test**

```ts
// apps/jscad-studio/server/test/relay-allowlist.test.ts
import { describe, expect, it } from 'vitest'
import { isPublicHttpsUrl, loadAllowlistFile, resolveUpstream } from '../src/relay/allowlist.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), `relay-test-${process.pid}`)
mkdirSync(dir, { recursive: true })
const file = (name: string, body: string) => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('allowlist', () => {
  it('loads a valid file', () => {
    const p = file('ok.json', JSON.stringify({ anthropic: 'https://api.anthropic.com' }))
    expect(loadAllowlistFile(p)).toEqual({ anthropic: 'https://api.anthropic.com' })
  })

  it('rejects http, ports, and literal private IPs', () => {
    expect(() => loadAllowlistFile(file('a.json', JSON.stringify({ x: 'http://api.anthropic.com' })))).toThrow(/https/)
    expect(() => loadAllowlistFile(file('b.json', JSON.stringify({ x: 'https://api.anthropic.com:8443' })))).toThrow(/port/)
    expect(() => loadAllowlistFile(file('c.json', JSON.stringify({ x: 'https://127.0.0.1/x' })))).toThrow(/private|loopback/)
    expect(() => loadAllowlistFile(file('d.json', 'not json'))).toThrow(/JSON|parse/)
    expect(() => loadAllowlistFile(join(dir, 'missing.json'))).toThrow(/read|ENOENT/)
  })

  it('joins sub-paths and refuses traversal', () => {
    expect(resolveUpstream('https://api.anthropic.com', 'v1/messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(() => resolveUpstream('https://api.anthropic.com', '../evil')).toThrow(/traversal/)
  })

  it('classifies public https URLs', () => {
    expect(isPublicHttpsUrl('https://api.anthropic.com')).toBe(true)
    expect(isPublicHttpsUrl('http://api.anthropic.com')).toBe(false)
    expect(isPublicHttpsUrl('https://10.0.0.1/')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/relay-allowlist.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: FAIL with "Failed to resolve import ../src/relay/allowlist.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/jscad-studio/server/src/relay/allowlist.ts
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'

// Literal-IP ranges refused at load; hostnames are resolved and re-checked at
// forward time, since DNS can change between load and request.
const PRIVATE_V4 = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./, /^169\.254\./, /^0\./]
const PRIVATE_V6 = [/^::1$/, /^fc/i, /^fd/i, /^fe8/i, /^fe9/i, /^fea/i, /^feb/i]

const isLiteralPrivate = (host: string): boolean => {
  if (!isIP(host)) return false
  if (host.includes(':')) return PRIVATE_V6.some((re) => re.test(host))
  return PRIVATE_V4.some((re) => re.test(host))
}

export const isPublicHttpsUrl = (url: string): boolean => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.port !== '') return false
  if (isLiteralPrivate(parsed.hostname)) return false
  return true
}

// Names the failing check so a rejected allowlist entry says why.
const rejectReason = (value: unknown): string => {
  if (typeof value !== 'string') return 'not a string'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'not a URL'
  }
  if (parsed.protocol !== 'https:') return 'not https'
  if (parsed.port !== '') return 'explicit port'
  if (isLiteralPrivate(parsed.hostname)) return 'private or loopback address'
  return 'rejected'
}

export const loadAllowlistFile = (path: string): Record<string, string> => {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(`relay: cannot read allowlist ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`relay: allowlist ${path} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`relay: allowlist ${path} must be a {name: url} object`)
  }
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !isPublicHttpsUrl(value)) {
      throw new Error(`relay: allowlist entry '${name}' must be a public https: URL without a port (${rejectReason(value)})`)
    }
    out[name] = value
  }
  return out
}

// Joins an allowlisted base with a relay sub-path; `..` segments escape the
// upstream base, so they are rejected instead of normalized.
export const resolveUpstream = (base: string, subPath: string): string => {
  const clean = subPath.replace(/^\/+/, '')
  if (clean.split('/').includes('..')) throw new Error('relay: path traversal refused')
  return `${base.replace(/\/+$/, '')}/${clean}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/relay-allowlist.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio/server/src/relay/allowlist.ts apps/jscad-studio/server/test/relay-allowlist.test.ts
git commit -m "feat(relay): allowlist loader with public-https validation"
```

---

### Task 2: In-memory rate limiter

**Files:**
- Create: `apps/jscad-studio/server/src/relay/limiter.ts`
- Test: `apps/jscad-studio/server/test/relay-limiter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createLimiter({ ratePerMin: number, burst: number, now?: () => number }): { check(key: string): { ok: true } | { ok: false, retryAfterSec: number } }` (token bucket per key; `now` seam for tests, defaults to `Date.now`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/jscad-studio/server/test/relay-limiter.test.ts
import { describe, expect, it } from 'vitest'
import { createLimiter } from '../src/relay/limiter.js'

describe('limiter', () => {
  it('allows burst then refuses with retry-after', () => {
    const t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 2, now: () => t })
    expect(limiter.check('1.2.3.4')).toEqual({ ok: true })
    expect(limiter.check('1.2.3.4')).toEqual({ ok: true })
    const refused = limiter.check('1.2.3.4')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.retryAfterSec).toBeGreaterThan(0)
  })

  it('refills over time and isolates keys', () => {
    let t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t })
    expect(limiter.check('a').ok).toBe(true)
    expect(limiter.check('a').ok).toBe(false)
    expect(limiter.check('b').ok).toBe(true)
    t += 61_000
    expect(limiter.check('a')).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/relay-limiter.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: FAIL with "Failed to resolve import ../src/relay/limiter.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/jscad-studio/server/src/relay/limiter.ts
// Per-key token bucket. Refill is lazy on check; idle buckets stay in the map
// (relay traffic is low-cardinality client IPs, so no eviction is needed).
export interface Limiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSec: number }
}

export const createLimiter = (options: {
  ratePerMin: number
  burst: number
  now?: () => number
}): Limiter => {
  const now = options.now ?? Date.now
  const perMs = options.ratePerMin / 60_000
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    check(key: string) {
      const t = now()
      const bucket = buckets.get(key) ?? { tokens: options.burst, at: t }
      const tokens = Math.min(options.burst, bucket.tokens + (t - bucket.at) * perMs)
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: t })
        return { ok: true }
      }
      buckets.set(key, { tokens, at: t })
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/relay-limiter.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio/server/src/relay/limiter.ts apps/jscad-studio/server/test/relay-limiter.test.ts
git commit -m "feat(relay): in-memory per-IP token bucket"
```

---

### Task 3: Relay routes, mount, and config

**Files:**
- Create: `apps/jscad-studio/server/src/relay/routes.ts`
- Modify: `apps/jscad-studio/server/src/index.ts:68-89` (mount relay routes; add `relayAllowlistPath` to `ServerConfig` usage)
- Modify: `apps/jscad-studio/server/src/config.ts:3-20,65-87` (add `relayAllowlistPath` field + `RELAY_ALLOWLIST` env, default `/etc/jscad-relay/providers.json`)
- Test: `apps/jscad-studio/server/test/relay.test.ts`

**Interfaces:**
- Consumes: `loadAllowlistFile`, `resolveUpstream` (Task 1); `createLimiter` (Task 2); `trustedOrigins: string[]` (existing config).
- Produces: `mountRelayRoutes(app: Express, options: { allowlistPath: string; trustedOrigins: string[]; logger?: (entry: object) => void; fetchFn?: typeof fetch; dnsLookup?: (host: string) => Promise<Array<{ address: string }>> }): void`. Routes: `POST /api/relay/:kind/*splat` forwards to `{upstream}/{splat}`; `OPTIONS` answers preflight `204` for trusted origins. Log entries are `{ relay: kind, status, bytes }` — never headers or bodies.

- [ ] **Step 1: Write the failing test**

```ts
// apps/jscad-studio/server/test/relay.test.ts
import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'

const dir = join(tmpdir(), `relay-routes-${process.pid}`)
mkdirSync(dir, { recursive: true })
const allowlistPath = join(dir, 'providers.json')
writeFileSync(allowlistPath, JSON.stringify({ openai: 'https://upstream.test' }))

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const relayApp = (logs: unknown[]) => {
  const app = express()
  mountRelayRoutes(app, {
    allowlistPath,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup: async () => [{ address: '93.184.216.34' }],
  })
  return app
}

const sseResponse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

describe('relay routes', () => {
  it('answers preflight for a trusted origin', async () => {
    const res = await request(relayApp([])).options('/api/relay/openai/v1/chat/completions').set('Origin', 'https://app.test')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://app.test')
  })

  it('refuses an untrusted origin with 403', async () => {
    const res = await request(relayApp([])).post('/api/relay/openai/v1/chat/completions').set('Origin', 'https://evil.test').send({ model: 'm' })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown kind', async () => {
    const res = await request(relayApp([])).post('/api/relay/other/v1/x').set('Origin', 'https://app.test').send({})
    expect(res.status).toBe(404)
  })

  it('forwards method, body, and auth header and streams bytes back with CORS', async () => {
    // Fresh body per call: response streams are single-use.
    fetchMock.mockImplementation(async () => sseResponse('data: {"a":1}\n\n'))
    const logs: unknown[] = []
    const res = await request(relayApp(logs))
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-secret')
      .send({ model: 'm' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upstream.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer sk-secret' }) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://app.test')
    expect(res.text).toContain('data: {"a":1}')
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toMatch(/sk-secret|model/)
  })

  it('refuses an upstream that resolves to a private address', async () => {
    const app = express()
    const logs: unknown[] = []
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: (entry) => logs.push(entry),
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '10.0.0.5' }],
    })
    const res = await request(app).post('/api/relay/openai/v1/x').set('Origin', 'https://app.test').send({})
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rate-limits a hot IP with 429 and Retry-After', async () => {
    const logs: unknown[] = []
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    // One app, one limiter: 61 rapid turns against a burst-10 bucket.
    const app = relayApp(logs)
    let last = 0
    let retryAfter = ''
    for (let i = 0; i < 61; i++) {
      const r = await request(app).post('/api/relay/openai/v1/x').set('Origin', 'https://app.test').send({})
      last = r.status
      retryAfter = r.headers['retry-after'] ?? retryAfter
    }
    expect(last).toBe(429)
    expect(retryAfter).not.toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/relay.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: FAIL with "Failed to resolve import ../src/relay/routes.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/jscad-studio/server/src/relay/routes.ts
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Express, Request, Response } from 'express'
import { loadAllowlistFile, resolveUpstream } from './allowlist.js'
import { createLimiter } from './limiter.js'

export interface RelayRouteOptions {
  allowlistPath: string
  trustedOrigins: string[]
  logger?: (entry: Record<string, unknown>) => void
  fetchFn?: typeof fetch
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
}

// Forwarded hop-by-hop headers are the caller's, not the relay's; content
// length especially must go, since the relay streams without knowing it.
const DROP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])

const pickHeaders = (req: Request): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (DROP_HEADERS.has(name.toLowerCase())) continue
    if (typeof value === 'string') out[name] = value
  }
  return out
}

// Hostnames are resolved here, at forward time: DNS between allowlist load
// and this request could otherwise point a permitted name at a private IP.
const assertPublicHost = async (
  url: string,
  dnsLookup: (host: string) => Promise<Array<{ address: string }>>,
): Promise<void> => {
  const host = new URL(url).hostname
  if (isIP(host)) return
  const records = await dnsLookup(host)
  if (records.some((r) => isPrivateAddr(r.address))) {
    throw new Error('relay: upstream resolves to a private address')
  }
}

const isPrivateAddr = (addr: string): boolean => {
  if (addr.includes(':')) return /^(::1|fc|fd|fe[89ab])/i.test(addr)
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.)/.test(addr)
}

const readAllowlist = (path: string): Record<string, string> => {
  const now = Date.now()
  if (cached && cached.path === path && now - cached.at < 5_000) return cached.table
  const table = loadAllowlistFile(path)
  cached = { at: now, path, table }
  return table
}

let cached: { at: number; path: string; table: Record<string, string> } | null = null

export function mountRelayRoutes(app: Express, options: RelayRouteOptions): void {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)))
  const fetchFn = options.fetchFn ?? fetch
  const dnsLookup = options.dnsLookup ?? ((host) => lookup(host, { all: true }))
  const limiter = createLimiter({ ratePerMin: 60, burst: 10 })
  const allowed = new Set(options.trustedOrigins)

  const corsFor = (req: Request, res: Response): boolean => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      return true
    }
    return false
  }

  app.options('/api/relay/*splat', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(204).end()
      return
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'Content-Type,Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
    res.status(204).end()
  })

  app.post('/api/relay/:kind/*splat', async (req, res) => {
    if (!corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' })
      return
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const limited = limiter.check(ip)
    if (!limited.ok) {
      res.setHeader('Retry-After', String(limited.retryAfterSec))
      res.status(429).json({ error: 'rate limited' })
      return
    }
    let table: Record<string, string>
    try {
      table = readAllowlist(options.allowlistPath)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
      return
    }
    const { kind } = req.params as unknown as { kind: string }
    const base = table[kind]
    if (!base) {
      res.status(404).json({ error: 'unknown provider' })
      return
    }
    const { splat } = req.params as unknown as { splat?: string[] | string }
    const subPath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '')
    let upstream: string
    try {
      upstream = resolveUpstream(base, subPath)
      await assertPublicHost(upstream, dnsLookup)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
      return
    }
    let upstreamRes: globalThis.Response
    try {
      upstreamRes = await fetchFn(upstream, {
        method: 'POST',
        headers: pickHeaders(req),
        body: JSON.stringify(req.body ?? {}),
      })
    } catch {
      res.status(502).json({ error: 'upstream unreachable' })
      return
    }
    res.status(upstreamRes.status)
    const contentType = upstreamRes.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.setHeader('cache-control', 'no-cache')
    let bytes = 0
    try {
      if (!upstreamRes.body) {
        res.end()
      } else {
        const reader = upstreamRes.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (!res.write(value)) await new Promise<void>((r) => res.once('drain', r))
        }
        res.end()
      }
    } catch {
      res.destroy()
      return
    }
    logger({ relay: kind, status: upstreamRes.status, bytes })
  })
}
```

Config addition in `apps/jscad-studio/server/src/config.ts`:

```ts
export interface ServerConfig {
  // ... existing fields ...
  /** Path to the relay provider allowlist file; unrelated to rowboat. */
  relayAllowlistPath: string;
}
```

```ts
    relayAllowlistPath: process.env.RELAY_ALLOWLIST || '/etc/jscad-relay/providers.json',
```

Mount in `apps/jscad-studio/server/src/index.ts` after the agent routes:

```ts
import { mountRelayRoutes } from './relay/routes.js';
// ...
  mountRelayRoutes(app, { allowlistPath: config.relayAllowlistPath, trustedOrigins: config.trustedOrigins });
```

`app.use(express.json())` stays before the mount (already at `index.ts:83`), so `req.body` is parsed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/relay.test.ts test/relay-allowlist.test.ts test/relay-limiter.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: PASS (all three files green).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio/server/src/relay/routes.ts apps/jscad-studio/server/src/config.ts apps/jscad-studio/server/src/index.ts apps/jscad-studio/server/test/relay.test.ts
git commit -m "feat(relay): provider relay routes with origin and rate limits"
```

---

### Task 4: Per-kind relay URLs in the browser

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js:8-11` (`relayBaseUrl` gains a kind parameter)
- Modify: `apps/jscad-web/test/aiChat.test.js` (assert per-kind URLs)
- Test: same file

**Interfaces:**
- Consumes: `getProviderConfig()` shape `{kind, model, baseUrl?, apiKey}`; relay route shape `/api/relay/:kind` from Task 3.
- Produces: `relayBaseUrl(kind: 'anthropic' | 'openai'): string` defaulting to `{RELAY_ROOT}/api/relay/{kind}` with `localStorage 'jscad-ai.relay'` override as the root.

- [ ] **Step 1: Write the failing test**

Append to `apps/jscad-web/test/aiChat.test.js`:

```js
// @vitest-environment jsdom (already at top of file)
import { relayBaseUrl } from '../src/aiChat.js'

describe('relay base url', () => {
  it('builds per-kind relay paths under the default root', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    expect(relayBaseUrl('anthropic')).toBe('https://jscad.rkroll.com/api/relay/anthropic')
    expect(relayBaseUrl('openai')).toBe('https://jscad.rkroll.com/api/relay/openai')
  })

  it('honors the localStorage root override', async () => {
    window.localStorage.setItem('jscad-ai.relay', 'http://127.0.0.1:9999')
    expect(relayBaseUrl('openai')).toBe('http://127.0.0.1:9999/api/relay/openai')
    window.localStorage.removeItem('jscad-ai.relay')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aiChat.test.js`
Workdir: `apps/jscad-web`
Expected: FAIL with "relayBaseUrl is not a function" or "Expected ... toBe ..." (current `relayBaseUrl()` takes no kind and returns the bare root).

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/aiChat.js`, replace:

```js
export const relayBaseUrl = () =>
  globalThis.localStorage?.getItem(RELAY_OVERRIDE_KEY) || RELAY_DEFAULT
```

with:

```js
export const relayBaseUrl = (kind) => {
  const root = globalThis.localStorage?.getItem(RELAY_OVERRIDE_KEY) || RELAY_DEFAULT
  return `${root.replace(/\/+$/, '')}/api/relay/${kind}`
}
```

and at the provider construction site replace:

```js
const provider = createProvider({ ...selection, baseUrl: selection.baseUrl || relayBaseUrl() })
```

with:

```js
const provider = createProvider({ ...selection, baseUrl: selection.baseUrl || relayBaseUrl(selection.kind) })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/aiChat.test.js test/aiBridge.test.js`
Workdir: `apps/jscad-web`
Expected: PASS (both files green).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js
git commit -m "feat(jscad-web): per-kind relay URLs"
```

---

### Task 5: Smoke coverage and relay docs

**Files:**
- Modify: `apps/jscad-studio/e2e/smoke-deploy.mjs` (append bad-origin relay probe)
- Create: `apps/jscad-studio/server/RELAY.md` (operator doc: allowlist file, env, log shape, smoke)
- Test: rerun Task 3 suite (no new unit tests; the probe runs only in deploy)

**Interfaces:**
- Consumes: relay routes from Task 3 (live at `{APP_URL}/api/relay/...` through the existing `/api` proxy).
- Produces: deploy-time proof that untrusted origins get `403` and the allowlist is live.

- [ ] **Step 1: Write the failing probe**

Append to `apps/jscad-studio/e2e/smoke-deploy.mjs` after the run-host header
checks, using the file's own `check(name, ok, detail)` helper (not a raw
`process.exit`), and extend the header comment's numbered list with the relay
probe (renumbering the stub-provider turn). Pre-deploy evidence is a bare
`node -e` fetch (no browser): the bad-origin POST returns `404`, not `403`:

```js
// 5. Relay refuses an untrusted origin without touching any provider.
const relayRes = await fetch(`${APP_URL}/api/relay/openai/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
  body: JSON.stringify({ model: 'probe' }),
})
check('relay refuses untrusted origins', relayRes.status === 403, `status ${relayRes.status}`)
```

Verify it fails pre-deploy by running it now:

Run: `APP_URL=https://jscad.rkroll.com node e2e/smoke-deploy.mjs`
Workdir: `apps/jscad-studio`
Expected: FAIL at the new probe (relay routes not deployed yet — `404` from SPA fallback or proxy).

- [ ] **Step 2: Run probe to confirm it fails**

Same command as Step 1. (This step exists so the failure is observed, not assumed.)

- [ ] **Step 3: Write the operator doc**

```md
<!-- apps/jscad-studio/server/RELAY.md -->
# Relay operator notes

The relay (`src/relay/`) forwards user-keyed provider requests and streams
responses back. It stores nothing: no DB rows, no logs with secrets.

## Allowlist file

JSON `{kind: upstreamBase}`, default `/etc/jscad-relay/providers.json`,
override with `RELAY_ALLOWLIST`. Entries must be public `https:` URLs without
ports; re-read at most every 5s, so edits apply without restart.

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com" }
```

## Access rules

- Browser `Origin` must be in the server's trusted origins; else `403`.
- Per-IP 60 req/min, burst 10; over limit is `429` with `Retry-After`.
- No session required; the caller's provider key rides the request through.

## Logs and smoke

Each forwarded turn logs one JSON line: `{relay, status, bytes}`. Deploy
smoke (`e2e/smoke-deploy.mjs`) POSTs from a fake origin and expects `403`.
```

- [ ] **Step 4: Run relay unit suite once more**

Run: `npx vitest run test/relay.test.ts test/relay-allowlist.test.ts test/relay-limiter.test.ts`
Workdir: `apps/jscad-studio/server`
Expected: PASS (no code changed since Task 3; this guards the smoke edit).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio/e2e/smoke-deploy.mjs apps/jscad-studio/server/RELAY.md
git commit -m "test(relay): smoke origin probe and operator notes"
```

Live deploy (`deploy-full.sh prod`) and the post-deploy smoke run are owner actions, recorded in the plan as deferred, not subagent work.

---

## File map

| File | Responsibility |
|---|---|
| `server/src/relay/allowlist.ts` | Allowlist load/validate, sub-path join |
| `server/src/relay/limiter.ts` | Per-IP token bucket |
| `server/src/relay/routes.ts` | CORS, origin/rate checks, forward + stream, logging |
| `server/src/config.ts` | `relayAllowlistPath` field + env |
| `server/src/index.ts` | Mount relay routes |
| `server/test/relay*.test.ts` | Unit coverage for all three |
| `apps/jscad-web/src/aiChat.js` | Per-kind relay URLs |
| `server/RELAY.md` | Operator notes |
| `e2e/smoke-deploy.mjs` | Bad-origin deploy probe |
