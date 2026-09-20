# Backlog Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all four code items in docs/backlog.md so each can be deleted in its landing commit.

**Architecture:** Four independent single-scope fixes, no shared state. Each task has its own failing test first, minimal fix, verify. Dispatch one implementer per task in parallel.

**Tech Stack:** ES2022, vitest, manifold-3d WASM, esbuild-based jscad-web build, require CacheManager TypeScript.

## Global Constraints

- Targets modern browsers only, ES2022+ without polyfills.
- TDD required: failing test first, watch it fail, minimal fix, watch it pass.
- One change per task, no bundled refactoring.
- Delete the corresponding backlog section in the commit that completes it.
- Run the affected package tests before claiming complete.

---

### Task 1: Shared WASM handle between clone and colorize

**Files:**
- Modify: `packages/manifold/src/geometries/ManifoldGeom3.js:344-348`
- Modify: `packages/manifold/src/booleans/index.js:54-56,186-188` (single-element wrap paths)
- Test: `packages/manifold/test/clone-ownership.test.js` (new)

**Interfaces:**
- Consumes: `Manifold.translate([0,0,0])` returns independent WASM handle; `disposalRegistry` in ManifoldGeom3.js.
- Produces: `ManifoldGeom3.clone()` returns independently-owned wrapper; `dispose()` on either copy leaves the other usable.

**Root cause:** `clone()` does `new ManifoldGeom3(this.#manifold)`, sharing one WASM handle between two wrappers. Each constructor call registers the same handle with `disposalRegistry`, so GC of either wrapper deletes the handle the other still uses. Same aliasing exists in `union`/`intersect` single-element fast paths via `new ManifoldGeom3(nonEmpty[0])`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeAll } from 'vitest'
import { init, cube, measureVolume } from '../src/index.js'
import { colorize } from '../src/colors/index.js'

describe('clone ownership', () => {
  beforeAll(async () => { await init() })
  it('dispose of clone leaves original usable', () => {
    const c = cube({ size: 10 })
    const volBefore = measureVolume(c)
    const copy = c.clone()
    copy.dispose()
    expect(measureVolume(c)).toBeCloseTo(volBefore, 1)
  })
  it('dispose of colorize source leaves colored usable', () => {
    const c = cube({ size: 10 })
    const colored = colorize([1, 0, 0], c)
    c.dispose()
    expect(measureVolume(colored)).toBeCloseTo(1000, 0)
  })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/clone-ownership.test.js` in `packages/manifold`
Expected: FAIL (second dispose or use-after-delete throws `Cannot pass deleted object` or volume mismatch).

- [ ] **Step 3: Write minimal implementation**

In `ManifoldGeom3.js`, add independent-copy helper and use it in `clone()`:

```js
clone() {
  const copied = this.#manifold.translate([0, 0, 0])
  const cloned = new ManifoldGeom3(copied)
  cloned.#color = this.#color
  return cloned
}
```

Apply the same copy (not shared handle) to the single-element fast paths in `packages/manifold/src/booleans/index.js` (`union` line ~56, `intersect` line ~187): wrap `nonEmpty[0].translate([0,0,0])` instead of `nonEmpty[0]` when the source handle is owned by an input wrapper. If the input was a raw Manifold (not a wrapper), ownership transfer is safe and no copy is needed; simplest correct rule: always copy in those two lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/clone-ownership.test.js test/basic.test.js` in `packages/manifold`
Expected: PASS, no other tests broken.

- [ ] **Step 5: Commit**

```bash
git add packages/manifold/src/geometries/ManifoldGeom3.js packages/manifold/src/booleans/index.js packages/manifold/test/clone-ownership.test.js docs/backlog.md
git commit -m "fix(manifold): independent WASM handle on clone and single-element wrap"
```

Note: delete the `## Shared WASM handle between clone and colorize` section from `docs/backlog.md` in this commit.

---

### Task 2: Stale build output accumulates in build/

**Files:**
- Modify: `apps/jscad-web/build.js:62-73`
- Test: manual script check (no test framework for build.js; verify by listing `build/build/` before/after)

**Interfaces:**
- Consumes: `outDir` (`build` or `build_dev`), `hashAssets(outDir)` in `apps/jscad-web/src_build/hashAssets.js`.
- Produces: single `main.*.js`, no doubled hashes like `bundle.jscad_io.315b95f2.315b95f2.js`.

**Root cause:** `build.js` only removes `build/examples`, then writes bundles plus content-hashed output on top of whatever is there. `hashAssets` renames `bundle.x.js` to `bundle.x.<hash>.js` but never deletes prior hashed files, so repeated builds stack `main.*.js` files and double-hashed names.

- [ ] **Step 1: Write the failing check**

```bash
# from apps/jscad-web
ls build/build/main.*.js | wc -l
node build.js --skipDocs
ls build/build/main.*.js | wc -l
# FAILS if count grows or doubled-hash files exist:
ls build/build/ | grep -E '\.[0-9a-f]{8}\.[0-9a-f]{8}\.js' || echo "no doubled hashes"
```

- [ ] **Step 2: Run check to verify it fails**

Run the listing before/after two builds.
Expected: FAIL — two `main.*.js` files or doubled hashes present.

- [ ] **Step 3: Write minimal implementation**

At `apps/jscad-web/build.js` after `mkdirSync(outDir)`, clean only generated output, preserving nothing stale:

```js
// Clean generated output so repeated builds do not stack hashed files.
if (existsSync(outDir + '/build')) {
  rmSync(outDir + '/build', { recursive: true, force: true })
}
mkdirSync(outDir + '/build', { recursive: true })
```

Keep the existing `build/examples` clean as-is. Do NOT delete the whole `outDir` in dev watch mode blindly; scope to `outDir + '/build'` plus hashed `main.*`/`main.*.css` at top level if needed. Minimal correct: remove `outDir/build` before writing bundles. If hashed top-level `main.<hash>.js` also stacks, remove `main.*.js`/`main.*.css` hashed variants (keep unhashed sources written by build) before `hashAssets`.

- [ ] **Step 4: Run check to verify it passes**

Run: two consecutive `node build.js --skipDocs`, then `ls build/build/ | grep -cE '^main\.'` must be 1 and no doubled-hash names.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/build.js docs/backlog.md
git commit -m "fix(jscad-web): clean build output before writing bundles"
```

Note: delete the `## Stale build output accumulates in build/` section from `docs/backlog.md` in this commit.

---

### Task 3: Orphaned alias object after a cache clear

**Files:**
- Modify: `packages/require/src/caching/cacheManager.ts:321-345`
- Test: `packages/require/test/cacheManager.test.js` (extend) or new `packages/require/test/alias-clear.test.js`

**Interfaces:**
- Consumes: `cacheManager.clearTempCache()`, `clearAllCaches()`, `getLegacyCacheObjects()`.
- Produces: writes to `requireCache.alias[name]` after a clear are visible to `cacheManager` resolution.

**Root cause:** `clearTempCache`/`clearAllCaches` reassign `this.localCache` and `this.aliases` to new objects. `requireCache` in `require.js:319` is a one-time snapshot `{ local: this.localCache, alias: this.aliases }`. `packages/worker/worker.js:182` writes to the old object, which `cacheManager` no longer reads.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { requireCache, jscadClearTempCache, clearAllCaches } from '../src/require.js'
import { cacheManager } from '../src/caching/cacheManager.js'

describe('alias survives clear', () => {
  it('writes via requireCache.alias after clearTempCache are visible', () => {
    jscadClearTempCache()
    requireCache.alias['@test/foo'] = '/foo.js'
    expect(cacheManager.getAlias('@test/foo')).toBe('/foo.js')
  })
  it('writes via requireCache.alias after clearAllCaches are visible', () => {
    clearAllCaches()
    requireCache.alias['@test/bar'] = '/bar.js'
    expect(cacheManager.getAlias('@test/bar')).toBe('/bar.js')
  })
})
```

Check actual method names in `cacheManager.ts:270-281` (`getAlias`/`setAlias` or equivalent) and adjust. If no getter exists, assert via `cacheManager.getLegacyCacheObjects().alias`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/alias-clear.test.js` in `packages/require`
Expected: FAIL (getter returns undefined after clear).

- [ ] **Step 3: Write minimal implementation**

Clear in place to preserve object identity (do NOT reassign):

```ts
clearTempCache(): void {
  for (const k of Object.keys(this.localCache)) delete this.localCache[k]
  for (const k of Object.keys(this.aliases)) delete this.aliases[k]
  this.loading.clear()
  // ... rest unchanged
}
clearAllCaches(): void {
  for (const k of Object.keys(this.localCache)) delete this.localCache[k]
  for (const k of Object.keys(this.aliases)) delete this.aliases[k]
  this.moduleCache.clear()
  this.dependencies.clear()
  this.loading.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/alias-clear.test.js test/cacheManager.test.js` in `packages/require`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/require/src/caching/cacheManager.ts packages/require/test/alias-clear.test.js docs/backlog.md
git commit -m "fix(require): preserve alias object identity across cache clears"
```

Note: delete the `## Orphaned alias object after a cache clear` section from `docs/backlog.md` in this commit.

---

### Task 4: Top-level manifold functions bypass anchors

**Files:**
- Modify: `packages/manifold/src/index.js:50-160`
- Test: `packages/manifold/test/top-level-exports.test.js` (new)

**Interfaces:**
- Consumes: namespaced modules (`./booleans/index.js`, `./transforms/index.js`, etc.).
- Produces: top-level imports resolve to the same function objects as namespaced imports, so external wrappers (e.g. `@jbroll/jscad-anchors` `wrap/groups.js`) that patch namespaces also cover top-level use — or top-level convenience exports are removed and namespaced use is required.

**Root cause:** `index.js:76-109` re-exports copies (`export { union } from './booleans/index.js'`) alongside namespaces (`export * as booleans`). Anchors classifies namespaced paths only, so models importing top-level `union`/`translate` lose anchors silently.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import * as manifold from '../src/index.js'

describe('top-level export identity', () => {
  it('top-level union is the same function as booleans.union', async () => {
    expect(manifold.union).toBe(manifold.booleans.union)
    expect(manifold.translate).toBe(manifold.transforms.translate)
    expect(manifold.cube).toBe(manifold.primitives.cube)
    expect(manifold.extrudeLinear).toBe(manifold.extrusions.extrudeLinear)
    expect(manifold.colorize).toBe(manifold.colors.colorize)
  })
})
```

Note: `export { union } from` already yields the same binding in ESM, so this passes today and only guards identity. The real fix is semantic: decide between (A) removing top-level function re-exports so misuse fails loudly, or (B) keeping identity plus documenting that anchors wrapping must patch both paths. Prefer (A) unless existing apps/tests import top-level functions (they do: `test/basic.test.js` imports `cube`, `union`, `translate` top-level).

Given in-repo usage, implement (B-minimal): keep the exports but guarantee and test identity, and add a code comment pointing at anchors `wrap/groups.js` so future wrappers patch namespaces (which then covers top-level automatically since they are the same binding). If identity already holds, the test locks it; if any wrapper re-defines top-level separately, change it to re-export the namespace binding.

- [ ] **Step 2: Run test to verify current state**

Run: `npx vitest run test/top-level-exports.test.js` in `packages/manifold`
Expected: PASS today (locks identity); if FAIL, the fix is to make top-level re-export the namespace binding.

- [ ] **Step 3: Write minimal implementation**

No production change if identity holds; add comment in `index.js` above the top-level re-exports:

```js
// Top-level re-exports must stay identical bindings to the namespaced
// versions (same function objects), so external wrappers such as
// @jbroll/jscad-anchors wrap/groups.js that patch namespaces also cover
// top-level imports. Do not wrap or redefine these separately.
```

If any top-level export is NOT identical, change it to `export { union } from` the same module (not a local wrapper).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/top-level-exports.test.js test/basic.test.js` in `packages/manifold`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/manifold/src/index.js packages/manifold/test/top-level-exports.test.js docs/backlog.md
git commit -m "fix(manifold): lock top-level export identity with namespaces for anchors"
```

Note: delete the `## Top-level manifold functions bypass anchors` section from `docs/backlog.md` in this commit. If full anchors coverage requires changes in `@jbroll/jscad-anchors` (external repo), note that in the commit message and keep this task to the jscadui-side guarantee.
