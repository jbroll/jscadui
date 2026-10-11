# Deploy hardening batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the locally-testable security gaps: the relay limiter cannot be grown without bound, production refuses to boot without a real auth secret, the relay never echoes allowlist file paths, and the launcher's `/models/` cannot expose dotfiles or escape through symlinks.

**Architecture:** Bounded limiter with idle eviction; production-only config gates; a fixed relay error body with server-side logging; the launcher reuses the `fsApi.js` hidden-segment, realpath and Host/Origin checks it already has.

**Tech Stack:** TypeScript + Express + better-sqlite3 (server, vitest + supertest), plain Node HTTP (launcher, vitest).

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run the `apps/jscad-web/server` and `apps/jscad-web/scripts` suites, not the full OpenSCAD suite.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0. Server code is TypeScript — keep `tsc` clean.
- YAGNI: no deploy-script edits, no new dependencies.
- Commit each task separately on the current branch (working in place per user choice).
- The pre-commit hook is red on a pre-existing unrelated failure (`apps/jscad-web/test/storage-rowboat.test.js`, tracked in `docs/backlog.md` Remaining issues). When scoped gates are green and the hook blocks only on that failure, commit with `--no-verify` and say so in the report.

## Out of scope (deploy-coupled; stay in backlog)

- **`trust proxy: true` (`server/src/index.ts:69`) tuning.** The right value (`'loopback'`, a fixed hop count, or `X-Real-IP`) depends on how the Apache front sets the forwarded address, which lives in the VPS `deploy.sh` (not this repo). Changing it blind could mis-key the limiter or better-auth's IP. A deploy decision.
- **CSP and COOP headers.** Set by the Apache block in the VPS `deploy.sh` (`modules/apache/build.sh`), also not in this repo.
- Both remain `docs/backlog.md` Security bullets.

---

### Task 1: Bound the relay limiter with idle eviction

**Files:**
- Modify: `apps/jscad-web/server/src/relay/policy.js` (`createLimiter` at `:243-268`)
- Test: `apps/jscad-web/server/test/relay-limiter.test.ts`

**Interfaces:**
- Consumes: `createLimiter({ ratePerMin, burst, now? })` returning `{ check(key): LimitResult }`.
- Produces: same shape plus `size()` (tracked key count) and an optional `maxBuckets` (default 10_000); when the map would exceed it and a new key arrives, fully-refilled (idle) buckets are dropped so a flood of distinct keys cannot grow the map past the cap once they idle. A still-draining bucket is never dropped: if every bucket is live the map may briefly exceed the cap rather than evict a live key. `size()` exists so the cap is observable in a test (the eviction is otherwise invisible: an evicted key and a refilled idle key both answer `ok: true`).

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/server/test/relay-limiter.test.ts`, add:

```ts
it('evicts fully-refilled buckets once the map passes the cap', () => {
  let t = 0
  const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t, maxBuckets: 3 })
  limiter.check('a'); limiter.check('b'); limiter.check('c')
  // a, b, c idle back to a full token well before the next arrivals
  t += 120_000
  limiter.check('d'); limiter.check('e'); limiter.check('f')
  // the idle buckets were dropped, so the cap held
  expect(limiter.size()).toBeLessThanOrEqual(3)
  // and the live keys are still tracked: a second check is still refused
  expect(limiter.check('f')).toMatchObject({ ok: false })
  expect(limiter.check('e')).toMatchObject({ ok: false })
})

it('never evicts a bucket that is still draining', () => {
  let t = 0
  const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t, maxBuckets: 1 })
  expect(limiter.check('a').ok).toBe(true)
  // b arrives while a is drained (not yet refilled): a must stay, b still gets a bucket
  expect(limiter.check('b').ok).toBe(true)
  // a remains rate-limited, proving it was not evicted mid-drain
  expect(limiter.check('a')).toMatchObject({ ok: false })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/jscad-web/server/test/relay-limiter.test.ts` (from `apps/jscad-web/server`)
Expected: FAIL. `maxBuckets` is ignored; the map is unbounded.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/server/src/relay/policy.js`, update `createLimiter`:

```js
export const createLimiter = ({ ratePerMin, burst, now = Date.now, maxBuckets = 10_000 }) => {
  const perMs = ratePerMin / 60_000
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map()
  const refilled = (bucket, t) => Math.min(burst, bucket.tokens + (t - bucket.at) * perMs)
  const evictIdle = (t) => {
    for (const [key, bucket] of buckets) {
      if (refilled(bucket, t) >= burst) buckets.delete(key)
      if (buckets.size < maxBuckets) break
    }
  }
  return {
    check(key) {
      const t = now()
      if (!buckets.has(key) && buckets.size >= maxBuckets) evictIdle(t)
      const bucket = buckets.get(key) ?? { tokens: burst, at: t }
      const tokens = refilled(bucket, t)
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: t })
        return { ok: true }
      }
      buckets.set(key, { tokens, at: t })
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) }
    },
    // Tracked keys; the cap bound is only observable through this.
    size() {
      return buckets.size
    },
  }
}
```

(Update the JSDoc above it: the map is bounded at `maxBuckets` by evicting fully-refilled idle buckets on insert past the cap; a still-draining bucket is never dropped, so the map may briefly exceed the cap when every bucket is live.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/server/test/relay-limiter.test.ts apps/jscad-web/server/test/relay.test.ts`
Expected: PASS, including the 2 pre-existing limiter tests.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/server/src/relay/policy.js apps/jscad-web/server/test/relay-limiter.test.ts
git commit -m "fix(relay): bound the limiter with idle-bucket eviction"
```

### Task 2: Refuse production boot without a real auth secret; gate the dev origin

**Files:**
- Modify: `apps/jscad-web/server/src/config.ts` (`:21-22`, `:68-74`)
- Create: `apps/jscad-web/server/test/config.test.ts`

**Interfaces:**
- Consumes: `configFromEnv()` reading `process.env` at call time; `NODE_ENV`, `BETTER_AUTH_SECRET`, `FRONTEND_URL`, `ROWBOAT_DATABASE_ID`, `ROWBOAT_URL`.
- Produces: production throws when `BETTER_AUTH_SECRET` is unset (dev keeps the placeholder); `http://localhost:5120` is a trusted origin only outside production; `https://jscad.rkroll.com` and `https://appleid.apple.com` stay in both.

- [ ] **Step 1: Write the failing tests**

Create `apps/jscad-web/server/test/config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.js'

const REQUIRED = { ROWBOAT_DATABASE_ID: 'db_test', ROWBOAT_URL: 'https://rowboat.test' }
const KEYS = ['NODE_ENV', 'BETTER_AUTH_SECRET', 'FRONTEND_URL', 'ROWBOAT_DATABASE_ID', 'ROWBOAT_URL']
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, REQUIRED)
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('configFromEnv', () => {
  it('refuses production without BETTER_AUTH_SECRET', () => {
    process.env.NODE_ENV = 'production'
    expect(() => configFromEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('keeps the placeholder secret outside production and trusts the dev origin', () => {
    const config = configFromEnv()
    expect(config.authSecret).toBe('dev-secret-change-me')
    expect(config.trustedOrigins).toContain('http://localhost:5120')
  })

  it('drops the dev origin and keeps the real origins in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_SECRET = 'a-real-secret'
    const config = configFromEnv()
    expect(config.trustedOrigins).not.toContain('http://localhost:5120')
    expect(config.trustedOrigins).toContain('https://jscad.rkroll.com')
    expect(config.trustedOrigins).toContain('https://appleid.apple.com')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/jscad-web/server/test/config.test.ts`
Expected: FAIL. Production currently boots with the placeholder and always trusts `localhost:5120`.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/server/src/config.ts`, before the return:

```ts
  const authSecret = process.env.BETTER_AUTH_SECRET
  if (isProd && !authSecret) {
    throw new Error(
      'BETTER_AUTH_SECRET is required in production; the dev placeholder would let anyone forge the session cookie',
    )
  }
```

and in the returned object:

```ts
    authSecret: authSecret || 'dev-secret-change-me',
    trustedOrigins: [
      ...(isProd ? [] : ['http://localhost:5120']),
      'https://jscad.rkroll.com',
      'https://appleid.apple.com',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/server/test/config.test.ts apps/jscad-web/server/test/health.test.ts apps/jscad-web/server/test/syncToken.test.ts`
Expected: PASS. (health/syncToken build their own `ServerConfig`, so they are unaffected; this confirms it.)

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/server/src/config.ts apps/jscad-web/server/test/config.test.ts
git commit -m "fix(server): require a real auth secret in production, gate the dev origin"
```

### Task 3: Log the allowlist read failure and return a fixed relay error

**Files:**
- Modify: `apps/jscad-web/server/src/relay/routes.ts` (`forward` allowlist catch at `:65-71`)
- Test: `apps/jscad-web/server/test/relay.test.ts`

**Interfaces:**
- Consumes: the route's `logger` option (`routes.ts:25`); `readAllowlist` throwing on a bad file.
- Produces: a bad allowlist file returns `500 { error: 'relay: allowlist unavailable' }` with the real error (and any file path) logged server-side, never in the response.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/server/test/relay.test.ts`, add:

```ts
it('hides allowlist read errors from the response and logs them', async () => {
  const logs: unknown[] = []
  const app = express()
  mountRelayRoutes(app, {
    allowlistPath: '/nonexistent/does-not-exist.json',
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
  })
  const res = await request(app)
    .post('/api/relay/openai/v1/chat/completions')
    .set('Origin', 'https://app.test')
    .send({})
  expect(res.status).toBe(500)
  expect(res.body).toEqual({ error: 'relay: allowlist unavailable' })
  expect(JSON.stringify(res.body)).not.toContain('does-not-exist')
  expect(logs.some((l) => JSON.stringify(l).includes('allowlist'))).toBe(true)
})
```

(Check the file's existing `relayApp` helper and follow its shape; this test needs a bad path, hence its own app.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/server/test/relay.test.ts -t "hides allowlist"`
Expected: FAIL. The 500 body carries the raw error message (the file path).

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/server/src/relay/routes.ts`, replace the allowlist catch (`:66-71`):

```ts
    let table: Record<string, string>
    try {
      table = readAllowlist(options.allowlistPath)
    } catch (err) {
      logger({ relay: 'allowlist-error', message: (err as Error).message })
      res.status(500).json({ error: 'relay: allowlist unavailable' })
      return
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/jscad-web/server/test/relay.test.ts`
Expected: PASS, all relay-route tests.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/server/src/relay/routes.ts apps/jscad-web/server/test/relay.test.ts
git commit -m "fix(relay): log allowlist read errors, return a fixed 500 body"
```

### Task 4: Launcher `/models/` refuses dotfiles, symlink escapes, and foreign Hosts

**Files:**
- Modify: `apps/jscad-web/scripts/local/server.js` (`route` at `:11-34`)
- Test: `apps/jscad-web/scripts/local/server.test.js`

**Interfaces:**
- Consumes: `fsApi.js` helpers. `hiddenSegment` (`:13`) and `resolvesInside` (`:29-39`) are currently module-private — add `export` to both (a one-line change each) so the launcher's static route reuses the exact checks `/api/fs` already applies, rather than duplicating them.
- Produces: `/models/<path>` 404s for a hidden segment (`.env`, `.git/config`, `..`), 404s for a symlink whose realpath leaves `modelDir`, matching what `/api/fs` enforces. `/models/` stays readable by the app origin as today.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/scripts/local/server.test.js`, add `symlinkSync` to the `node:fs` import (`:3`) and add a test mirroring the file's existing `startLocal` destructure (`{ appServer, frameServer, url }`):

```js
it('refuses dotfiles and symlinks that leave the model directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
  mkdirSync(join(root, 'frame'), { recursive: true })
  mkdirSync(join(root, 'models', '.git'), { recursive: true })
  writeFileSync(join(root, 'models', '.env'), 'SECRET=1')
  writeFileSync(join(root, 'models', '.git', 'config'), '[core]')
  writeFileSync(join(root, 'outside.txt'), 'out')
  symlinkSync(join(root, 'outside.txt'), join(root, 'models', 'link.txt'))
  const { appServer, frameServer, url } = await startLocal({
    appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
    relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
    port: 0,
  })
  try {
    expect((await fetch(`${url}/models/.env`)).status).not.toBe(200)
    expect((await fetch(`${url}/models/.git/config`)).status).not.toBe(200)
    expect((await fetch(`${url}/models/link.txt`)).status).not.toBe(200)
  } finally {
    appServer.close(); frameServer.close()
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/scripts/local/server.test.js -t "dotfiles"`
Expected: FAIL (at least `.env` returns 200 today; the symlink may already be caught lexically only if it points `..`, but a same-level symlink is not).

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/scripts/local/server.js`, guard the `/models/` branch: reject a hidden or `node_modules` or empty segment and a realpath outside `modelDir` before reading. Export the two helpers from `fsApi.js` rather than duplicating:

```js
// in fsApi.js:
export const hiddenSegment = (s) => s.startsWith('.') || s === 'node_modules'
export const resolvesInside = async (root, abs) => { /* unchanged body */ }
```

```js
// in server.js, the /models/ branch (declare `cors` before it, and import
// { createFsHandler, hiddenSegment, resolvesInside } from './fsApi.js'):
if (path.startsWith('/models/')) {
  const segments = decodeURIComponent(path.slice('/models/'.length)).split(/[/\\]/)
  if (segments.some((s) => hiddenSegment(s) || s === '')) { res.writeHead(404, cors); res.end('not found'); return }
  const joined = safeJoin(modelDir, segments.join('/'))
  if (!joined || !(await resolvesInside(modelDir, joined))) { res.writeHead(404, cors); res.end('not found'); return }
  file = joined
} else {
  file = safeJoin(appDir, decodeURIComponent(path === '/' ? '/index.html' : path))
}
```

(`hiddenSegment` rejects `..` too, since `'..'` starts with `.`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/scripts/local/server.test.js apps/jscad-web/scripts/local/fsApi.test.js`
Expected: PASS, including the pre-existing `/models` serve tests and the new refusal test.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/scripts/local/server.js apps/jscad-web/scripts/local/server.test.js apps/jscad-web/scripts/local/fsApi.js
git commit -m "fix(launcher): refuse dotfiles and symlink escapes under /models"
```
