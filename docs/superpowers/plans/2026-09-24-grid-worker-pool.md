# Grid Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run an `ALL.js` grid's leaves, including those of nested sub-grids, across several frame workers at once, handing out leaves by claim.

**Architecture:** The worker's stream hook gains `claim(key, url)`, a round trip to the frame. Generated `ALL.js` files become an item list plus one `gridModule(...)` call; `grid-utils.js` walks the tree, places sub-grids by a world transform, and runs only the leaves it wins. The frame keeps a list of workers; a streaming request is a run, and its first claim fans the same request out to up to `poolSize - 1` more workers. The run answers the app once, when its last member answers.

**Tech Stack:** Plain ES2022 JavaScript, vitest, `@jscad/modeling` v2 (`maths.mat4`, `transforms.transform`), `@jscadui/params-core`, Playwright render sweep via simple-ci.

**Spec:** `docs/superpowers/specs/2026-09-24-grid-worker-pool-design.md`

## Global Constraints

- Modern browsers only, ES2022+, no polyfills or compat shims.
- `poolSize` default `N = max(1, min(hardwareConcurrency - 1, 4))`; `jscadInit`'s `poolSize` overrides it and the frame strips it, as it does `timeoutMs`.
- The frame holds at most `poolSize + 1` workers: up to `poolSize` run members and one idle worker kept warm. `poolSize: 1` therefore behaves as today (an active worker and a spare).
- Claim message, worker to frame: `{ method: 'jscadClaim', id, params: [{ key, url, runId }] }` with a random id.
- Claim answer, frame to worker: `{ method: '__CLAIM__', params: [{ id, won }] }`. Deviation from the spec, which put `id` at the top level: `@jscadui/postmessage` treats any message with a top-level `id` as a request and answers it, so the id travels inside `params`. `runId` rides the claim so the frame can tell two runs on one worker apart.
- The worker offers `claim` only when `jscadInit` carried `claims: true`. The frame adds it to every `jscadInit`. Other hosts of `@jscadui/worker` never answer claims, so without the flag their grids would hang.
- Leaf key: the index path joined with `/`, e.g. `"2/14"`.
- Streamed-run answer from a run that fanned out: `{ ...primaryAnswer, entities: [], streamed: true, runId, lost }`, `trapped` removed, params merged across members (see Task 3).
- Comments: none by default; one or two lines of why when needed. Match surrounding style. No em dashes in docs or comments.
- Unit tests only locally. Render sweeps run on the GPU through simple-ci (`ci/*` scripts), never locally.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never open a PR.

---

### Task 1: Worker claims

**Files:**
- Create: `packages/worker/src/claims.js`
- Create: `packages/worker/src/claims.test.js`
- Modify: `packages/worker/src/stream.js`
- Modify: `packages/worker/src/stream.test.js`
- Modify: `packages/worker/src/state/workerState.js` (constructor, after `useParamsProxy`)
- Modify: `packages/worker/worker.js` (imports, `jscadInit`, `jscadMain`, `handlers`)
- Modify: `packages/worker/worker.stream.test.js`

**Model:** `sonnet` — multi-file, code given, small judgment on placement.

**Interfaces:**
- Produces: `createClaims({ post, randomId? }) => { claim(key, url, runId): Promise<boolean>, answer({ id, won }): void }`.
- Produces: `createStreamHook({ ..., claim? })`; when `claim` is given, `hook.claim(key, url): Promise<boolean>` exists and marks the run as emitted.
- Produces: `jscadInit({ claims: true })` sets `workerState.claims`; handler `__CLAIM__` resolves claims; `export const answerClaim` from `worker.js` (for tests).

- [ ] **Step 1: Write the failing claims test**

`packages/worker/src/claims.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createClaims } from './claims.js'

const counter = () => {
  let n = 0
  return () => `id${++n}`
}

describe('claims', () => {
  it('posts each claim under its own id and resolves it with the answer to that id', async () => {
    const post = vi.fn()
    const claims = createClaims({ post, randomId: counter() })
    const a = claims.claim('0', './a.scad', 7)
    const b = claims.claim('1', './b.scad', 7)
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { method: 'jscadClaim', id: 'id1', params: [{ key: '0', url: './a.scad', runId: 7 }] },
      { method: 'jscadClaim', id: 'id2', params: [{ key: '1', url: './b.scad', runId: 7 }] },
    ])
    claims.answer({ id: 'id2', won: false })
    claims.answer({ id: 'id1', won: true })
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(false)
  })

  it('wins only on won === true and ignores unknown or repeated answers', async () => {
    const claims = createClaims({ post: vi.fn(), randomId: counter() })
    const a = claims.claim('0', './a.scad', 1)
    claims.answer({ id: 'nobody', won: true })
    claims.answer()
    claims.answer({ id: 'id1', won: 'yes' })
    claims.answer({ id: 'id1', won: true })
    await expect(a).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/worker && npx vitest run src/claims.test.js`
Expected: FAIL, cannot resolve `./claims.js`.

- [ ] **Step 3: Implement `claims.js`**

```js
/**
 * A claim asks the frame whether this worker runs a grid leaf. The answer is
 * a __CLAIM__ notification with the id inside params: a message with a
 * top-level id is a request, which the worker would answer.
 * @param {{post: (message: object) => void, randomId?: () => string}} options
 */
export const createClaims = ({ post, randomId = () => crypto.randomUUID() }) => {
  /** @type {Map<unknown, (won: boolean) => void>} */
  const waiting = new Map()
  return {
    /**
     * @param {string} key
     * @param {string} url
     * @param {unknown} runId
     * @returns {Promise<boolean>}
     */
    claim: (key, url, runId) => new Promise((resolve) => {
      const id = randomId()
      waiting.set(id, resolve)
      post({ method: 'jscadClaim', id, params: [{ key, url, runId }] })
    }),
    /** @param {{id?: unknown, won?: unknown}} [answer] */
    answer: ({ id, won } = {}) => {
      const resolve = waiting.get(id)
      if (!resolve) return
      waiting.delete(id)
      resolve(won === true)
    },
  }
}
```

- [ ] **Step 4: Run the claims test**

Run: `cd packages/worker && npx vitest run src/claims.test.js`
Expected: PASS.

- [ ] **Step 5: Add stream hook tests**

Append inside the `describe('stream hook', ...)` block of `packages/worker/src/stream.test.js`:

```js
  it('offers claim only when given one, passing the runId and marking the run emitted', async () => {
    expect(createStreamHook({ post: vi.fn() }).hook.claim).toBeUndefined()
    const claim = vi.fn(async () => false)
    const { hook, emitted } = createStreamHook({ post: vi.fn(), runId: 3, claim })
    await expect(hook.claim('0/1', './a.scad')).resolves.toBe(false)
    expect(claim).toHaveBeenCalledWith('0/1', './a.scad', 3)
    expect(emitted()).toBe(true)
  })
```

- [ ] **Step 6: Implement the hook's claim**

In `packages/worker/src/stream.js`, change the JSDoc and signature of `createStreamHook` and add the claim after the `hook` object literal:

```js
/**
 * The hook an ALL.js grid finds on globalThis.__jscadStream: each emitted
 * cell goes to the app at once instead of waiting for main to return.
 * @param {{post: (message: object, transfer?: Transferable[]) => void, userInstances?: boolean, runId?: unknown, held?: Set<string>,
 *   claim?: (key: string, url: string, runId: unknown) => Promise<boolean>}} options
 *   runId is echoed on every batch so the app can drop batches of a run it has moved past
 */
export const createStreamHook = ({ post, userInstances, runId, held, claim }) => {
  let emitted = false
  const hook = {
    // emit and progress unchanged
  }
  // A grid that claims streams, even when it wins no leaf
  if (claim) {
    hook.claim = (key, url) => {
      emitted = true
      return claim(key, url, runId)
    }
  }
  return { hook, emitted: () => emitted }
}
```

Keep `emit` and `progress` exactly as they are; only the lines shown around them change.

- [ ] **Step 7: Run the stream tests**

Run: `cd packages/worker && npx vitest run src/stream.test.js`
Expected: PASS.

- [ ] **Step 8: Add worker tests**

Change the import line at the top of `packages/worker/worker.stream.test.js` to:

```js
const { jscadInit, jscadMain, jscadScript, lastRunStreamed, currentSolids, answerClaim } = await import('./worker.js')
```

Append:

```js
describe('jscadMain claims', () => {
  beforeEach(() => {
    self.postMessage = vi.fn()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    self.postMessage = vi.fn()
    workerState.main = undefined
    workerState.claims = false
  })

  const claimsPosted = () => self.postMessage.mock.calls.map(([message]) => message).filter((message) => message.method === 'jscadClaim')

  it('offers claim on the stream hook once jscadInit enables it, tagged with the runId', async () => {
    jscadInit({ claims: true })
    let won
    workerState.main = async () => {
      won = await globalThis.__jscadStream.claim('0/1', './a.scad')
      return []
    }

    const run = jscadMain({ params: {}, runId: 4 })
    await vi.waitFor(() => expect(claimsPosted()).toHaveLength(1))
    const [claim] = claimsPosted()
    expect(claim.params).toEqual([{ key: '0/1', url: './a.scad', runId: 4 }])
    answerClaim({ id: claim.id, won: true })
    const result = await run

    expect(won).toBe(true)
    expect(result.streamed).toBe(true)
    expect(result.runId).toBe(4)
  })

  it('counts a grid that wins no leaf as streamed and keeps no solids', async () => {
    jscadInit({ claims: true })
    workerState.main = async () => {
      await globalThis.__jscadStream.claim('0', './a.scad')
      return []
    }

    const run = jscadMain({ params: {}, runId: 5 })
    await vi.waitFor(() => expect(claimsPosted()).toHaveLength(1))
    answerClaim({ id: claimsPosted()[0].id, won: false })
    const result = await run

    expect(result.streamed).toBe(true)
    expect(lastRunStreamed()).toBe(true)
    expect(currentSolids()).toEqual([])
  })

  it('offers no claim unless jscadInit enabled it', async () => {
    jscadInit({})
    let claim = 'unset'
    workerState.main = () => {
      claim = globalThis.__jscadStream.claim
      return []
    }
    await jscadMain({ params: {} })
    expect(claim).toBeUndefined()
  })
})
```

- [ ] **Step 9: Run them to see them fail**

Run: `cd packages/worker && npx vitest run worker.stream.test.js`
Expected: FAIL, `answerClaim` is undefined / `__jscadStream.claim` is not a function.

- [ ] **Step 10: Wire claims into the worker**

`packages/worker/src/state/workerState.js`, in the constructor after the `useParamsProxy` field:

```js
    // Set by jscadInit when the host answers grid leaf claims
    /** @type {boolean} */
    this.claims = false
```

`packages/worker/worker.js`:

```js
import { createClaims } from './src/claims.js'
```

After the `setScriptLockTimeout` export, add:

```js
const claims = createClaims({ post: (message) => self.postMessage(message) })

export const answerClaim = claims.answer
```

In `jscadInit`, after `workerState.useParamsProxy = options.useParamsProxy`:

```js
  workerState.claims = options.claims === true
```

In `jscadMain`, the hook creation becomes:

```js
  const { hook, emitted } = stream
    ? createStreamHook({
      post: (message, transfer) => self.postMessage(message, transfer),
      userInstances: workerState.userInstances,
      runId,
      held: heldSet,
      claim: workerState.claims ? claims.claim : undefined,
    })
    : { hook: null, emitted: () => false }
```

Update the `@typedef InitOptions` JSDoc with `@prop {boolean} [claims] - the host answers jscadClaim, so a grid claims each leaf before running it`.

Add the handler:

```js
const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache:clearFileCache, jscadExportData, __CLAIM__: answerClaim }
```

- [ ] **Step 11: Run the worker package tests**

Run: `cd packages/worker && npx vitest run`
Expected: PASS, all files.

- [ ] **Step 12: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): claim grid leaves through the stream hook"
```

---

### Task 2: gridModule, nested placement, regenerated grids

**Files:**
- Modify: `apps/jscad-web/examples/lib/grid-utils.js`
- Modify: `packages/openscad/bin/generate-all-files.js:189-306` (`generateAllFile` template)
- Regenerate: every tracked `ALL*.js` under `apps/jscad-web/examples/`
- Create: `apps/jscad-web/test/grid-module.test.js`
- Modify: `apps/jscad-web/test/grid-utils.test.js`
- Modify: `apps/jscad-web/test/all-grid.test.js`

**Model:** `sonnet` — code given; the regeneration and test adaptation need care.

**Interfaces:**
- Consumes: the stream hook shape from Task 1: `{ emit(geoms), progress(), claim?(key, url): Promise<boolean> }` on `globalThis.__jscadStream`.
- Produces: `gridModule(items, { spacing, cellSize }, require) => { main(params), runGrid(params, { ctx, path, stream }), extent: [width, depth] }`; `gridExtent(total, spacing, cellSize)`; `prebuiltSkull(gx, gy, cellSize, ctx?)`.

- [ ] **Step 1: Write the failing gridModule tests**

`apps/jscad-web/test/grid-module.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const gridUtilsPath = join(__dirname, '..', 'examples', 'lib', 'grid-utils.js')
const nodeRequire = createRequire(gridUtilsPath)

// The examples package is "type": "module", so Node's require() cannot load it as CommonJS
const loadCjs = (path, req) => {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', readFileSync(path, 'utf-8'))(req, module.exports, module)
  return module.exports
}
const localRequire = (spec) => spec.startsWith('.') ? loadCjs(join(dirname(gridUtilsPath), spec), localRequire) : nodeRequire(spec)
const { gridModule, gridExtent } = loadCjs(gridUtilsPath, localRequire)

const jscad = nodeRequire('@jscad/modeling')
const { cube } = jscad.primitives
const { measureAggregateBoundingBox } = jscad.measurements

const OPTIONS = { spacing: 60, cellSize: 51 }
const FOUR = ['./a.scad', './b.scad', './c.scad', './d.scad']
const model = () => ({ main: () => cube({ size: 10 }) })

// A grid whose items resolve through `modules`; an Error there is thrown by require
const grid = (items, modules, required = []) => gridModule(items, OPTIONS, (url) => {
  required.push(url)
  const mod = modules[url]
  if (mod instanceof Error) throw mod
  if (!mod) throw new Error(`unexpected require ${url}`)
  return mod
})
const leaves = (items) => Object.fromEntries(items.map((url) => [url, model()]))

const box = (geoms) => {
  const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...geoms)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, z1 - z0) }
}

const claimingHook = (lose = []) => {
  const batches = []
  const keys = []
  return {
    batches,
    keys,
    emit: (geoms) => batches.push(geoms),
    progress: () => {},
    claim: async (key) => {
      keys.push(key)
      return !lose.includes(key)
    },
  }
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.__allWasmTrap
  delete globalThis.__jscadStream
})

describe('gridExtent', () => {
  it('spans the cell centres plus one cell', () => {
    expect(gridExtent(1, 60, 51)).toEqual([51, 51])
    expect(gridExtent(4, 60, 51)).toEqual([111, 111])
    expect(gridExtent(5, 60, 51)).toEqual([171, 111])
  })
})

describe('nested grids', () => {
  const s = 51 / 111

  it("places a sub-grid's leaves in its parent's cell, scaled by the sub-grid's item count", async () => {
    const parent = grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': grid(FOUR, leaves(FOUR)) })
    const geoms = await parent.main({})
    expect(geoms).toHaveLength(5)
    // the parent's second cell is at (30, 0); the sub-grid's first at (-30, -30) in its own frame
    const first = box([geoms[1]])
    expect(first.x).toBeCloseTo(30 - 30 * s, 5)
    expect(first.y).toBeCloseTo(-30 * s, 5)
    expect(first.size).toBeCloseTo(51 * s, 5)
    expect(box(geoms.slice(1)).size).toBeCloseTo(51, 5)
  })

  it('draws a one-item sub-grid at the full cell size', async () => {
    const parent = grid(['./sub/ALL.js'], { './sub/ALL.js': grid(['./a.scad'], leaves(['./a.scad'])) })
    const [leaf] = await parent.main({})
    expect(box([leaf]).size).toBeCloseTo(51, 5)
  })

  it('gives a sub-grid its own params namespace', async () => {
    const seen = vi.fn(() => cube({ size: 10 }))
    const parent = grid(['./sub/ALL.js'], { './sub/ALL.js': grid(['./a.scad'], { './a.scad': { main: seen } }) })
    await parent.main({ ALL: { a: { size: 3 } } })
    expect(seen).toHaveBeenCalledWith({ size: 3 })
  })

  it("places a failed leaf's marker in its sub-grid cell", async () => {
    quiet()
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': new Error('boom') })
    const geoms = await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }).main({})
    const marker = box(geoms.filter((g) => g.color))
    expect(marker.size).toBeCloseTo(51 * s, 5)
    expect(marker.x).toBeCloseTo(30 - 30 * s, 5)
    expect(marker.y).toBeCloseTo(-30 * s, 5)
  })

  it("streams a sub-grid's leaves one at a time through the parent's hook, hidden from leaf code", async () => {
    const batches = []
    let seen = 'unset'
    const peek = { main: () => { seen = globalThis.__jscadStream; return cube({ size: 10 }) } }
    const stream = globalThis.__jscadStream = { emit: (geoms) => batches.push(geoms), progress: () => {} }
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': peek })
    expect(await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }).main({})).toEqual([])
    expect(batches).toHaveLength(5)
    expect(seen).toBeNull()
    expect(globalThis.__jscadStream).toBe(stream)
  })
})

describe('claims', () => {
  it('skips a leaf it loses without requiring it', async () => {
    const required = []
    const hook = globalThis.__jscadStream = claimingHook(['1'])
    await grid(['./a.scad', './b.scad', './c.scad'], leaves(['./a.scad', './b.scad', './c.scad']), required).main({})
    expect(hook.keys).toEqual(['0', '1', '2'])
    expect(required).toEqual(['./a.scad', './c.scad'])
    expect(hook.batches).toHaveLength(2)
  })

  it('walks a sub-grid it wins nothing in, requiring only the sub-grid', async () => {
    const required = []
    const hook = globalThis.__jscadStream = claimingHook(['0', '1/0', '1/1', '1/2', '1/3'])
    const sub = grid(FOUR, leaves(FOUR), required)
    await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }, required).main({})
    expect(hook.keys).toEqual(['0', '1/0', '1/1', '1/2', '1/3'])
    expect(required).toEqual(['./sub/ALL.js'])
  })

  it('claims the same keys on every walk', async () => {
    const parent = grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': grid(FOUR, leaves(FOUR)) })
    const walk = async () => {
      const hook = globalThis.__jscadStream = claimingHook()
      await parent.main({})
      return hook.keys
    }
    expect(await walk()).toEqual(await walk())
  })

  it('stops claiming after a trap and marks the trapped leaf with the stored skull', async () => {
    quiet()
    const hook = globalThis.__jscadStream = claimingHook()
    const items = ['./a.scad', './b.scad', './c.scad']
    const trap = new WebAssembly.RuntimeError('unreachable')
    expect(await grid(items, { ...leaves(items), './b.scad': trap }).main({})).toEqual([])
    expect(hook.keys).toEqual(['0', '1'])
    const skull = hook.batches[1].flat(Infinity)
    expect(skull.every((layer) => layer.transforms.length === 16 && !layer.isManifoldGeom3)).toBe(true)
  })

  it('stops the parent too when a sub-grid leaf traps', async () => {
    quiet()
    const hook = globalThis.__jscadStream = claimingHook()
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': new WebAssembly.RuntimeError('unreachable') })
    await grid(['./sub/ALL.js', './y.scad'], { './sub/ALL.js': sub, './y.scad': model() }).main({})
    expect(hook.keys).toEqual(['0/0'])
  })
})
```

- [ ] **Step 2: Add the prebuiltSkull transform test**

In `apps/jscad-web/test/grid-utils.test.js`, inside `describe('prebuiltSkull', ...)`:

```js
  it('composes a world transform into its placement', () => {
    const { prebuiltSkull } = gridUtils
    const { mat4 } = jscad.maths
    const ctx = mat4.fromTranslation(mat4.create(), [100, 0, 0])
    const [[x0], [x1]] = measureAggregateBoundingBox(...prebuiltSkull(0, 0, 51, ctx))
    expect((x0 + x1) / 2).toBeCloseTo(100, 1)
  })
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/jscad-web && npx vitest run test/grid-module.test.js test/grid-utils.test.js`
Expected: FAIL, `gridModule is not a function`; the skull centre is 0.

- [ ] **Step 4: Implement gridModule in grid-utils.js**

In `apps/jscad-web/examples/lib/grid-utils.js`, replace the three destructuring lines after `const jscad = require('@jscad/modeling')` with:

```js
const { translate, scale, transform } = jscad.transforms
const { measureAggregateBoundingBox } = jscad.measurements
const { colorize } = jscad.colors
const { mat4 } = jscad.maths

const IDENTITY = mat4.create()
```

After `gridPosition`, add:

```js
/**
 * Width and depth a grid of `total` items covers: its cell centres plus one
 * cell. It depends only on the item count, so a parent can size a sub-grid
 * before any of the sub-grid's leaves run.
 *
 * @returns {[number, number]}
 */
function gridExtent(total, spacing, cellSize) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  return [(cols - 1) * spacing + cellSize, (rows - 1) * spacing + cellSize]
}

// gridPosition centres a grid on the origin, so scaling about it keeps the sub-grid centred
function subGridContext(ctx, x, y, cellSize, extent) {
  const s = cellSize / Math.max(...extent)
  const local = mat4.multiply(mat4.create(), mat4.fromTranslation(mat4.create(), [x, y, 0]), mat4.fromScaling(mat4.create(), [s, s, s]))
  return mat4.multiply(mat4.create(), ctx, local)
}

function toWorld(geoms, ctx) {
  if (ctx === IDENTITY) return geoms
  return geoms.map(g => {
    const placed = transform(ctx, g)
    disposeIntermediate(g, null)
    return placed
  })
}
```

Replace `prebuiltSkull` with:

```js
/**
 * The failure marker as plain geometry, for a cell that fails once the wasm
 * has trapped: building it needs no wasm.
 *
 * @returns {Array} two plain geom3s placed at (gx, gy) with longest side cellSize, then by ctx
 */
function prebuiltSkull(gx, gy, cellSize, ctx = IDENTITY) {
  const s = cellSize
  const cell = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, gx, gy, 0, 1]
  const placement = ctx === IDENTITY ? cell : mat4.multiply(mat4.create(), ctx, cell)
  return skullLayers().map(g => ({ ...g, transforms: [...placement] }))
}
```

Before `module.exports`, add:

```js
// Once the wasm has trapped, a built marker would need it too
function markerFor(x, y, cellSize, ctx) {
  if (!globalThis.__allWasmTrap) {
    try {
      return toWorld(normalizeAndPlace(failureMarker(), x, y, cellSize), ctx)
    } catch { /* fall back to the stored skull */ }
  }
  return [prebuiltSkull(x, y, cellSize, ctx)]
}

const isWasmTrap = (err) =>
  (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) || err?.name === 'RuntimeError'

// A generated grid: ALL.js, or a category grid such as ALL.printed.js
const isGridUrl = (url) => /(^|\/)ALL(\.[^/]+)?\.js$/.test(url)

function uniqueName(name, seen) {
  seen[name] = (seen[name] ?? 0) + 1
  return seen[name] === 1 ? name : `${name}_${seen[name]}`
}

/**
 * An ALL.js grid. Each item runs under its own params namespace in one cell.
 * An item that is itself a grid runs its own leaves, scaled into its parent's
 * cell, so each leaf streams on its own. When the stream hook can claim, a
 * leaf runs only on the worker that wins its key, the leaf's index path.
 *
 * @param {string[]} items - item urls, relative to the grid file
 * @param {{spacing: number, cellSize: number}} options
 * @param {(url: string) => any} req - the grid file's own require, so items resolve against its directory
 */
function gridModule(items, { spacing, cellSize }, req) {
  const extent = gridExtent(items.length, spacing, cellSize)

  /**
   * @param {object} [params]
   * @param {{ctx?: number[], path?: number[], stream?: object | null}} [where]
   * @returns {Promise<Array>} the leaves in world coordinates, or nothing when streaming
   */
  const runGrid = async (params = {}, { ctx = IDENTITY, path = [], stream = null } = {}) => {
    const all = []
    const nameSeen = {}
    const failed = []
    const generation = globalThis.__jscadScriptGeneration
    const claiming = typeof stream?.claim === 'function'

    const send = (geoms) => {
      if (!stream) {
        all.push(...geoms)
        return
      }
      try {
        stream.emit(geoms)
      } finally {
        for (const g of geoms) if (typeof g?.dispose === 'function') g.dispose()
      }
    }

    // One bad model marks its own cell; the rest of the grid still renders
    const fail = (url, x, y, err) => {
      if (isWasmTrap(err)) globalThis.__allWasmTrap ??= url
      console.error(`ALL: FAILED ${url}: ${err.message}`)
      failed.push(url)
      try {
        send(markerFor(x, y, cellSize, ctx))
      } catch (markerErr) {
        if (isWasmTrap(markerErr)) globalThis.__allWasmTrap ??= url
        send([prebuiltSkull(x, y, cellSize, ctx)])
      }
    }

    for (const [i, url] of items.entries()) {
      // A trapped worker stops claiming and leaves its unclaimed leaves to the others
      if (claiming && globalThis.__allWasmTrap) break
      const [x, y] = gridPosition(i, items.length, spacing)
      const name = uniqueName(urlToPartName(url), nameSeen)
      const key = [...path, i]

      let mod
      if (isGridUrl(url)) {
        try {
          mod = req(url)
        } catch (err) {
          fail(url, x, y, err)
          continue
        }
        if (typeof mod?.runGrid === 'function') {
          all.push(...await mod.runGrid(params[name], { ctx: subGridContext(ctx, x, y, cellSize, mod.extent), path: key, stream }))
          continue
        }
      }

      if (claiming && !(await stream.claim(key.join('/'), url))) continue
      try {
        // A trapped wasm instance stays broken, so no later cell's result can be trusted
        if (globalThis.__allWasmTrap) throw new Error(`not run: wasm trapped in ${globalThis.__allWasmTrap}`)
        mod ??= req(url)
        const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
        if (typeof fn === 'function') {
          const geoms = [].concat(await fn(params[name])).flat()
          // emit evaluates the cell's CSG, so its failures belong to this cell too
          send(toWorld(normalizeAndPlace(geoms, x, y, cellSize), ctx))
        }
      } catch (err) {
        fail(url, x, y, err)
      }

      if (!stream) globalThis.__jscadProgress?.()
      // Manifold handles are freed by a FinalizationRegistry, which only runs once main yields
      await new Promise(r => setTimeout(r, 0))
      // Yielding lets a newer script start in this worker; stop rather than run beside it
      if (globalThis.__jscadScriptGeneration !== generation) throw new Error(`grid superseded by a newer script after ${url}`)
    }

    if (failed.length) {
      console.error(`ALL: ${failed.length}/${items.length} models failed: ${failed.join(' ')}`)
    }
    return all
  }

  // Leaf code sees neither streaming nor claiming; the grid hands the hook down itself
  const main = async (params) => {
    const stream = globalThis.__jscadStream
    globalThis.__jscadStream = null
    try {
      return await runGrid(params, { stream })
    } finally {
      globalThis.__jscadStream = stream
    }
  }

  return { main, runGrid, extent }
}
```

Replace `module.exports` with:

```js
module.exports = {
  gridPosition,
  gridExtent,
  gridModule,
  normalizeAndPlace,
  urlToPartName,
  failureMarker,
  prebuiltSkull
}
```

Update the file's header comment: it provides `gridModule`, which every generated `ALL.js` calls, plus the placement helpers.

- [ ] **Step 5: Run the new tests**

Run: `cd apps/jscad-web && npx vitest run test/grid-module.test.js test/grid-utils.test.js`
Expected: PASS.

- [ ] **Step 6: Change the generator template**

In `packages/openscad/bin/generate-all-files.js`, `generateAllFile` builds `content` as:

```js
  const content = `"use strict"
// ⚠️  DO NOT EDIT THIS FILE - IT IS AUTO-GENERATED ⚠️
// This file is generated by bin/generate-all-files.js
// Any manual changes will be overwritten when the script runs.
//
// Auto-generated ALL script: runs each model under its own params namespace in
// one cell of a grid. See gridModule in lib/grid-utils.js.
const { gridModule } = require('${libPath}')

const items = ${itemsJson}

module.exports = gridModule(items, { spacing: ${spacing}, cellSize: ${cellSize} }, require)
`
```

The rest of `generateAllFile` is unchanged.

- [ ] **Step 7: Regenerate the grids**

Run from the repo root: `npm run generate-all`
Then: `git status --short apps/jscad-web/examples`
Expected: only tracked `ALL*.js` files modified, no files added or deleted. `git diff --stat` shows each shrinking to the new template. If any tracked file is added or deleted, stop and report.

- [ ] **Step 8: Update all-grid.test.js**

In `apps/jscad-web/test/all-grid.test.js`, rename the test `'hides the hook from a nested grid, which returns its geometry'` to `'hides the hook from leaf code'` (its body stays). Add to `describe('generated ALL.js grid', ...)`:

```js
  it('exports runGrid and its extent, so a parent grid can nest it', () => {
    const grid = loadCjs(gridPath, (name) => name.endsWith('grid-utils.js') ? loadGridUtils() : { main: () => cube({ size: 10 }) })
    expect(typeof grid.runGrid).toBe('function')
    expect(grid.extent).toEqual([4 * 60 - 60 + 51, 3 * 60 - 60 + 51])
  })
```

(`text/ALL.js` has 11 items: 4 columns, 3 rows.)

- [ ] **Step 9: Run the app unit tests**

Run: `cd apps/jscad-web && npx vitest run test/all-grid.test.js test/grid-module.test.js test/grid-utils.test.js test/grid-order.test.js test/nopscadlib-categories.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/jscad-web/examples apps/jscad-web/test packages/openscad/bin/generate-all-files.js
git commit -m "feat(grids): nest sub-grids by transform and claim each leaf"
```

---

### Task 3: Frame worker pool and grid runs

**Files:**
- Create: `apps/jscad-web/src_frame/workerSlot.js`
- Create: `apps/jscad-web/src_frame/workerPool.js`
- Create: `apps/jscad-web/src_frame/gridRun.js`
- Create: `apps/jscad-web/src_frame/mergeProxyStates.js`
- Rewrite: `apps/jscad-web/src_frame/frameHost.js`
- Modify: `apps/jscad-web/test/frame-host.test.js` (append a `grid runs` block)

**Model:** `opus` — concurrency and lifecycle across four modules; the existing 60+ frame tests are the regression guard.

**Interfaces:**
- Consumes: worker claim protocol from Task 1 (`jscadClaim` in, `__CLAIM__` out, `claims: true` in `jscadInit`).
- Produces: `createFrameHost({ ..., hardwareConcurrency? })` returning `{ handleMessage, getPendingCount }`, as today. `jscadInit` accepts `poolSize`. A fanned-out run's answer carries `lost: {url, reason}[]`. `frameHost.js` still exports `DEFAULT_TIMEOUT_MS`, `ABANDON_AFTER_MS`, `workerBundles`; adds `defaultPoolSize`.

Shared state, owned by `frameHost.js` and passed to the modules:

```js
/** @type {{slots: Slot[], active: Slot | null, mirrored: object[], lastScript: object | undefined,
 *   lastMain: object | undefined, poolSize: number, timeoutMs: number}} */
```

A slot records the script it has loaded as `slot.script` (compared by identity with `state.lastScript`) in place of `loaded`. `slot.queued` holds `{ message, entry }` pairs. An entry is what `track` records: `{ appId, method, options, setup }` for an app request, `{ method, onAnswer, setup?, run? }` for the frame's own.

- [ ] **Step 1: Write the failing grid-run tests**

Append to `apps/jscad-web/test/frame-host.test.js`:

```js
describe('grid runs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const superseded = { name: 'SupersededError', message: 'superseded by a newer run' }
  const sent = (worker) => worker.postMessage.mock.calls.map(([m]) => m)

  // Answers every setup and load the worker was sent, so a worker that joined a run reaches its jscadMain.
  const loadAll = (worker) => {
    for (const message of sent(worker)) {
      if (message.id && ['jscadInit', 'jscadSetFiles', 'jscadScript'].includes(message.method)) {
        worker.onmessage({ data: { method: RESPONSE, id: message.id, params: { def: [], params: {} } } })
      }
    }
  }

  let claims = 0
  const claimOn = (worker, key, { runId = 7, url = `./${key}.scad` } = {}) => {
    const id = `claim-${++claims}`
    worker.onmessage({ data: { method: 'jscadClaim', id, params: [{ key, url, runId }] } })
    return sent(worker).find((m) => m.method === '__CLAIM__' && m.params[0].id === id)?.params[0].won
  }

  const lastOf = (worker, method) => sent(worker).findLast((m) => m.method === method)
  const answerLastOf = (worker, method, params = { entities: [] }) =>
    worker.onmessage({ data: { method: RESPONSE, id: lastOf(worker, method).id, params } })

  // A grid script loaded, the spare set up, and app run 4 (runId 7) in flight on the active worker.
  const gridRun = ({ poolSize = 3, timeoutMs } = {}) => {
    const ctx = setup()
    const { workers, send } = ctx
    init(send, { poolSize, ...(timeoutMs ? { timeoutMs } : {}) }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadSetFiles', id: 2, params: [{ files: { 'ALL.js': 'grid' } }] })
    answer(workers[0], 1)
    send({ method: 'jscadScript', id: 3, params: [{ script: 'grid', url: 'ALL.js', runMain: false }] })
    answer(workers[0], 2, { def: [], params: {} })
    loadAll(workers[1])
    send({ method: 'jscadMain', id: 4, params: [{ params: {}, runId: 7 }] })
    ctx.posted.length = 0
    return ctx
  }

  it('tells each worker it may claim leaves and strips poolSize', () => {
    const { workers, send } = setup()
    init(send, { poolSize: 2 })
    expect(workers[0].postMessage.mock.calls[0][0].params[0]).toMatchObject({ claims: true })
    expect(workers[0].postMessage.mock.calls[0][0].params[0].poolSize).toBeUndefined()
  })

  it('fans a run out on its first claim, reloading each joining worker first', () => {
    const { workers } = gridRun()
    expect(claimOn(workers[0], '0')).toBe(true)
    expect(workers).toHaveLength(4)
    expect(lastOf(workers[1], 'jscadScript')).toMatchObject({ params: [{ script: 'grid', url: 'ALL.js', runMain: false }] })
    loadAll(workers[1])
    expect(lastOf(workers[1], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    loadAll(workers[2])
    expect(lastOf(workers[2], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    expect(lastOf(workers[3], 'jscadMain')).toBeUndefined()
  })

  it('fans out nothing when the pool holds one worker', () => {
    const { workers } = gridRun({ poolSize: 1 })
    expect(claimOn(workers[0], '0')).toBe(true)
    expect(claimOn(workers[0], '1')).toBe(true)
    expect(workers).toHaveLength(2)
    expect(methodsOf(workers[1])).toEqual(['jscadInit', 'jscadSetFiles'])
  })

  it('gives a late joiner only the keys nobody claimed', () => {
    const { workers } = gridRun()
    claimOn(workers[0], '0')
    claimOn(workers[0], '1')
    loadAll(workers[1])
    expect(claimOn(workers[1], '0')).toBe(false)
    expect(claimOn(workers[1], '2')).toBe(true)
    expect(claimOn(workers[0], '2')).toBe(false)
  })

  it('ignores a claim from a worker outside the run', () => {
    const { workers } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[3])
    expect(claimOn(workers[3], '1')).toBe(false)
    expect(claimOn(workers[0], '1')).toBe(true)
  })

  it('answers the app once, after its last member answers', () => {
    const { workers, posted, host } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    answerLastOf(workers[0], 'jscadMain', { entities: [], streamed: true, runId: 7 })
    answerLastOf(workers[1], 'jscadMain')
    expect(posted.filter((m) => m.id === 4)).toEqual([])
    expect(host.getPendingCount()).toBe(1)
    answerLastOf(workers[2], 'jscadMain')
    expect(posted.filter((m) => m.id === 4)).toEqual([
      { method: RESPONSE, id: 4, params: { entities: [], streamed: true, runId: 7, lost: [] } },
    ])
    expect(host.getPendingCount()).toBe(0)
  })

  it('relays cells from every member while the run is open', () => {
    const { workers, posted } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    const cells = { method: 'jscadCells', params: [{ entities: [], runId: 7 }] }
    workers[1].onmessage({ data: cells })
    workers[3].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('replaces a member that traps and leaves the flag out of the answer', () => {
    const { workers, posted } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    expect(claimOn(workers[1], '1')).toBe(true)
    answerLastOf(workers[1], 'jscadMain', { entities: [], trapped: true })
    expect(workers[1].terminate).toHaveBeenCalled()
    loadAll(workers[3])
    expect(lastOf(workers[3], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[2], 'jscadMain')
    answerLastOf(workers[3], 'jscadMain')
    expect(posted.find((m) => m.id === 4).params).toEqual({ entities: [], streamed: true, runId: 7, lost: [] })
  })

  it('reports the leaf a timed-out member was running as lost, and the run goes on', () => {
    const { workers, posted } = gridRun({ timeoutMs: 1000 })
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    loadAll(workers[3])
    claimOn(workers[1], '1', { url: './slow.scad' })
    vi.advanceTimersByTime(600)
    claimOn(workers[0], '2')
    claimOn(workers[2], '3')
    vi.advanceTimersByTime(500)
    expect(workers[1].terminate).toHaveBeenCalled()
    loadAll(workers[3])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[2], 'jscadMain')
    answerLastOf(workers[3], 'jscadMain')
    expect(posted.find((m) => m.id === 4).params.lost).toEqual([{ url: './slow.scad', reason: 'TimeoutError' }])
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toEqual([])
  })

  it('tells the app its worker stopped only when no worker is left to finish the grid', () => {
    const posted = []
    const workers = []
    const host = createFrameHost({
      allowedOrigin: APP,
      bundleBase: BASE,
      parentWindow,
      post: (message) => posted.push(message),
      createWorker: () => {
        if (workers.length) throw new Error('out of memory')
        const worker = { postMessage: vi.fn(), terminate: vi.fn() }
        workers.push(worker)
        return worker
      },
    })
    const send = (data) => host.handleMessage({ origin: APP, source: parentWindow, data })
    init(send, { poolSize: 2, timeoutMs: 1000 }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadMain', id: 2, params: [{ params: {}, runId: 7 }] })
    claimOn(workers[0], '0')
    vi.advanceTimersByTime(1001)
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toHaveLength(1)
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('AbortError')
  })

  it('supersedes a grid run at once, retiring members on an old leaf and draining the rest', () => {
    const { workers, posted, send } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    loadAll(workers[3])
    vi.advanceTimersByTime(400)
    claimOn(workers[1], '1')
    vi.advanceTimersByTime(200)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 }, runId: 8, supersede: true }] })

    expect(posted.find((m) => m.id === 4)).toEqual({ method: RESPONSE, id: 4, error: superseded })
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers[1].terminate).not.toHaveBeenCalled()
    expect(workers[2].terminate).not.toHaveBeenCalled()
    expect(claimOn(workers[1], '2')).toBe(false)
    workers[1].onmessage({ data: { method: 'jscadCells', params: [{ entities: [], runId: 7 }] } })
    expect(posted.filter((m) => m.method === 'jscadCells')).toEqual([])
  })

  it('leaves a grid load alone when a run supersedes it', () => {
    const { workers, posted, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 10, supersede: true }] })
    expect(posted.find((m) => m.id === 5)).toBeUndefined()
    expect(workers[0].terminate).not.toHaveBeenCalled()
  })

  it('sends a load that fans out the load itself', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    expect(lastOf(workers[1], 'jscadScript').params).toEqual([{ script: 'grid2', url: 'ALL.js', runId: 9 }])
  })

  it('reloads the current script on an idle worker that holds an older one', () => {
    const { workers, send } = gridRun({ poolSize: 2 })
    claimOn(workers[0], '0')
    loadAll(workers[1])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[1], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runMain: false }] })
    answerLastOf(workers[0], 'jscadScript', { def: [], params: {} })
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 8 }] })
    claimOn(workers[0], '0', { runId: 8 })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'grid2', runMain: false }] })
  })

  it('merges the params every member discovered into the answer to a load', () => {
    const { workers, posted, send } = gridRun({ poolSize: 2 })
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    const param = (path, value) => ({ path, parent: path.split('.')[0], name: path.split('.')[1], type: 'number', default: value })
    const state = (...discovered) => ({ discovered, types: {}, classes: {} })
    answerLastOf(workers[0], 'jscadScript', { def: [], params: {}, entities: [], streamed: true, runId: 9, proxyState: state(param('a.size', 1)) })
    answerLastOf(workers[1], 'jscadScript', { def: [], params: {}, entities: [], proxyState: state(param('b.size', 2)) })

    const { params } = posted.find((m) => m.id === 5)
    expect(params.proxyState.discovered.map((p) => p.path)).toEqual(['a.size', 'b.size'])
    expect(Object.keys(params.proxyState.tree.children)).toEqual(['a', 'b'])
    expect(params.params).toEqual({ 'a.size': 1, 'b.size': 2 })
    expect(params.def.map((d) => d.name)).toEqual(['_group_a', 'a.size', '_group_b', 'b.size'])
  })
})
```

- [ ] **Step 2: Run the frame tests to see the new ones fail**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js`
Expected: the existing tests PASS, every test in `grid runs` FAILS (no `claims` on init, no `__CLAIM__` answers).

- [ ] **Step 3: Create `src_frame/workerSlot.js`**

```js
/**
 * One worker and the requests it holds, each with its own kill timer.
 *
 * `pending` is keyed by the id the worker sees. Model code shares the worker
 * with the code that answers, so a sequential id would let it answer the next
 * request itself and cancel that request's timer. An entry with `onAnswer` is
 * the frame's own request; its answer never reaches the app.
 * @typedef {{appId?: unknown, method: string, options?: object, onAnswer?: (data: any) => void,
 *   setup?: object, run?: import('./gridRun.js').Run}} Entry
 * @typedef {Entry & {startedAt: number, arm: () => ReturnType<typeof setTimeout>,
 *   timer: ReturnType<typeof setTimeout>}} Pending
 * @typedef {{worker: Worker, pending: Map<string, Pending>, script: object | undefined,
 *   queued: {message: any, entry: Entry | null}[] | null, setupAnswers: WeakMap<object, object>}} Slot
 */

/**
 * @param {object} options
 * @param {() => Worker} options.createWorker
 * @param {() => string} options.randomId
 * @param {() => number} options.timeoutMs
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 * @param {(slot: Slot, data: any) => void} options.onMessage
 * @param {(slot: Slot, expiredId: string | null, reason: string, errorName: string) => void} options.onKill
 * @param {(slot: Slot, errorName: string | null) => void} options.onEnd - the worker is gone
 */
export const createSlots = ({ createWorker, randomId, timeoutMs, answerError, onMessage, onKill, onEnd }) => {
  const start = () => {
    /** @type {Slot} */
    const slot = { worker: createWorker(), pending: new Map(), script: undefined, queued: null, setupAnswers: new WeakMap() }
    const { worker } = slot
    worker.onmessage = (event) => onMessage(slot, event.data)
    // Without these a bundle that fails to load surfaces as "model exceeded
    // N ms" one timeout later, naming the model instead of the load.
    worker.onerror = (event) => {
      event.preventDefault?.()
      onKill(slot, null, event.message ?? 'worker failed to load', 'WorkerError')
    }
    worker.onmessageerror = () => {
      onKill(slot, null, 'worker sent a message that could not be deserialized', 'DataCloneError')
    }
    return slot
  }

  /**
   * @param {Slot} slot
   * @param {Entry} entry
   * @returns {string} the id the worker sees
   */
  const track = (slot, entry) => {
    const workerId = randomId()
    const arm = () => setTimeout(() => {
      onKill(slot, workerId, `model exceeded ${timeoutMs()} ms`, 'TimeoutError')
    }, timeoutMs())
    slot.pending.set(workerId, { ...entry, startedAt: Date.now(), arm, timer: arm() })
    return workerId
  }

  // A cell, a claim or a progress beat shows the model is still advancing, so
  // the budget becomes the longest one step may take.
  const restartTimers = (slot) => {
    for (const request of slot.pending.values()) {
      clearTimeout(request.timer)
      request.timer = request.arm()
    }
  }

  // The worker is gone, so it will never answer: every app request it was
  // holding must reject now, not at the proxy's own 5-minute timeout. A grid
  // run that fanned out answers for itself once its other workers finish.
  const end = (slot, expiredId, reason, errorName) => {
    slot.worker.terminate()
    for (const [workerId, { appId, onAnswer, run, timer }] of slot.pending) {
      clearTimeout(timer)
      if (onAnswer || run?.fanned) continue
      if (workerId === expiredId) answerError(appId, errorName, reason)
      else answerError(appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.pending.clear()
    for (const { entry } of slot.queued ?? []) {
      if (entry && !entry.onAnswer) answerError(entry.appId, 'AbortError', `worker terminated before this request finished: ${reason}`)
    }
    slot.queued = null
    onEnd(slot, errorName)
  }

  return { start, track, restartTimers, end }
}
```

- [ ] **Step 4: Create `src_frame/workerPool.js`**

```js
import { collectBuffers } from './collectBuffers.js'

const RESPONSE = '__RESPONSE__'

export const NEEDS_MODEL = new Set(['jscadMain', 'jscadExportData', 'jscadMeasure', 'jscadCheck'])
export const NEEDS_SOLIDS = new Set(['jscadExportData', 'jscadMeasure', 'jscadCheck'])

const ignore = () => {}

/**
 * The frame's workers: the active one the app's requests go to, the members
 * of grid runs, and one idle worker kept warm. Every worker gets the app's
 * setup; one without the current script loads it before it runs.
 *
 * @typedef {import('./workerSlot.js').Slot} Slot
 * @typedef {import('./workerSlot.js').Entry} Entry
 * @typedef {{slots: Slot[], active: Slot | null, mirrored: object[], lastScript: object | undefined,
 *   lastMain: object | undefined, poolSize: number, timeoutMs: number}} State
 * @param {object} options
 * @param {State} options.state
 * @param {ReturnType<typeof import('./workerSlot.js').createSlots>} options.slotOps
 * @param {(message: unknown, transfer?: Transferable[]) => void} options.post
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 * @param {(slot: Slot) => boolean} options.busy - a member of a grid run
 * @param {(slot: Slot) => boolean} options.inGrid - a member of a run that fanned out
 * @param {(slot: Slot, message: any, entry: Entry) => import('./gridRun.js').Run | null} options.openRun
 */
export const createPool = ({ state, slotOps, post, answerError, busy, inGrid, openRun }) => {
  const idle = (slot) => slot !== state.active && !busy(slot)

  // Sent without a transfer list: a mirrored message is kept for the next worker.
  const request = (slot, message, onAnswer, setup) => {
    slot.worker.postMessage({ ...message, id: slotOps.track(slot, { method: message.method, onAnswer, setup }) })
  }

  const start = ({ replay }) => {
    const slot = slotOps.start()
    state.slots.push(slot)
    if (replay) for (const message of state.mirrored) request(slot, message, ignore, message)
    return slot
  }

  const tryStart = () => {
    try {
      return start({ replay: true })
    } catch {
      return null
    }
  }

  const remove = (slot) => {
    state.slots = state.slots.filter((s) => s !== slot)
  }

  // An idle worker that already holds the current script needs no reload.
  const pickIdle = () => {
    const free = state.slots.filter(idle)
    return free.find((slot) => slot.script === state.lastScript) ?? free[0] ?? null
  }

  // With a run's members that makes poolSize + 1 workers at most.
  const ensureSpare = () => {
    if (state.slots.some(idle) || state.slots.length > state.poolSize) return
    tryStart()
  }

  const mirror = (message) => {
    for (const slot of state.slots) if (slot !== state.active) request(slot, message, ignore, message)
  }

  // Setup the app sent the retired worker went to the promoted one too, so the
  // promoted worker's answer stands in for it.
  const handOver = (from, to) => {
    for (const [workerId, pending] of from.pending) {
      if (pending.onAnswer || !pending.setup) continue
      const copy = [...to.pending.values()].find((r) => r.setup === pending.setup)
      const answer = to.setupAnswers.get(pending.setup)
      if (!copy && !answer) continue
      clearTimeout(pending.timer)
      from.pending.delete(workerId)
      if (copy) Object.assign(copy, { appId: pending.appId, onAnswer: undefined })
      else post({ ...answer, id: pending.appId })
    }
  }

  // For a trapped WebAssembly instance or a superseded run. The app is not
  // told: the promoted worker already holds its setup and reloads the script on demand.
  const retire = (slot, reason) => {
    remove(slot)
    if (slot === state.active) {
      state.active = pickIdle() ?? tryStart()
      if (state.active) handOver(slot, state.active)
    }
    slotOps.end(slot, null, reason, null)
    if (state.active) ensureSpare()
  }

  const kill = (slot, expiredId, reason, errorName) => {
    const inGridRun = inGrid(slot)
    remove(slot)
    slotOps.end(slot, expiredId, reason, errorName)
    if (slot !== state.active) return
    state.active = pickIdle()
    // A grid run goes on without this worker, so the app has nothing to replay
    if (inGridRun) state.active ??= state.slots[0] ?? tryStart()
    else post({ method: 'frameWorkerTerminated', params: [{ reason }] })
    if (state.active) ensureSpare()
  }

  const dispatch = (slot, message, entry) => {
    if (!entry) {
      slot.worker.postMessage(message, collectBuffers(message))
      return
    }
    const run = openRun(slot, message, entry)
    const out = { ...message, id: slotOps.track(slot, run ? { ...entry, run } : entry) }
    slot.worker.postMessage(out, collectBuffers(out))
  }

  // The app does not know about a retire, so a script it sent meanwhile is the
  // model it expects; reloading lastScript would replace it.
  const needsReload = (slot) => !!state.lastScript && slot.script !== state.lastScript &&
    ![...slot.pending.values()].some((r) => r.method === 'jscadScript' && (!r.onAnswer || r.run))

  // Requests that arrive during the reload wait behind it, so they reach the
  // worker in the order they were sent.
  const relay = (slot, message, entry) => {
    if (slot.queued) slot.queued.push({ message, entry })
    else if (NEEDS_MODEL.has(message.method) && needsReload(slot)) ensureLoaded(slot, message, entry)
    else dispatch(slot, message, entry)
  }

  const release = (slot, error) => {
    const [first, ...rest] = slot.queued
    slot.queued = null
    if (!first) return
    if (!error) dispatch(slot, first.message, first.entry)
    else if (first.entry?.onAnswer) first.entry.onAnswer({ method: RESPONSE, error })
    else if (first.entry) answerError(first.entry.appId, error.name, error.message)
    for (const { message, entry } of rest) relay(slot, message, entry)
  }

  // A worker without the model has the setup but not the script. Export,
  // measure and check read the solids of the last run, so those replay it as
  // well; with no run since the load, the load's own main is that run.
  const ensureLoaded = (slot, message, entry) => {
    slot.queued = [{ message, entry }]
    const script = state.lastScript
    const needsSolids = NEEDS_SOLIDS.has(message.method)
    const steps = [{ method: 'jscadScript', params: [{ ...script, runMain: needsSolids && !state.lastMain }] }]
    if (needsSolids && state.lastMain) {
      steps.push({ method: 'jscadMain', params: [{ ...state.lastMain, stream: false }] })
    }
    const next = () => {
      const step = steps.shift()
      if (!step) return release(slot)
      request(slot, step, (data) => {
        if (data.error) return release(slot, data.error)
        if (step.method === 'jscadScript') slot.script = script
        next()
      })
    }
    next()
  }

  return { start, tryStart, pickIdle, ensureSpare, mirror, retire, kill, relay }
}
```

- [ ] **Step 5: Create `src_frame/mergeProxyStates.js`**

```js
import { buildParamTree, extractDefaults, toParamDefinitions } from '@jscadui/params-core'

/**
 * Each worker of a grid run discovers the params of only the leaves it ran,
 * so the run's answer carries their union. A load's answer also carries the
 * definitions and defaults the worker derives from what it discovered.
 * @param {Array<{proxyState?: {discovered?: {path: string}[], types?: object, classes?: object}} | undefined>} results
 * @param {boolean} isLoad
 */
export const mergeProxyStates = (results, isLoad) => {
  const states = results.map((result) => result?.proxyState).filter(Boolean)
  if (!states.length) return {}
  const byPath = new Map()
  for (const { discovered = [] } of states) {
    for (const param of discovered) if (!byPath.has(param.path)) byPath.set(param.path, param)
  }
  const discovered = [...byPath.values()]
  const types = Object.assign({}, ...states.map((state) => state.types))
  const classes = Object.assign({}, ...states.map((state) => state.classes))
  const tree = buildParamTree(discovered, new Map(Object.entries(types)), new Map(Object.entries(classes)))
  const proxyState = { discovered, types, classes, tree }
  return isLoad ? { proxyState, def: toParamDefinitions(discovered), params: extractDefaults(discovered) } : { proxyState }
}
```

- [ ] **Step 6: Create `src_frame/gridRun.js`**

```js
import { mergeProxyStates } from './mergeProxyStates.js'

export const ABANDON_AFTER_MS = 500

const RESPONSE = '__RESPONSE__'

export const trapped = (data) => data.error?.name === 'RuntimeError' || data.params?.trapped === true

// A load that runs main, or a run that streams, may turn out to be a grid.
const streams = ({ method, params }) =>
  (method === 'jscadMain' && params?.[0]?.stream !== false) ||
  (method === 'jscadScript' && params?.[0]?.runMain !== false)

/**
 * @typedef {import('./workerSlot.js').Slot} Slot
 * @typedef {{key: string | null, url: string | null, startedAt: number}} Member
 * @typedef {{appId: unknown, method: string, options: object | undefined,
 *   message: {method: string, params: unknown[]}, runId: unknown, primary: Slot,
 *   members: Map<Slot, Member>, claimed: Set<string>, lost: {url: string | null, reason: string}[],
 *   answers: {data: any, primary: boolean}[], fanned: boolean, closed: boolean, answered: boolean}} Run
 */

/**
 * Every streaming jscadMain or jscadScript is a run. A grid's first claim fans
 * the run out to more workers, which take the leaves nobody has claimed, and
 * the app gets one answer once the last of them finishes. A run nobody claims
 * in is relayed as a single request.
 * @param {object} options
 * @param {import('./workerPool.js').State} options.state
 * @param {ReturnType<typeof import('./workerPool.js').createPool>} options.pool
 * @param {ReturnType<typeof import('./workerSlot.js').createSlots>} options.slotOps
 * @param {(message: unknown) => void} options.post
 * @param {(id: unknown, name: string, message: string) => void} options.answerError
 */
export const createGridRuns = ({ state, pool, slotOps, post, answerError }) => {
  /** @type {Set<Run>} */
  const runs = new Set()

  const runsOf = (slot) => [...runs].filter((run) => run.members.has(slot))
  // A worker can still be draining a superseded run when the next one starts on it.
  const find = (slot, runId) => runsOf(slot).findLast((run) => run.runId === runId)

  /** @returns {Run | null} */
  const open = (slot, message, entry) => {
    if (entry.onAnswer || !streams(message)) return null
    /** @type {Run} */
    const run = {
      appId: entry.appId,
      method: message.method,
      options: entry.options,
      // The app's own message may be transferred; joining workers get this copy
      message: { method: message.method, params: structuredClone(message.params) },
      runId: message.params?.[0]?.runId,
      primary: slot,
      members: new Map([[slot, { key: null, url: null, startedAt: Date.now() }]]),
      claimed: new Set(),
      lost: [],
      answers: [],
      fanned: false,
      closed: false,
      answered: false,
    }
    runs.add(run)
    return run
  }

  const join = (run) => {
    const slot = pool.pickIdle() ?? (state.slots.length <= state.poolSize ? pool.tryStart() : null)
    if (!slot) return false
    run.members.set(slot, { key: null, url: null, startedAt: Date.now() })
    pool.relay(slot, run.message, { method: run.method, run, onAnswer: (data) => answered(run, slot, data) })
    return true
  }

  const fanOut = (run) => {
    run.fanned = true
    while (run.members.size < state.poolSize && join(run)) { /* each join adds a member */ }
    pool.ensureSpare()
  }

  const claim = (slot, { id, params }) => {
    const { key, url, runId } = params?.[0] ?? {}
    const run = find(slot, runId)
    const member = run?.members.get(slot)
    const won = !!member && !run.closed && typeof key === 'string' && !run.claimed.has(key)
    if (won) {
      run.claimed.add(key)
      Object.assign(member, { key, url: typeof url === 'string' ? url : null, startedAt: Date.now() })
    }
    if (member) slotOps.restartTimers(slot)
    slot.worker.postMessage({ method: '__CLAIM__', params: [{ id, won }] })
    if (won && !run.fanned) fanOut(run)
  }

  // Cells carry the runId of the request that made them, which names the run.
  const relaysCells = (slot, data) => {
    const run = find(slot, data.params?.[0]?.runId)
    return !!run && !run.closed
  }

  // The primary's answer comes first: for a load it carries what the params UI is built from.
  const merged = (run) => {
    const answers = [...run.answers].sort((a, b) => Number(b.primary) - Number(a.primary)).map((a) => a.data)
    const failure = answers.find((data) => data.error && data.error.name !== 'RuntimeError')
    const done = answers.filter((data) => !data.error)
    if (failure || !done.length) {
      const error = failure?.error ?? answers.find((data) => data.error)?.error ??
        { name: 'AbortError', message: 'every worker running the grid stopped' }
      return { method: RESPONSE, id: run.appId, error }
    }
    const { trapped: _trapped, ...first } = done[0].params ?? {}
    const params = mergeProxyStates(done.map((data) => data.params), run.method === 'jscadScript')
    return {
      method: RESPONSE,
      id: run.appId,
      params: { ...first, ...params, entities: [], streamed: true, runId: run.runId, lost: run.lost },
    }
  }

  const settle = (run) => {
    if (run.members.size) return
    runs.delete(run)
    if (run.answered) return
    run.answered = true
    const message = merged(run)
    post(message)
    if (!message.error) {
      if (run.method === 'jscadMain') state.lastMain = run.options
      else {
        state.lastScript = run.options
        state.lastMain = undefined
      }
    }
    if (run.method === 'jscadScript' && state.active) pool.ensureSpare()
  }

  const answered = (run, slot, data) => {
    const member = run.members.get(slot)
    if (!member) return
    run.members.delete(slot)
    run.answers.push({ data, primary: slot === run.primary })
    if (!data.error && run.method === 'jscadScript') slot.script = run.options
    if (trapped(data)) {
      pool.retire(slot, 'the model trapped in WebAssembly')
      if (!run.closed && member.key !== null) join(run)
    }
    settle(run)
  }

  // A worker that is gone leaves every run it was in. A run that never fanned
  // out had its app request answered with the worker's own error.
  const leave = (slot, errorName) => {
    for (const run of runsOf(slot)) {
      const member = run.members.get(slot)
      run.members.delete(slot)
      if (!run.fanned) {
        runs.delete(run)
        continue
      }
      if (member.key !== null) {
        run.lost.push({ url: member.url, reason: errorName ?? 'AbortError' })
        if (!run.closed && !join(run) && !run.members.size) {
          post({ method: 'frameWorkerTerminated', params: [{ reason: 'no worker is left to finish the grid' }] })
        }
      }
      settle(run)
    }
  }

  // A newer run replaces a grid run at once. A worker on a leaf it started
  // ABANDON_AFTER_MS ago is retired; the rest finish their leaf, find every
  // later claim refused, and go idle.
  const supersede = (method) => {
    for (const run of [...runs]) {
      if (!run.fanned || run.answered) continue
      if (method === 'jscadMain' && run.method === 'jscadScript') continue
      run.answered = true
      run.closed = true
      answerError(run.appId, 'SupersededError', 'superseded by a newer run')
      const now = Date.now()
      for (const [slot, member] of [...run.members]) {
        if (member.key !== null && now - member.startedAt >= ABANDON_AFTER_MS) pool.retire(slot, 'a newer run superseded the model')
      }
      settle(run)
    }
  }

  return {
    open,
    claim,
    relaysCells,
    answered,
    leave,
    supersede,
    close: (run) => runs.delete(run),
    busy: (slot) => runsOf(slot).length > 0,
    inGrid: (slot) => runsOf(slot).some((run) => run.fanned),
    loadsGrid: () => [...runs].some((run) => run.fanned && !run.answered && run.method === 'jscadScript'),
    pendingCount: () => [...runs].filter((run) => run.fanned && !run.answered).length,
  }
}
```

- [ ] **Step 7: Rewrite `src_frame/frameHost.js`**

```js
import { collectBuffers } from './collectBuffers.js'
import { ABANDON_AFTER_MS, createGridRuns, trapped } from './gridRun.js'
import { createPool, NEEDS_SOLIDS } from './workerPool.js'
import { createSlots } from './workerSlot.js'

export { ABANDON_AFTER_MS } from './gridRun.js'
export const DEFAULT_TIMEOUT_MS = 30000

const RESPONSE = '__RESPONSE__'

// workerBundles: unchanged, copied verbatim from the current file.

// Each worker holds its own bundles, WASM instances and file map, which bounds the pool.
export const defaultPoolSize = (hardwareConcurrency = 2) => Math.max(1, Math.min(hardwareConcurrency - 1, 4))

/**
 * The frame's side of the relayed protocol: a pool of workers, a timeout per
 * in-flight request, grid runs spread across the pool, and jscadInit
 * rewritten so bundle URLs come from here rather than from the sender.
 *
 * @param {object} options
 * @param {string} options.allowedOrigin the app origin; the only sender answered
 * @param {string} options.bundleBase absolute base the frame's own bundles live under
 * @param {() => Worker} options.createWorker
 * @param {(message: unknown, transfer?: Transferable[]) => void} options.post sends to the app
 * @param {Window} options.parentWindow the only window whose messages are accepted
 * @param {() => string} [options.randomId]
 * @param {number} [options.hardwareConcurrency]
 */
export const createFrameHost = ({
  allowedOrigin,
  bundleBase,
  createWorker,
  post,
  parentWindow,
  randomId = () => crypto.randomUUID(),
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
}) => {
  // Latched: a jscadInit that omits `engine` keeps the last one. The alias
  // path (onAliasFound) re-inits without naming an engine and must not switch
  // the model bundles out from under a loaded project.
  let engine
  /** @type {import('./workerPool.js').State} */
  const state = {
    slots: [],
    active: null,
    // What a new worker is set up with, in the order the app sent it.
    mirrored: [],
    lastScript: undefined,
    lastMain: undefined,
    poolSize: defaultPoolSize(hardwareConcurrency),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  const answerError = (id, name, message) =>
    post({ method: RESPONSE, id, error: { name, message } })

  const slotOps = createSlots({
    createWorker,
    randomId,
    timeoutMs: () => state.timeoutMs,
    answerError,
    onMessage: (slot, data) => receive(slot, data),
    onKill: (slot, expiredId, reason, errorName) => pool.kill(slot, expiredId, reason, errorName),
    onEnd: (slot, errorName) => runs.leave(slot, errorName),
  })
  const pool = createPool({
    state,
    slotOps,
    post,
    answerError,
    busy: (slot) => runs.busy(slot),
    inGrid: (slot) => runs.inGrid(slot),
    openRun: (slot, message, entry) => runs.open(slot, message, entry),
  })
  const runs = createGridRuns({ state, pool, slotOps, post, answerError })

  // Only the solids re-run of export, measure and check posts progress; relaying
  // it elsewhere would let model code keep any request alive.
  const exporting = (slot) => [...slot.pending.values()].some((r) => !r.onAnswer && NEEDS_SOLIDS.has(r.method))

  const relayOut = (slot, data) => {
    slotOps.restartTimers(slot)
    const message = { method: data.method, params: data.params }
    post(message, collectBuffers(message))
  }

  // The worker sends answers, claims, and streamed cells and progress, so
  // anything else it posts, and any answer to a request the frame did not
  // issue, is model code talking.
  const receive = (slot, data) => {
    if (data?.method === 'jscadClaim' && data.id != null) return runs.claim(slot, data)
    if (data?.id == null && data?.method === 'jscadCells' && runs.relaysCells(slot, data)) return relayOut(slot, data)
    if (data?.id == null && data?.method === 'jscadProgress' && slot === state.active && exporting(slot)) return relayOut(slot, data)
    if (data?.method !== RESPONSE) return
    const request = slot.pending.get(data.id)
    if (!request) return
    clearTimeout(request.timer)
    slot.pending.delete(data.id)
    if (request.setup) slot.setupAnswers.set(request.setup, data)
    if (request.onAnswer) return request.onAnswer(data)
    if (request.run?.fanned) return runs.answered(request.run, slot, data)
    if (request.run) runs.close(request.run)
    const message = { ...data, id: request.appId }
    post(message, collectBuffers(message))
    answered(slot, request, data)
    // A frame request that traps still answers the one it was made for; the
    // next app run that traps retires the worker.
    if (slot === state.active && trapped(data)) pool.retire(slot, 'the model trapped in WebAssembly')
  }

  const answered = (slot, { method, options }, data) => {
    if (method === 'jscadMain' && !data.error) state.lastMain = options
    if (method !== 'jscadScript') return
    if (!data.error) {
      state.lastScript = options
      state.lastMain = undefined
      slot.script = options
    }
    pool.ensureSpare()
  }

  const RECORDED = new Set(['jscadScript', 'jscadMain'])

  // A run never abandons a load: the promoted worker would reload the previous
  // script and run the new parameters against it.
  const abandonStale = (method) => {
    const slot = state.active
    const appRequests = [...slot.pending].filter(([, r]) => !r.onAnswer && !r.run?.fanned)
    if (method === 'jscadMain' && (appRequests.some(([, r]) => r.method === 'jscadScript') || runs.loadsGrid())) return
    const stale = appRequests.filter(([, r]) => RECORDED.has(r.method))
    const now = Date.now()
    if (!stale.some(([, r]) => now - r.startedAt >= ABANDON_AFTER_MS)) return
    // A younger run queued behind the stale one is replaced too.
    for (const [workerId, { appId, timer }] of stale) {
      clearTimeout(timer)
      slot.pending.delete(workerId)
      answerError(appId, 'SupersededError', 'superseded by a newer run')
    }
    pool.retire(slot, 'a newer run superseded the model')
  }

  // Runs waiting behind a reload have not started, so a newer run replaces
  // them without a retire. A queued script stays, as a pending one does, and so
  // does a run an export, measure or check queued after it will read.
  const supersedeQueued = () => {
    const slot = state.active
    if (!slot.queued) return
    const lastRead = slot.queued.findLastIndex(({ message }) => NEEDS_SOLIDS.has(message.method))
    slot.queued = slot.queued.filter(({ message, entry }, i) => {
      if (message.method !== 'jscadMain' || i < lastRead || entry?.onAnswer) return true
      if (entry) answerError(entry.appId, 'SupersededError', 'superseded by a newer run')
      return false
    })
  }

  // takeSupersede: unchanged, copied verbatim from the current file.

  const MIRRORED = new Set(['jscadInit', 'jscadSetFiles', 'jscadClearTempCache', 'jscadClearFileCache'])

  const setupOf = new WeakMap()

  // A file map replaces the one before it, and the cache clears before it
  // cleared state that map already replaced.
  const mirror = (message) => {
    const { id: _id, ...setup } = message
    const kept = structuredClone(setup)
    if (kept.method === 'jscadSetFiles') state.mirrored = state.mirrored.filter((m) => m.method === 'jscadInit')
    state.mirrored.push(kept)
    setupOf.set(message, kept)
    pool.mirror(kept)
  }

  const entryFor = (message) => message.id
    ? {
      appId: message.id,
      method: message.method,
      options: RECORDED.has(message.method) ? structuredClone(message.params?.[0]) : undefined,
      setup: setupOf.get(message),
    }
    : null

  // The one method that is not relayed untouched. A script source inside the
  // frame must come from the frame's own origin, so the app names an engine
  // and the frame names the bundles.
  const frameInit = (data, options, rest) => {
    const { engine: wanted, timeoutMs: wantedTimeout, poolSize: wantedPool, ...init } = options
    if (wanted) engine = wanted
    if (wantedTimeout) state.timeoutMs = wantedTimeout
    if (Number.isInteger(wantedPool) && wantedPool > 0) state.poolSize = wantedPool
    // The worker's own origin is opaque, so it gets the app origin here; it is
    // the only base for include urls that arrive as bare pathnames.
    const params = { ...init, claims: true, bundles: workerBundles(bundleBase, engine), appOrigin: allowedOrigin }
    return { ...data, params: [params, ...rest] }
  }

  const handleMessage = (event) => {
    if (event.origin !== allowedOrigin) return
    // Same origin is not the same window: another tab or frame on the app
    // origin could otherwise drive this worker.
    if (parentWindow && event.source !== parentWindow) return

    const data = event.data
    const id = data?.id
    let message = data
    if (data?.method === 'jscadInit') {
      const [options = {}, ...rest] = data.params ?? []
      // Rejecting now matters more than the message: otherwise the rewrite
      // throws here and the request burns the whole timeout unanswered.
      if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        if (id) answerError(id, 'TypeError', 'jscadInit expects an options object')
        return
      }
      message = frameInit(data, options, rest)
    }
    const [relayed, supersede] = takeSupersede(message)
    message = relayed
    if (supersede && RECORDED.has(message.method)) {
      runs.supersede(message.method)
      if (state.active) {
        supersedeQueued()
        abandonStale(message.method)
      }
    }

    if (!state.active) {
      try {
        state.active = pool.start({ replay: false })
      } catch (error) {
        if (id) answerError(id, 'Error', `could not start the model worker: ${error?.message ?? error}`)
        return
      }
    }
    if (MIRRORED.has(data?.method)) mirror(message)
    pool.relay(state.active, message, entryFor(message))
  }

  const getPendingCount = () => {
    const slot = state.active
    const relayed = slot ? [...slot.pending.values()].filter((r) => !r.onAnswer && !r.run?.fanned).length : 0
    const queued = (slot?.queued ?? []).filter(({ entry }) => entry && !entry.onAnswer).length
    return relayed + queued + runs.pendingCount()
  }

  return { handleMessage, getPendingCount }
}
```

Copy `workerBundles` and `takeSupersede` from the current `frameHost.js` unchanged. `takeSupersede` stays a closure inside `createFrameHost`, as now.

- [ ] **Step 8: Run the frame tests**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js`
Expected: PASS, the existing tests and the `grid runs` block. If an existing test fails, the pass-through path for a run with no claim differs from the old relay: fix the code, not the test.

- [ ] **Step 9: Run the whole app unit suite, lint and typecheck**

Run: `cd apps/jscad-web && npx vitest run`
Run: `npx eslint --max-warnings=0 apps/jscad-web/src_frame apps/jscad-web/test/frame-host.test.js` (from the repo root)
Run: `npm run typecheck` (from the repo root)
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/jscad-web/src_frame apps/jscad-web/test/frame-host.test.js
git commit -m "feat(frame): spread a grid run's leaves over a pool of workers"
```

---

### Task 4: App side and sweep tooling

**Files:**
- Modify: `apps/jscad-web/src/streamRuns.js` (`finish`)
- Modify: `apps/jscad-web/test/stream-runs.test.js`
- Modify: `apps/jscad-web/main.js:159-170` (`handleEntities`) and `:265-283` (`initFrame`)
- Modify: `apps/jscad-web/e2e/render-all.mjs`
- Modify: `ci/render-grids`
- Create: `ci/render-grids-serial`

**Model:** `sonnet` — several small edits across files, code given.

**Interfaces:**
- Consumes: a streamed result's `lost: {url, reason}[]` (Task 3); `jscadInit`'s `poolSize` (Task 3).
- Produces: `streamRuns.finish(runId, lost?)` returns `{ cells, vertices, triangles, lost: number }` and calls `onError` when `lost` is non-empty. `render-all.mjs --pool-size <n>`; each result gains `cells` and `ms`.

- [ ] **Step 1: Write the failing streamRuns tests**

Append inside `describe('stream runs', ...)` in `apps/jscad-web/test/stream-runs.test.js`:

```js
  it('reports leaves that ran out of time as an error, keeping the cells already drawn', () => {
    const { runs, draw, onError } = setup()
    runs.begin(() => false, 1)
    runs.accept([cell(1)], 1)
    const totals = runs.finish(1, [{ url: './slow.scad', reason: 'TimeoutError' }, { url: './slower.scad', reason: 'TimeoutError' }])
    expect(draw).toHaveBeenCalledTimes(1)
    expect(totals).toMatchObject({ cells: 1, lost: 2 })
    const [error] = onError.mock.calls[0]
    expect(error.name).toBe('TimeoutError')
    expect(error.message).toMatch(/\.\/slow\.scad \.\/slower\.scad/)
  })

  it('reports nothing for a run that lost no leaf', () => {
    const { runs, onError } = setup()
    runs.begin(() => false, 1)
    runs.accept([cell(1)], 1)
    expect(runs.finish(1, []).lost).toBe(0)
    expect(onError).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/jscad-web && npx vitest run test/stream-runs.test.js`
Expected: FAIL, `lost` is undefined and `onError` was not called.

- [ ] **Step 3: Implement**

In `apps/jscad-web/src/streamRuns.js`, add above `createStreamRuns`:

```js
const lostError = (lost) => {
  const error = new Error(`${lost.length} grid model(s) ran out of time: ${lost.map((leaf) => leaf?.url).join(' ')}`)
  error.name = 'TimeoutError'
  return error
}
```

Replace `finish`:

```js
    // A leaf that timed out on its worker leaves its cell empty; the rest stay drawn.
    finish(runId, lost = []) {
      if (!owns(runId)) return null
      if (run.isStale()) {
        drop()
        return null
      }
      flush(true)
      const { cells, vertices, triangles } = run
      run = null
      const missing = Array.isArray(lost) ? lost : []
      if (missing.length) onError(lostError(missing))
      return { cells, vertices, triangles, lost: missing.length }
    },
```

In `apps/jscad-web/main.js` `handleEntities`, the streamed branch becomes:

```js
  if (result?.streamed) {
    // null for another run's result, or one a cap error already ended
    const totals = streamRuns.finish(result.runId, result.lost)
    if (!totals) return
    meshRefs.remember(streamDrawn)
    onProgress(undefined)
    document.documentElement.dataset.vertices = String(totals.vertices)
    if (!totals.lost) setError(undefined)
    updatePipelineStats(statsContent, { treeTime: result.treeTime, triangles: totals.triangles, vertices: totals.vertices })
    if (!skipLog) console.log('streamed', totals.cells, 'cells, tree:', result.treeTime?.toFixed(2))
    return
  }
```

After the `EDITOR_TIMEOUT_MS` block in `main.js`, add:

```js
// The render sweep pins the frame's worker count to compare a pooled grid with one worker.
const POOL_SIZE = (() => {
  try {
    const stored = Number(localStorage.getItem('engine.poolSize'))
    return Number.isInteger(stored) && stored > 0 ? stored : undefined
  } catch {
    return undefined
  }
})()
```

and `initFrame` sends it:

```js
const initFrame = () =>
  workerApi
    .jscadInit({ engine: viewState.modelingEngine, useParamsProxy, timeoutMs: EDITOR_TIMEOUT_MS, poolSize: POOL_SIZE })
    .catch(setError)
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/jscad-web && npx vitest run test/stream-runs.test.js`
Expected: PASS.

- [ ] **Step 5: Sweep flag, cells and time**

In `apps/jscad-web/e2e/render-all.mjs`:

- Usage block: add `--pool-size <n>   Frame workers per page (sets engine.poolSize). Default: the app's own.`
- `parseArgs`: add `poolSize: 0` to the defaults and `else if (a === '--pool-size') o.poolSize = Number(argv[++i])`.
- In `worker(end)`, after the `modelTimeoutMs` init script:

```js
    if (opts.poolSize) await context.addInitScript(n => {
      try { localStorage.setItem('engine.poolSize', String(n)) } catch { /* the app falls back to its default */ }
    }, opts.poolSize)
```

- In `renderOne`: declare `let cells = null` next to `status`, set `const started = Date.now()` before `page.goto`, and after the `status = await Promise.race(...)` line read the count before the page closes:

```js
    cells = await page.evaluate(() => document.documentElement.dataset.cells ?? null).catch(() => null)
```

  Return `cells` and `ms: Date.now() - started` in the result object.
- In the report, after the summary by library, when `opts.grids`:

```js
  if (opts.grids) {
    console.log('\n── Grid cells and times ──')
    for (const r of results) console.log(`  ${r.rel.padEnd(70)} cells=${r.cells ?? '-'}  ${(r.ms / 1000).toFixed(1)}s`)
  }
```

- [ ] **Step 6: CI scripts**

`ci/render-grids`: append `--pool-size 4` to `RENDER_ARGS`, and add one line to its header comment: the pool size is pinned so the sweep does not depend on the CI host's core count; `ci/render-grids-serial` runs the same sweep on one worker.

`ci/render-grids-serial` (mode 755):

```bash
#!/usr/bin/env bash
# The grid sweep with one frame worker per page, for comparing with
# ci/render-grids (four): each grid should draw the same number of cells, and
# the times show what the pool buys.
#
#   sci push jscadui/render-grids-serial
set -uo pipefail

export JSCAD_WEB_PORT=5150
export RENDER_ARGS="--dir . --grids --concurrency 4 --timeout 320000 --pool-size 1 --out e2e/render-grids-serial-report.json --baseline e2e/render-grids-baseline.json"
exec "$(dirname "$0")/render"
```

Add `apps/jscad-web/e2e/render-grids-serial-report.json` to `.gitignore` next to the other report files if they are ignored there; check with `git check-ignore -v apps/jscad-web/e2e/render-grids-report.json` first and follow what it shows.

- [ ] **Step 7: Run the app unit suite and lint**

Run: `cd apps/jscad-web && npx vitest run`
Run: `npx eslint --max-warnings=0 apps/jscad-web/main.js apps/jscad-web/src/streamRuns.js apps/jscad-web/e2e/render-all.mjs apps/jscad-web/test/stream-runs.test.js` (repo root)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/jscad-web/src/streamRuns.js apps/jscad-web/test/stream-runs.test.js apps/jscad-web/main.js apps/jscad-web/e2e/render-all.mjs ci/render-grids ci/render-grids-serial .gitignore
git commit -m "feat(app): show a pooled grid's timed-out leaves and pin the sweep's pool size"
```

---

### Task 5: Docs

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md` (Protocol section spare paragraphs, "Streamed runs")
- Modify: `docs/WORKER_PROTOCOL.md`
- Modify: `docs/backlog.md`
- Modify: `apps/jscad-web/e2e/RENDER-TESTING.md`

**Model:** `sonnet` — prose from the facts below, in the house style (plain words, no filler, no em dashes, no marketing).

- [ ] **Step 1: architecture.md**

Replace the paragraphs from "After the first `jscadScript` answer the frame starts a second worker, the spare." through "A spare exists so that ... a cold start: bundles, WASM and the replay." with a description of the pool. Facts to carry:

- The frame keeps a list of workers: the active one the app's requests go to, members of grid runs, and one idle worker kept warm, `poolSize + 1` at most. `poolSize` defaults to `max(1, min(hardwareConcurrency - 1, 4))`; `jscadInit`'s `poolSize` overrides it and the frame strips it. The app sends it from the `engine.poolSize` localStorage key when set. Each worker holds its own bundles, WASM instances and file map, which is what bounds the pool.
- Every worker gets the mirrored setup (unchanged rules: rewritten `jscadInit`, `jscadSetFiles`, cache clears; a new file map drops earlier map and clears; buffers copied). Each worker records the script it loaded, compared by identity with the last script the app loaded; one without it reloads it with `runMain: false` before `jscadMain`, export, measure or check (the solids replay rules are unchanged).
- Kill, trap retirement and promotion keep their rules; promotion prefers an idle worker that already holds the current script. Keep the cost paragraph (memory per worker, the file map held once per worker plus the frame's copy, a promotion costs a script load and re-transpiles includes).
- Keep the reason a warm worker exists.

Replace the "Only the outermost grid streams." paragraph in "Streamed runs" with:

- Generated `ALL.js` files are an item list plus `gridModule(items, { spacing, cellSize }, require)` from `examples/lib/grid-utils.js`, which holds the loop, name deduplication, failure markers and trap handling. `main` takes `__jscadStream` and hides it from leaf code while it walks.
- A sub-grid runs its own leaves under a world transform: `ctx · translate(x, y) · scale(s)`, `s = cellSize / max(width, depth)`, where width and depth follow from the sub-grid's item count (`gridExtent`). So every leaf streams on its own and the per-cell budget applies to leaves, not to whole sub-grids. A sub-grid whose leaves are all small or flat is placed slightly differently than when it was one normalized cell. Failure markers take the same transform.
- Claims: with `claims: true` from `jscadInit` (the frame always sets it) the stream hook has `claim(key, url)`. A leaf's key is its index path (`"2/14"`); item lists are static, so every worker computes the same keys. The grid claims each leaf and skips a lost one without requiring it; sub-grids are walked regardless. A `stream: false` run (export's re-run, animation frames, agent evaluation) has no hook and runs every leaf.
- Runs: every streaming `jscadMain` or `jscadScript` is a run. Its first won claim fans it out: the same request to up to `poolSize - 1` more workers, which join late and take what is left. Cells from any member are relayed while the run is open. The app gets one answer when the last member answers: the primary's answer with `entities: []`, `streamed: true`, `runId`, `lost`, and the params every member discovered merged (`src_frame/mergeProxyStates.js`), since each worker discovers only the leaves it ran. A run nobody claims in behaves as a single request.
- Losing a member: a trap or a timeout stops only that member; the frame retires it and adds a replacement while the run is open and the member was on a leaf. A timed-out member's leaf goes into `lost`, which `streamRuns.js` reports as an error while keeping the drawn cells. `frameWorkerTerminated` is sent only when no member remains and none can start.
- Supersede: a superseding request answers a fanned-out run `SupersededError` at once, closes it to claims and stops relaying its cells. A member on a leaf it started at least `ABANDON_AFTER_MS` ago is retired; the rest finish their leaf, find later claims refused, and go idle. A superseding `jscadMain` leaves a grid load alone.
- Code: `src_frame/workerSlot.js` (start, request tracking, timers, end), `workerPool.js` (worker list, idle workers, promotion, setup replay, reload), `gridRun.js` (fan-out, claims, lost leaves, finishing a run), `frameHost.js` (message routing, `jscadInit` rewrite, supersede entry points).

Also: in the Protocol section, "The worker sends two, a grid's `jscadCells` and `jscadProgress`" becomes three notifications including `jscadClaim`, which the frame answers itself and never relays. Remove "The cost is that a nested sub-grid must fit one per-cell budget."

- [ ] **Step 2: WORKER_PROTOCOL.md**

- `InitOptions`: add `claims?: boolean` (the host answers `jscadClaim`; set by the frame) and, for the frame, `poolSize?: number` (read and stripped by the frame).
- New `### jscadClaim` section: the worker posts `{ method: 'jscadClaim', id, params: [{ key, url, runId }] }`; the host answers with the notification `{ method: '__CLAIM__', params: [{ id, won }] }`, the id inside params because a message with a top-level id is a request the worker would answer. Only a worker whose `jscadInit` had `claims: true` claims. The frame answers `won: false` to a worker outside the run and to any claim after the run closed.
- `JscadMainResult`: add `lost?: { url: string, reason: string }[]` for a run that fanned out.
- Rewrite "only the outermost grid emits" to: every grid level emits its own leaves through the hook; a nested grid does not arrive as one cell.
- The supersede section gains the fanned-out run rule from Step 1.

- [ ] **Step 3: backlog.md and RENDER-TESTING.md**

`docs/backlog.md`, under "Combined ALL.js grids", add an item: `part()` boundaries for JSCAD and SCAD parts, so one model's parts spread across the frame's workers the way grid leaves do, using the same claim mechanism (`jscadClaim`, keys, fan-out on the first claim).

`apps/jscad-web/e2e/RENDER-TESTING.md`: document `--pool-size`, the `cells` and `ms` fields, the "Grid cells and times" listing, and `ci/render-grids-serial`.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/docs/architecture.md docs/WORKER_PROTOCOL.md docs/backlog.md apps/jscad-web/e2e/RENDER-TESTING.md
git commit -m "docs: the frame's worker pool and claimed grid leaves"
```

---

### Task 6: End-to-end on the GPU (controller, inline)

- [ ] **Step 1:** From the repo root, `../simple-ci/sci push jscadui/render-grids`. Read the job id from its output. Wait with `../simple-ci/sci wait <JOB>` under Bash `run_in_background`.
- [ ] **Step 2:** When it finishes, `../simple-ci/sci push jscadui/render-grids-serial` and wait the same way. Run them one after the other so the timings do not share the host.
- [ ] **Step 3:** Compare the two logs' "Grid cells and times" listings: every grid must draw the same `cells`. Both must match `render-grids-baseline.json` (exit 0). Record the NopSCADlib tests grid (`openscad/nopscadlib/NopSCADlib/tests/ALL.js`) time under both.
- [ ] **Step 4:** If a sweep regresses, debug with superpowers:systematic-debugging before changing code; fixes go test-first.

### Task 7: Fold and remove the working documents

- [ ] **Step 1:** Confirm every design decision in the spec is in `architecture.md` or `WORKER_PROTOCOL.md`, and record the timing result from Task 6 in `docs/backlog.md` under the deploy or grids notes.
- [ ] **Step 2:** `git rm docs/superpowers/specs/2026-09-24-grid-worker-pool-design.md docs/superpowers/plans/2026-09-24-grid-worker-pool.md` and commit `docs: fold the grid worker pool spec into the docs and drop it`.
