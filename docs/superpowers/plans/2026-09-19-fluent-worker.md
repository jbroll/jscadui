# Fluent bundle in the production worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `require('@jbroll/jscad-fluent')` resolves inside the production workers of both apps so fluent-writing agents run in the app.

**Architecture:** Thin CJS re-export bundle per app (`src_bundle/bundle.jscad-fluent.js`, same pattern as `bundle.model-tools.js`), built by esbuild with shared-modeling externals, mapped through the existing `bundles` alias mechanism, loaded lazily on first `require`. Params ride the classic paths (`@jscad-params` block, `getParameterDefinitions` export) with no plumbing changes.

**Tech Stack:** Node 22, ES modules, esbuild (via `src_build/esbuildUtil.js` `buildBundle`), vitest, `file:` linked `@jbroll/jscad-fluent` checkout.

## Global Constraints

- Targets modern browsers only. ES2022+ without polyfills. No compat shims.
- Purely additive: no existing bundle, alias, or demo changes. No shipped fluent demo.
- Both apps' existing example suites pass unmodified (back-compat gate).
- `file:` dependency on the local fluent checkout in both apps, matching the agent-loop devDependency (`file:../../../jscad-fluent`).

---

### Task 1: Bundle source, build entries, and file: deps (both apps)

**Files:**
- Create: `apps/jscad-web/src_bundle/bundle.jscad-fluent.js`
- Create: `apps/jscad-studio-run/src_bundle/bundle.jscad-fluent.js`
- Modify: `apps/jscad-web/build.js`
- Modify: `apps/jscad-studio-run/build.js`
- Modify: `apps/jscad-web/package.json`
- Modify: `apps/jscad-studio-run/package.json`

**Interfaces:**
- Consumes: `@jbroll/jscad-fluent` (file-linked checkout, CJS `dist/jscad-fluent.umd.cjs` + ESM `dist/jscad-fluent.js`), `buildBundle` from `src_build/esbuildUtil.js`.
- Produces: `build/bundle.jscad-fluent.js` (CJS) in each app; runtime module name `@jbroll/jscad-fluent` for Task 2 aliases.

- [ ] **Step 1: Add the file: dependency in both apps**

In `apps/jscad-web/package.json` dependencies, add (alphabetical order, after `@jscad/modeling` line):

```json
"@jbroll/jscad-fluent": "file:../../../jscad-fluent",
```

Same line in `apps/jscad-studio-run/package.json` dependencies. Then:

Run: `npm install` (repo root)
Expected: succeeds; `node -e "console.log(require('@jbroll/jscad-fluent').cube ? 'fluent-ok' : 'missing')"` prints `fluent-ok`.

- [ ] **Step 2: Write the failing check — bundle source missing**

Run: `ls apps/jscad-web/src_bundle/bundle.jscad-fluent.js apps/jscad-studio-run/src_bundle/bundle.jscad-fluent.js`
Expected: FAIL (no such file).

- [ ] **Step 3: Create both bundle sources (identical content)**

`apps/jscad-web/src_bundle/bundle.jscad-fluent.js` and `apps/jscad-studio-run/src_bundle/bundle.jscad-fluent.js`:

```js
// The fluent bundle the worker loads through the '@jbroll/jscad-fluent'
// alias. Shared deps stay external so the worker's bundle aliases provide
// the single shared copies: @jscad/modeling (modeling bundle) and
// @jbroll/jscad-anchors (CDN build, engine-aware via
// @jscad/modeling-for-anchors). Keeps the bundle thin and lazily loaded.
// Fluent's ESM dist exposes only a default export, so a bare
// `export *` would re-export nothing; assign module.exports to preserve the
// `jf.cube(...)` namespace consumers expect from require(). (The worker
// evals bundle-aliased sources as CJS without transform, so module.exports
// assignment is the correct shape — same as every other CJS leaf bundle.)
import jf from '@jbroll/jscad-fluent'
module.exports = jf
```

Note on spec deviation: the design doc lists only `@jscad/modeling` external. `@jbroll/jscad-anchors` and `@jscad/modeling-for-anchors` are also external because fluent's runtime dep is anchors (its ESM dist imports `@jbroll/jscad-anchors`, whose dist requires `@jscad/modeling-for-anchors` — a runtime-only worker alias, not build-resolvable). Bundling anchors inline would pin fluent to the jscad engine and duplicate the CDN anchors copy; external keeps one engine-aware copy.

- [ ] **Step 4: Add build entries next to the model-tools bundle**

In `apps/jscad-web/build.js` after the `bundle.model-tools.js` `buildBundle` block:

```js
// fluent bundle: shared deps stay external so the runtime require routes
// them to the modeling bundle alias and the CDN anchors build.
await buildBundle(outDir + '/build', 'bundle.jscad-fluent.js', {
  format: 'cjs',
  watch: dev,
  loader: cjsLoader,
  external: ['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-anchors'],
})
```

Same insertion in `apps/jscad-studio-run/build.js` after its `bundle.model-tools.js` block.

- [ ] **Step 5: Build both apps and verify the artifact**

Run: `cd apps/jscad-web && node build.js --skipDocs` (docs need the sibling OpenJSCAD.org checkout otherwise)
Expected: completes; `build/build/bundle.jscad-fluent.<hash>.js` exists (production builds content-hash leaf bundles; match `^bundle\.jscad-fluent\.[0-9a-f]{8}\.js$`) and contains `require("@jbroll/jscad-anchors")` (external, not inlined).

Run: `cd ../jscad-studio-run && node build.js`
Expected: completes; `build/build/bundle.jscad-fluent.js` exists.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/package.json apps/jscad-studio-run/package.json apps/jscad-web/src_bundle/bundle.jscad-fluent.js apps/jscad-studio-run/src_bundle/bundle.jscad-fluent.js apps/jscad-web/build.js apps/jscad-studio-run/build.js package-lock.json
git commit -m "feat(worker): fluent bundle source and build entries in both apps"
```

### Task 2: Bundle aliases in both apps

**Files:**
- Modify: `apps/jscad-web/bundles.js`
- Modify: `apps/jscad-web/bundles.test.js`
- Modify: `apps/jscad-studio-run/src/frame.js`

**Interfaces:**
- Consumes: `build/bundle.jscad-fluent.js` from Task 1.
- Produces: `'@jbroll/jscad-fluent'` alias in `getBundles()` (web) and `workerBundles()` (studio-run).

- [ ] **Step 1: Write the failing test — alias missing**

Run: `cd apps/jscad-web && npx vitest run bundles.test.js`
Expected: PASS now (baseline), then after adding the assertion below it FAILS until the alias is added. Add to the `jscad engine` test:

```js
expect(b['@jbroll/jscad-fluent']).toBe('http://viewer.test/build/bundle.jscad-fluent.js')
```

Run again. Expected: FAIL with `expected undefined to be .../bundle.jscad-fluent.js`.

- [ ] **Step 2: Add the web alias in bundles.js**

In `getBundles` return object, after the `'@jscadui/model-tools'` line:

```js
'@jbroll/jscad-fluent': toUrl('./build/bundle.jscad-fluent.js'),
```

Full return keeps override spread first so `window.jscadModuleOverrides` can still replace it (same as every other alias; the existing `other overrides pass through` test already covers fluent overrides).

- [ ] **Step 3: Add the studio-run alias in frame.js workerBundles**

```js
const workerBundles = () => ({
  '@jscad/modeling': BUNDLE_BASE + 'bundle.jscad_modeling.js',
  '@jscad/modeling-for-anchors': BUNDLE_BASE + 'bundle.jscad_modeling.js',
  '@jscad/modeling-for-manifold': BUNDLE_BASE + 'bundle.jscad_modeling.js',
  '@jscad/io': BUNDLE_BASE + 'bundle.jscad_io.js',
  '@jscadui/model-tools': BUNDLE_BASE + 'bundle.model-tools.js',
  '@jbroll/jscad-fluent': BUNDLE_BASE + 'bundle.jscad-fluent.js',
  '@jscadui/params-core': BUNDLE_BASE + 'bundle.params_core.js',
  '@jscadui/jscad-text': BUNDLE_BASE + 'bundle.jscad_text.js',
})
```

One added line; no other changes.

- [ ] **Step 4: Run the alias tests**

Run: `cd apps/jscad-web && npx vitest run bundles.test.js`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/bundles.js apps/jscad-web/bundles.test.js apps/jscad-studio-run/src/frame.js
git commit -m "feat(worker): map @jbroll/jscad-fluent alias in both apps"
```

### Task 3: Worker-API fluent tests through the built bundles + back-compat gate

**Files:**
- Create: `apps/jscad-web/test/fluent-worker.test.js`
- Test: `apps/jscad-web/bundles.test.js`, `apps/jscad-web/examples.test.js`, `packages/agent-loop/eval/backend.test.js`

**Interfaces:**
- Consumes: built `build/build/bundle.jscad-fluent.js`, real `@jscad/modeling`, `getParameterDefinitionsFromSource` from `@jscadui/worker`, `measure` from `@jscadui/model-tools`.
- Produces: regression gate for fluent-in-worker; no production code.

- [ ] **Step 1: Write the failing test file**

Create `apps/jscad-web/test/fluent-worker.test.js`:

```js
/**
 * Fluent in the production worker bundles.
 * Exercises the REAL built bundle.jscad-fluent.js with real fluent sources:
 * a cube renders entities, and both classic params paths yield defs.
 * Requires a prior `node build.js` so build/build/bundle.jscad-fluent.<hash>.js exists.
 *
 * The bundle is loaded the way the worker loads it: source text evaled as
 * CJS with a require shim for its externals (the worker's bundle aliases
 * provide @jbroll/jscad-anchors and @jscad/modeling at runtime; here the
 * shim provides the local anchors dist and real modeling). Plain Node
 * require() of the .js artifact does not work under "type": "module".
 */
import { describe, expect, it } from 'vitest'
import Module from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modeling = nodeRequire('@jscad/modeling')
const { measure } = nodeRequire('@jscadui/model-tools')
const { getParameterDefinitionsFromSource } = await import('@jscadui/worker')

// The anchors dist requires the runtime-only '@jscad/modeling-for-anchors'
// alias; map it to real modeling the way the worker alias does.
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@jscad/modeling-for-anchors') return modeling
  return origLoad.call(this, request, parent, isMain)
}

const anchorsDist = join(__dirname, '..', '..', '..', '..', 'jscad-anchors', 'dist', 'jscad-anchors.cjs')

const findFluentBundle = () => {
  const dir = join(__dirname, '..', 'build', 'build')
  if (!existsSync(dir)) return null
  // Production builds content-hash leaves (bundle.jscad-fluent.<hash>.js);
  // dev builds keep the plain name. Ignore stale double-hashed copies.
  const dev = join(dir, 'bundle.jscad-fluent.js')
  if (existsSync(dev)) return dev
  const hashed = readdirSync(dir).filter((f) => /^bundle\.jscad-fluent\.[0-9a-f]{8}\.js$/.test(f)).sort()
  return hashed.length > 0 ? join(dir, hashed[0]) : null
}

// Eval the bundle source as CJS, exactly how the worker's require() evals
// bundle-aliased sources (no transform; require/module/exports in scope).
const loadFluentBundle = (bundlePath) => {
  const source = readFileSync(bundlePath, 'utf8')
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-anchors') return nodeRequire(anchorsDist)
    if (name === '@jscad/modeling' || name === '@jscad/modeling-for-anchors') return modeling
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  return module.exports
}

const runFluentSource = (source, fluentBundle) => {
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-fluent') return fluentBundle
    if (name === '@jscad/modeling') return modeling
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  const main = module.exports.main ?? module.exports
  const out = main({})
  return { exports: module.exports, geometry: Array.isArray(out) ? out : [out] }
}

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

const CUBE_PARAMS_BLOCK = `/** @jscad-params
size = 20 // Size
*/
const jf = require('@jbroll/jscad-fluent')
function main(p) { return [jf.cube({ size: p.size ?? 20 })] }
module.exports = { main }`

const CUBE_LEGACY_PARAMS = `const jf = require('@jbroll/jscad-fluent')
function getParameterDefinitions() { return [{ name: 'size', type: 'int', initial: 20, caption: 'Size' }] }
function main(p) { return [jf.cube({ size: p.size ?? 20 })] }
module.exports = { main, getParameterDefinitions }`

describe('fluent worker bundle', () => {
  it('bundle artifact exists (run node build.js first)', () => {
    expect(findFluentBundle(), 'missing bundle.jscad-fluent.js: run node build.js').not.toBeNull()
  })

  it('a fluent cube renders one entity with ~8000 volume', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    expect(typeof fluentBundle.cube).toBe('function')
    const { geometry } = runFluentSource(CUBE, fluentBundle)
    expect(geometry).toHaveLength(1)
    const { volume } = measure(geometry.length === 1 ? geometry[0] : geometry, {})
    expect(volume).toBeGreaterThan(7900)
    expect(volume).toBeLessThan(8100)
  })

  it('a fluent model with an @jscad-params block yields defs through the existing params path', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    const { exports } = runFluentSource(CUBE_PARAMS_BLOCK, fluentBundle)
    expect(typeof exports.main).toBe('function')
    const defs = getParameterDefinitionsFromSource(CUBE_PARAMS_BLOCK)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({ name: 'size', initial: 20 })
  })

  it('a fluent model with a getParameterDefinitions export yields defs', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    const { exports } = runFluentSource(CUBE_LEGACY_PARAMS, fluentBundle)
    expect(typeof exports.getParameterDefinitions).toBe('function')
    expect(exports.getParameterDefinitions()).toMatchObject([{ name: 'size' }])
  })
})
```

Run: `cd apps/jscad-web && npx vitest run test/fluent-worker.test.js`
Expected: FAIL — `missing .../bundle.jscad-fluent.js` or `Cannot find module` (Task 1 build not yet run in this checkout, or fluent dep missing).

- [ ] **Step 2: Build and watch it pass**

Run: `node build.js --skipDocs` (in `apps/jscad-web`)
Expected: build completes.

Run: `npx vitest run test/fluent-worker.test.js`
Expected: 4/4 PASS.

- [ ] **Step 3: Back-compat gate — existing suites pass unmodified**

Run: `cd apps/jscad-web && npx vitest run bundles.test.js examples.test.js`
Expected: all PASS, no example file touched.

Run: `cd ../jscad-studio-run && npx vitest run`
Expected: all PASS.

Run: `cd ../../packages/agent-loop && npx vitest run`
Expected: all PASS (Node-side eval coverage unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/test/fluent-worker.test.js
git commit -m "test(worker): fluent cube and params paths through built bundle"
```

## Self-Review

1. Spec coverage: bundle+alias both apps (Tasks 1–2); lazy additive, no demo changes (Global Constraints + Task 3 gate); cube renders + both params paths through built bundles (Task 3); Node eval stays covered (Task 3 gate runs agent-loop suite). Non-goals respected: no fluent-native params API, no shipped demo, no CDN sourcing change, no CI live runs.
2. Placeholder scan: no TBD/TODO; every code step shows exact content; exact commands with expected output.
3. Type consistency: module name `@jbroll/jscad-fluent` identical across bundle source, aliases, tests; bundle filename `bundle.jscad-fluent.js` identical across build entries, aliases, test path.
