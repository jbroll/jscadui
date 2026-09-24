# Preview Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every model preview lighter and sturdier: indexed geometry with GPU normals, part-by-part streaming, reuse of unchanged meshes across runs, and a spare worker for instant abandon and trap recovery.

**Architecture:** Four independent parts, shipped in order A → B → C → D, each ending green on unit tests and CI. A changes the mesh layout Manifold hands the renderer. B reuses the grid streaming path for ordinary multi-part models. C adds content hashes and a `held` set so the worker sends references for meshes the page already draws. D gives the frame host a second, warm worker it can promote.

**Tech Stack:** Plain ES2022 JS, three.js, Manifold WASM, vitest, simple-ci (`sci`) on the GPU host, Playwright sweeps.

**Spec:** `docs/superpowers/specs/2026-09-24-preview-optimizations-design.md`

## Global Constraints

- Targets modern browsers only. ES2022+, no polyfills or compat shims.
- Caps stay as they are: per batch 256 MB and 2,000 entities (`DEFAULT_CAPS`); streamed run 1.5 GB and 20,000 entities (`STREAM_CAPS`).
- Message and option names exactly: `jscadCells`, `jscadProgress`, `runId`, `stream`, `held`, `ref`, `hash`, `runMain`, `supersede`, `trapped`, error name `SupersededError`.
- Abandon threshold: 500 ms (`ABANDON_AFTER_MS = 500`).
- Hash: 64-bit FNV-1a over bytes, rendered as a 16-character lowercase hex string.
- Comments: default to none; one or two lines saying why. Match surrounding style (no semicolons, 2-space indent, single quotes).
- Unit tests locally (`npx vitest run` in a package). Never run the render sweeps or the OpenSCAD comparison suite locally; use `sci`.
- Docs change in the same commit as the code they describe (`apps/jscad-web/docs/architecture.md`, `docs/WORKER_PROTOCOL.md`, `docs/backlog.md`).
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never open a pull request. Merge is `git merge --ff-only` into `main`, and only when the user says so.
- Run `packages/openscad/bin/generate-all-files.js` only through `npm run generate-all` (it passes `--no-rename`).

---

## Part A — Indexed geometry with GPU normals

### Task A1: Manifold raw mesh keeps only positions

**Files:**
- Modify: `packages/manifold/src/geometries/ManifoldGeom3.js` (`#ensureRawMesh`, ~line 151)
- Test: `packages/manifold/test/basic.test.js`

**Model:** `sonnet` — one method plus tests in an existing suite.

**Interfaces:**
- Produces: with `ManifoldGeom3.useGpuNormals = true`, `vertices` is a Float32Array of x,y,z per shared vertex, `indices` is Manifold's `triVerts`, `normals` is `undefined`.

- [ ] **Step 1: Write the failing tests.** Read `basic.test.js` for how it builds a cube and toggles `setUseGpuNormals`. Add a `describe('indexed mesh (useGpuNormals)')` with `afterEach(() => setUseGpuNormals(false))` and:
  - a cube: `indices.length === 36`, `vertices.length === 8 * 3`, `normals === undefined`, every index `< 8`;
  - a mesh whose Manifold carries extra vertex properties (`numProp > 3`): build one with the WASM API the suite already imports (for example `Manifold.ofMesh` with a `Mesh` of `numProp: 4`, or any op the suite knows produces properties). Assert `vertices.length === numVert * 3` and that each triple equals the first three properties of the corresponding source vertex. If no available op produces `numProp > 3`, construct the `Mesh` directly with `numProp: 4`.

- [ ] **Step 2: Run to verify failure.** `cd packages/manifold && npx vitest run test/basic.test.js` — the `numProp` test fails (stride 4 passed through).

- [ ] **Step 3: Implement.** Replace the body of `#ensureRawMesh`:

```js
  #ensureRawMesh() {
    if (this.#cachedRawMesh === null) {
      const { vertProperties, triVerts, numProp } = this.#manifold.getMesh()
      this.#cachedRawMesh = { vertices: positionsOnly(vertProperties, numProp), indices: triVerts }
    }
    return this.#cachedRawMesh
  }
```

and add near `computeMeshData`:

```js
// Manifold interleaves any extra vertex properties after x, y, z
function positionsOnly(vertProperties, numProp) {
  if (!numProp || numProp === 3) return vertProperties
  const count = vertProperties.length / numProp
  const out = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    out[v * 3] = vertProperties[v * numProp]
    out[v * 3 + 1] = vertProperties[v * numProp + 1]
    out[v * 3 + 2] = vertProperties[v * numProp + 2]
  }
  return out
}
```

Update the `useGpuNormals` doc comment (~line 102): it is no longer regl-only.

- [ ] **Step 4: Run.** `npx vitest run` in `packages/manifold` — PASS. Existing tests that pin the expanded layout run with the flag off and must still pass.

- [ ] **Step 5: Commit.** `feat(manifold): indexed raw mesh keeps only x, y, z`

### Task A2: three.js shades meshes without normals flat on the GPU

**Files:**
- Modify: `packages/format-threejs/index.js` (materials ~14-26, `_CSG2Three` ~47-69, `setDefColor` ~133)
- Create: `packages/format-threejs/index.test.js`; set `"test": "vitest run"` in `packages/format-threejs/package.json` (add `vitest` to devDependencies like `packages/render-threejs/package.json`)
- Modify: `apps/jscad-web/src/engine.js:39-40`

**Model:** `sonnet` — renderer change with a fake-constructor test harness.

**Interfaces:**
- Produces: `_CSG2Three(obj)` for a mesh with no `normals` returns a mesh whose material has `flatShading === true`; with normals, `flatShading === false`. `viewer.supportsGpuNormals === true` for both engines.

- [ ] **Step 1: Write the failing test** `packages/format-threejs/index.test.js`. Fake the constructors CommonToThree needs:

```js
import { describe, it, expect } from 'vitest'
import { CommonToThree } from './index.js'

class Material { constructor(params = {}) { Object.assign(this, params) } }
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null }
  setAttribute(name, attr) { this.attributes[name] = attr }
  setIndex(attr) { this.index = attr }
}
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material } applyMatrix4() {} }
class Color { constructor(r, g, b) { Object.assign(this, { r, g, b }) } }

const convert = CommonToThree({
  MeshPhongMaterial: Material, LineBasicMaterial: Material, BufferGeometry, BufferAttribute,
  Mesh, InstancedMesh: Mesh, Line: Mesh, LineSegments: Mesh, Color, Vector3: class {}, Matrix4: class { fromArray() {} },
})

const tri = { type: 'mesh', vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }

describe('CommonToThree mesh shading', () => {
  it('shades a mesh with no normals flat on the GPU', () => {
    const mesh = convert(tri, {})
    expect(mesh.material.flatShading).toBe(true)
    expect(mesh.geometry.attributes.normal).toBeUndefined()
  })

  it('keeps the smooth-capable material when normals are given', () => {
    const mesh = convert({ ...tri, normals: new Float32Array(9) }, {})
    expect(mesh.material.flatShading).toBe(false)
  })

  it('shades a colored mesh with no normals flat too', () => {
    expect(convert({ ...tri, color: [1, 0, 0, 1] }, {}).material.flatShading).toBe(true)
  })

  it('keeps flat shading after the default color changes', () => {
    convert.setDefColor([0, 1, 0])
    expect(convert(tri, {}).material.flatShading).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure.** `cd packages/format-threejs && npx vitest run` — the no-normals cases fail.

- [ ] **Step 3: Implement** in `index.js`:
  - Replace the single `def` material with two: `def` (`flatShading: false`) and `defFlat` (`flatShading: true`), both built from the same color; `setDefColor` rebuilds both.
  - In `_CSG2Three`, `const flat = !normals && !smooth && (objType === 'mesh' || objType === 'instance')`. Use `defFlat` in place of `def` when `flat`, and pass `flatShading: flat` into `materialDef.make(...)` and into the instanced material options.
  - Remove the unused `const flatShading = false`.
  - With `smooth`, `toCreasedNormals` already computes normals from positions; keep that path unchanged.

- [ ] **Step 4: engine.js.** Set `viewer.supportsGpuNormals = true` in the three.js branch and replace the comment with: `// Meshes without normals get a flatShading material, which takes the face normal from screen-space derivatives`.

- [ ] **Step 5: Run.** `cd packages/format-threejs && npx vitest run`, `cd packages/render-threejs && npx vitest run`, `cd apps/jscad-web && npx vitest run`, `cd apps/jscad-web && npm run build` — PASS/succeeds.

- [ ] **Step 6: Commit.** `feat(threejs): shade meshes without normals on the GPU, and ask the worker for them`

### Task A3: Consumers stop depending on the render layout

**Files:**
- Modify: `packages/worker/src/exportStlText.js`
- Create: `packages/worker/src/exportStlText.test.js`
- Test: `packages/manifold/test/basic.test.js` (flag does not change `polygons`)
- Docs: `apps/jscad-web/docs/architecture.md` (Geometry caps), `docs/backlog.md` (remove the "Cut the per-triangle cost" item), `docs/WORKER_PROTOCOL.md` (`useGpuNormals`: meshes arrive indexed without normals)

**Model:** `sonnet`.

**Interfaces:**
- Produces: `exportStlText(entities)` computes each facet normal from its three positions and ignores `normals`.

- [ ] **Step 1: Failing tests.**
  - `exportStlText.test.js`: an indexed quad (4 vertices, 6 indices, no normals) produces two facets with normal `0 0 1`; an entity with per-vertex normals that disagree with the winding still gets the winding normal; output starts with `solid JSCAD` and ends with `endsolid JSCAD`.
  - `basic.test.js`: for a subtracted shape (cube minus sphere), `polygons.length` and `measureVolume` are the same with `setUseGpuNormals(true)` and `false`.

- [ ] **Step 2: Run to verify failure.** `cd packages/worker && npx vitest run src/exportStlText.test.js` — FAIL (reads `normals.length` of undefined).

- [ ] **Step 3: Implement** `convertToFacets`: drop the normals checks; for each triangle read the three positions via `indices`, compute `cross(v1 - v0, v2 - v0)`, normalize (zero vector for a degenerate triangle), and write `facet normal nx ny nz`. Keep the vertex-bounds check.

- [ ] **Step 4: Run.** Both packages' suites — PASS.

- [ ] **Step 5: Docs.** In `architecture.md` Geometry caps, replace the 84-bytes figures: Manifold meshes arrive indexed without normals (about 18 bytes a triangle for a typical mesh: about half a vertex of 12 bytes and 12 bytes of indices), so the 256 MB cap covers about 15M triangles. Delete the backlog item. Note in `WORKER_PROTOCOL.md` under `jscadMain` that with `useGpuNormals` the mesh is indexed and has no `normals`.

- [ ] **Step 6: Commit.** `fix(worker): STL text export computes facet normals from positions`

### Task A4: Verify Part A on CI (controller, inline)

- [ ] `sci push jscadui/render` and `sci push jscadui/render-grids`; wait with `sci wait JOB` under Bash `run_in_background`. Both must pass their baselines (the grid sweep may improve: record it).
- [ ] `sci push jscadui/web` (export e2e) must pass. Read `ci/web` first to confirm it runs `e2e/export.spec.js`.
- [ ] If the grid baseline improves, refresh it per `apps/jscad-web/e2e/RENDER-TESTING.md` (## Baseline) and commit `test(e2e): record the grid sweep with indexed geometry`.

---

## Part B — Stream the parts of a multi-part model

### Task B1: jscadMain streams solids one at a time

**Files:**
- Modify: `packages/worker/worker.js` (`jscadMain`, ~lines 260-330)
- Test: `packages/worker/worker.stream.test.js`
- Docs: `docs/WORKER_PROTOCOL.md`, `apps/jscad-web/docs/architecture.md` (Streamed grids → rename the section "Streamed runs" and add parts)

**Model:** `sonnet` — contained change in one function, with tests in an existing harness.

**Interfaces:**
- Consumes: `createStreamHook({ post, userInstances, runId })` → `{ hook: { emit, progress }, emitted }` (`packages/worker/src/stream.js`).
- Produces: a `jscadMain` call with `runId` set, whose `main` did not emit, returning more than one solid, posts one `jscadCells` batch per solid in order and resolves to `{ entities: [], streamed: true, runId, treeTime, execTime, convTime, proxyState? }`. `workerState.solids` keeps the solids and `lastRunStreamed` stays `false`.

- [ ] **Step 1: Failing tests** in `worker.stream.test.js`, using the file's existing `self.postMessage` stub and fake `workerState.main`:
  - main returns three `{ type: 'mesh', vertices: new Float32Array(9) }` solids, called with `runId: 7`: three `jscadCells` posts, in order, each with one entity and `runId: 7`; the result has `streamed: true`, `runId: 7`, `entities: []`; `currentSolids()` has three entries; `lastRunStreamed()` is false.
  - the same with no `runId`: no `jscadCells` post; result `entities` has three entries; not `streamed`.
  - one solid with `runId`: no post; whole result.
  - a manifold-like solid (`isManifoldGeom3: true, manifold: { numTri: vi.fn() }` plus mesh fields) is evaluated before its batch is posted (numTri called before the matching postMessage; use `vi.fn` call order).

- [ ] **Step 2: Run to verify failure.** `cd packages/worker && npx vitest run worker.stream.test.js`.

- [ ] **Step 3: Implement.** After `treeTime` and the `lastRunStreamed` line, branch:

```js
    let entities = []
    const streamParts = !emitted() && runId !== undefined && workerState.solids.length > 1
    if (emitted()) {
      // Each cell went out as it finished; keeping them would hold the whole grid again
      workerState.solids = []
    } else if (streamParts) {
      time = performance.now()
      for (const solid of workerState.solids) hook.emit([solid])
      execTime = performance.now() - time
    } else {
      // existing numTri loop, prepare, execTime, convTime
    }
    const result = { entities, treeTime, execTime, convTime }
    if (emitted() || streamParts) Object.assign(result, { streamed: true, runId })
```

`hook.emit` already forces evaluation and converts. `emitted()` becomes true after the first part, so capture `streamParts` before the loop (as above) and compute `lastRunStreamed` before it too (it already is). `hook` is `null` when `stream` is false; `streamParts` must also require `hook`.

- [ ] **Step 4: Run.** `cd packages/worker && npx vitest run`; `cd apps/jscad-web && npx vitest run` (fluent-worker and parity pass no `runId`, so they keep whole results).

- [ ] **Step 5: Docs.** Protocol: a streaming request (`runId` set) of a multi-part model gets its parts as `jscadCells` batches, and the worker keeps the solids so export needs no re-run. Architecture: same, plus instancing groups within one batch only.

- [ ] **Step 6: Commit.** `feat(worker): stream the parts of a multi-part model`

### Task B2: Verify Part B on CI (controller, inline)

- [ ] `sci push jscadui/render`, `jscadui/render-grids`, `jscadui/web`; all pass their baselines.

---

## Part C — Keep unchanged meshes across runs

### Task C1: Mesh content hash

**Files:**
- Create: `packages/format-common/meshHash.js`, `packages/format-common/meshHash.test.js`
- Modify: `packages/format-common/index.js` (re-export `meshHash`), `packages/format-common/package.json` (test script if missing)

**Model:** `haiku` — complete code below.

**Interfaces:**
- Produces: `meshHash(entity) → string` (16 hex chars) over `type`, then the bytes of `vertices`, `indices`, `normals`, `colors` in that order, each prefixed by its field name and byte length so fields cannot run together.

- [ ] **Step 1: Failing test** `meshHash.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { meshHash } from './meshHash.js'

const tri = () => ({ type: 'mesh', vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) })

describe('meshHash', () => {
  it('is 16 hex characters', () => expect(meshHash(tri())).toMatch(/^[0-9a-f]{16}$/))
  it('is equal for equal content in different buffers', () => expect(meshHash(tri())).toBe(meshHash(tri())))
  it('changes when one coordinate changes', () => {
    const b = tri()
    b.vertices[4] = 0.5
    expect(meshHash(b)).not.toBe(meshHash(tri()))
  })
  it('tells apart the same bytes in different fields', () => {
    const a = { type: 'mesh', vertices: new Float32Array([1, 2, 3]) }
    const b = { type: 'mesh', vertices: new Float32Array(0), normals: new Float32Array([1, 2, 3]) }
    expect(meshHash(a)).not.toBe(meshHash(b))
  })
  it('depends on the type', () => expect(meshHash({ ...tri(), type: 'lines' })).not.toBe(meshHash(tri())))
})
```

- [ ] **Step 2: Run to verify failure.** `cd packages/format-common && npx vitest run meshHash.test.js`.

- [ ] **Step 3: Implement** `meshHash.js`:

```js
const FIELDS = ['vertices', 'indices', 'normals', 'colors']

// Two 32-bit FNV-1a lanes with different offsets make a 64-bit hash
export const meshHash = (entity) => {
  let a = 0x811c9dc5
  let b = 0xcbf29ce4
  const feed = (byte) => {
    a = Math.imul(a ^ byte, 0x01000193)
    b = Math.imul(b ^ byte, 0x01000193) ^ (a >>> 15)
  }
  const feedString = (s) => { for (let i = 0; i < s.length; i++) feed(s.charCodeAt(i) & 0xff) }
  feedString(entity.type ?? '')
  for (const field of FIELDS) {
    const view = entity[field]
    if (!ArrayBuffer.isView(view)) continue
    feedString(field)
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    feedString(String(bytes.length))
    for (let i = 0; i < bytes.length; i++) feed(bytes[i])
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
```

- [ ] **Step 4: Run.** PASS. Export it from `packages/format-common/index.js`.

- [ ] **Step 5: Commit.** `feat(format-common): 64-bit content hash for mesh entities`

### Task C2: The worker sends references for held meshes

**Files:**
- Create: `packages/worker/src/meshRefs.js`, `packages/worker/src/meshRefs.test.js`
- Modify: `packages/worker/worker.js` (`jscadMain` options and the whole-result path; `jscadScript` passes `held` to its internal `jscadMain`), `packages/worker/src/stream.js` (batches), `docs/WORKER_PROTOCOL.md`

**Model:** `opus` — protocol change across the whole-result and streamed paths, with a buffer-detach hazard.

**Interfaces:**
- Consumes: `meshHash` (Task C1); `createStreamHook` (Part B).
- Produces:
  - `toRefs(entities, held: Set<string>, transferable: Transferable[]) → entities`: for each entity with `type === 'mesh'`, sets `hash = meshHash(entity)`; if `held.has(hash)`, returns `{ type, hash, ref: true, color, transforms, isTransparent, opacity, id }` (only the fields present) and removes that entity's buffers from `transferable`; otherwise returns the entity with `hash` added. Other types pass through unchanged.
  - `jscadMain({ ..., held })` and `jscadScript({ ..., held })` accept `held: string[]`; the whole result and every streamed batch go through `toRefs`.
  - After each run posts (success or failure), the worker calls `JscadToCommon.clearCache()`.

- [ ] **Step 1: Failing tests** `meshRefs.test.js`: a held mesh becomes a ref without buffers and its three buffers leave the transfer list; an unheld mesh keeps its buffers and gains `hash`; `lines` entities pass through unchanged; color and transforms survive on the ref. In `worker.stream.test.js`: `jscadMain({ runId: 1, held: [hashOfPart2] })` for three parts posts part 2 as a ref with no transfer buffers; a whole-result run with `held` returns the ref in `entities`; a second run of the same model object after the first posted does not throw on detached buffers (the cache was cleared, so it reconverts).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**
  - `meshRefs.js`: `toRefs` as specified. Remove buffers from `transferable` by identity (`transferable.splice(transferable.indexOf(x), 1)` for each of the entity's typed arrays present in it).
  - `stream.js`: `createStreamHook({ post, userInstances, runId, held })`; in `emit`, run `toRefs(entities, held, transferable)` before posting.
  - `worker.js`: accept `held`, build `const heldSet = new Set(held ?? [])`, pass to `createStreamHook` and to `toRefs` on the whole-result path before `withTransferable`. Move `JscadToCommon.clearCache()` so it runs in a `finally` for every `jscadMain`, and delete the "No clearCache() here" comment (it explains the old policy; the new one is: reuse is by content hash, and a cached entity whose buffers were transferred is detached). `jscadScript` forwards `held` to both internal `jscadMain` calls.

- [ ] **Step 4: Run.** `cd packages/worker && npx vitest run`; `cd apps/jscad-web && npx vitest run`.

- [ ] **Step 5: Docs.** Protocol: `held`, `ref` entities, `hash` on every mesh entity.

- [ ] **Step 6: Commit.** `feat(worker): send a reference for a mesh the page already holds`

### Task C3: The app resolves references

**Files:**
- Create: `apps/jscad-web/src/meshRefs.js`, `apps/jscad-web/test/mesh-refs.test.js`
- Modify: `apps/jscad-web/main.js` (`handleEntities`, `drawStream`, the requests that pass `runId`), `apps/jscad-web/src/streamRuns.js` (resolve before checks), `apps/jscad-web/src/paramsUI.js` (the `jscadMain` call passes `held`), `apps/jscad-web/docs/architecture.md`

**Model:** `opus` — identity rules interact with three.js reuse, streaming and caps.

**Interfaces:**
- Consumes: ref entities from Task C2.
- Produces: `createMeshRefs() → { held(): string[], resolve(entities): entities, remember(entities): void, forget(): void }`.
  - `remember(entities)` replaces the map with `hash → entity` for the entities now drawn.
  - `resolve(entities)` maps each `ref` entity: if the held entity has the same `color`, `transforms`, `isTransparent` and `opacity` (compared element-wise), return the held entity object itself; otherwise return `{ ...held, color, transforms, isTransparent, opacity, ref: undefined }` sharing its buffers. An unknown hash throws a `ModelError` (`name: 'ModelError'`) naming the hash. Non-ref entities pass through.
  - `held()` returns the map's keys.

- [ ] **Step 1: Failing tests** `mesh-refs.test.js`: same-attribute ref resolves to the identical object (`toBe`); a ref with a new color resolves to a new object whose `vertices` is the same array (`toBe`); an unknown hash throws `ModelError`; `remember` replaces, not merges; `held()` lists the remembered hashes. In `stream-runs.test.js`: a batch containing a ref resolved by a `resolve` option counts the resolved bytes toward the caps.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**
  - `meshRefs.js` as specified.
  - `streamRuns`: accept an optional `resolve` in `createStreamRuns({ ..., resolve = (e) => e })`, applied inside the `try` before `checkBuffers`, so an unknown ref ends the run through `onError`.
  - `main.js`: create `const meshRefs = createMeshRefs()`; pass `resolve: meshRefs.resolve` to `createStreamRuns`; in the non-streamed `handleEntities` path call `meshRefs.resolve` before `capGeometry` (inside the existing error handling so an unknown ref shows as a model error); call `meshRefs.remember(entities)` only when a run completes: in the non-streamed path after `setModel`, and in the streamed branch after `streamRuns.finish` returns totals, with the entity array `drawStream` last drew (keep it in a variable). Never call it from `drawStream` itself: batches later in the same run still reference the previous model's hashes. A run that ends in an error leaves the map as it was, so the next run's `held` still names meshes the page holds; pass `held: meshRefs.held()` in every request that passes `runId` (load, restore, param change, render-engine redraw) and in `runModelUpdate` via a `held` dep; call `meshRefs.forget()` when a load starts a different script URL (a new model shares nothing) and when the render engine changes.
  - Architecture doc: the reuse rule and that regl gains nothing.

- [ ] **Step 4: Run.** `cd apps/jscad-web && npx vitest run`; `npm run build`.

- [ ] **Step 5: Commit.** `feat(web): reuse meshes the page already draws when a run references them`

### Task C4: Verify Part C on CI (controller, inline)

- [ ] `sci push jscadui/render`, `jscadui/render-grids`, `jscadui/web`; all pass. The sweeps load each model once, so they check that nothing broke; the reuse itself is covered by unit tests.

---

## Part D — A spare worker

### Task D1: Worker support for promotion

**Files:**
- Modify: `packages/worker/worker.js` (`jscadScript` options, result `trapped`)
- Test: `packages/worker/worker.stream.test.js` (or a new `packages/worker/worker.spare.test.js` using the same `self` stub)
- Docs: `docs/WORKER_PROTOCOL.md`

**Model:** `sonnet`.

**Interfaces:**
- Produces:
  - `jscadScript({ ..., runMain = true })`: with `runMain: false`, loads the module, awaits WASM `ready`, sets `workerState.main`, and resolves `{ def: [], params: {} }` without running `main`.
  - Every `jscadMain` and `jscadScript` result carries `trapped: true` when `globalThis.__allWasmTrap` is set; errors keep the original `name` (a `WebAssembly.RuntimeError` arrives as `RuntimeError`, as today).

- [ ] **Step 1: Failing tests:** `jscadScript({ script, runMain: false })` for a script whose `main` would throw resolves `{ def: [], params: {} }` and a following `jscadMain` runs `main`; a `jscadMain` whose `main` sets `globalThis.__allWasmTrap = 'x'` resolves with `trapped: true` (clean up the global in `afterEach`); a `main` that throws `new WebAssembly.RuntimeError('unreachable')` rejects with `name === 'RuntimeError'`.

- [ ] **Step 2–4:** implement minimally, run `packages/worker` and `apps/jscad-web` suites.

- [ ] **Step 5: Commit.** `feat(worker): load a script without running it, and report a trapped runtime`

### Task D2: Frame host keeps a warm spare and retires trapped workers

**Files:**
- Modify: `apps/jscad-web/src_frame/frameHost.js`
- Test: `apps/jscad-web/test/frame-host.test.js`

**Model:** `opus` — the frame's security boundary and request bookkeeping.

**Interfaces:**
- Consumes: `jscadScript({ runMain: false })`, `trapped` (Task D1).
- Produces inside `createFrameHost`:
  - `workers = { active, spare }`, each `{ worker, pending: Map, loaded: boolean }`; the existing relay, id, timeout and kill rules apply per worker.
  - Mirroring: every `jscadInit` (after `frameInit`), `jscadSetFiles`, `jscadClearTempCache` and `jscadClearFileCache` goes to the spare too, as a frame-owned request whose answer is dropped.
  - Recording: `lastScript` and `lastMain` hold the params of the last `jscadScript` / `jscadMain` answered without error on the active worker.
  - `retire()`: terminate the active worker, reject its pending requests as `killWorker` does today but without `frameWorkerTerminated`, promote the spare (`loaded = false`), create a new spare and replay the mirrored setup into it (keep the ordered list of mirrored messages; drop cache clears older than the last `jscadSetFiles`).
  - `ensureLoaded(method)`: before relaying `jscadMain`, `jscadExportData`, `jscadMeasure` or `jscadCheck` to an active worker with `loaded === false`, send `jscadScript({ ...lastScript, runMain: false })`, then for export/measure/check also `jscadMain({ ...lastMain, stream: false })`, as frame-owned requests with the normal timeout; a failure answers the app's request with that error. A relayed `jscadScript` sets `loaded = true` when it succeeds.
  - Trap: after relaying an answer whose `error.name === 'RuntimeError'` or whose `params.trapped === true`, call `retire()`.
  - Kill (timeout, `onerror`, `onmessageerror`): unchanged for the app (answers plus `frameWorkerTerminated`), but the spare becomes the new active worker instead of a cold `createWorker()`.
  - The spare is created after the first `jscadScript` answer, not at boot.
  - `getPendingCount()` counts the active worker's app requests only.

- [ ] **Step 1: Failing tests** in `frame-host.test.js` (the `setup()` fake workers already record `postMessage` calls): a spare is created after the first script answer and receives the mirrored init and files but no script; a `RuntimeError` answer is relayed and then the active worker is terminated and the next `jscadMain` goes to the promoted worker preceded by `jscadScript` with `runMain: false`; an export after promotion is preceded by the script load and the last `jscadMain` with `stream: false`; a trapped result retires the same way; a timeout kill still posts `frameWorkerTerminated` and the next request uses the former spare (no new `createWorker` call at that moment beyond the replacement spare); answers to frame-owned requests never reach `post`.

- [ ] **Step 2–4:** implement, run `cd apps/jscad-web && npx vitest run test/frame-host.test.js`, then the whole app suite and build.

- [ ] **Step 5: Docs.** `architecture.md`: the spare, what it holds, promotion, trap retirement, memory cost.

- [ ] **Step 6: Commit.** `feat(frame): keep a warm spare worker and retire a trapped one`

### Task D3: Abandon long stale runs

**Files:**
- Modify: `apps/jscad-web/src_frame/frameHost.js`, `apps/jscad-web/main.js` (`jscadScript`, `paramChangeCallback`, render-engine redraw), `apps/jscad-web/src/paramsUI.js` (`runModelUpdate`)
- Test: `apps/jscad-web/test/frame-host.test.js`, `apps/jscad-web/test/params-ui.test.js`

**Model:** `opus` — changes the app's single-flight parameter updates.

**Interfaces:**
- Produces:
  - Frame: a `jscadScript` or `jscadMain` whose options carry `supersede: true`, arriving while the active worker has a pending `jscadScript` or `jscadMain` started at least `ABANDON_AFTER_MS = 500` ms ago, answers each such pending request with `{ name: 'SupersededError', message: 'superseded by a newer run' }`, calls `retire()`, and relays the new request to the promoted worker (after `ensureLoaded` for `jscadMain`). `supersede` is stripped before the message reaches a worker.
  - App: loads, param changes and render-engine redraws send `supersede: true`. `runModelUpdate` and `paramChangeCallback`, when a run is in flight, send the new run at once if the in-flight one started at least 500 ms ago, otherwise keep today's coalescing. A rejection named `SupersededError` sets no error (the run is stale by construction).

- [ ] **Step 1: Failing tests:** frame — a superseding `jscadMain` at 600 ms answers the pending one `SupersededError`, terminates the active worker and runs on the promoted one; at 100 ms it is relayed to the same worker and nothing is answered early; `supersede` never reaches a worker. Params UI — a second update 600 ms into a run calls `jscadMain` again before the first settles; at 100 ms it waits; a `SupersededError` from the first does not call `setError`.

- [ ] **Step 2–4:** implement, run the app suite and build.

- [ ] **Step 5: Docs.** `architecture.md` (abandon rule, threshold), `docs/WORKER_PROTOCOL.md` (`supersede`, `SupersededError`).

- [ ] **Step 6: Commit.** `feat(web): abandon a run that a newer one supersedes after 500 ms`

### Task D4: Verify Part D on CI (controller, inline)

- [ ] `sci push jscadui/render`, `jscadui/render-grids`, `jscadui/web`; all pass. The grid sweep exercises trap retirement on the grids that trap; check its `partial` cells are unchanged or fewer.
- [ ] `cd packages/openscad && npm test` (runs on CI); compare against `MODEL_COMPARISON_BASELINE.md` by model name, not exit code.
- [ ] Final whole-branch review; delete this plan and the spec in the final commit after folding what matters into `architecture.md`.
