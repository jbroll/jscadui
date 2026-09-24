# JSCAD Worker Protocol

The JSCAD worker uses `@jscadui/postmessage` for RPC communication. See [packages/postmessage/README.md](../packages/postmessage/README.md) for the underlying protocol details.

## Worker Methods

### jscadInit
Initialize the worker.

```typescript
interface InitOptions {
  baseURI?: string                              // Base URL for imports
  alias?: Array<{name: string, path: string}>   // Path aliases
  bundles?: Record<string, string>              // Package mappings
  userInstances?: boolean                       // Enable instancing
  claims?: boolean                              // the host answers jscadClaim; set by the frame
  poolSize?: number                             // frame only: read and stripped before the worker sees it
}
```

### jscadScript
Load and execute a script. Returns parameter definitions and rendered geometry.

```typescript
interface RunScriptOptions {
  script?: string   // Inline script content
  url?: string      // Script URL/name
  base?: string     // Base URL for imports
  root?: string     // Root path constraint
  runId?: unknown   // passed to the main run; see jscadMain
  held?: string[]   // passed to the main run; see jscadMain
  runMain?: boolean // default true
  supersede?: boolean // read and stripped by the frame; see supersede below
}

interface JscadScriptResult {
  def: ParameterDefinition[]
  params: Record<string, any>
  entities: Entity[]
  mainTime: number
  convertTime: number
}
```

With `runMain: false`, `jscadScript` loads the module and waits for WASM to be
ready, same as a normal load, but resolves `{ def: [], params: {} }` without
calling `main`. The frame uses this on one of its idle workers, one being
promoted to active or joining a grid run, to have the last script loaded and
ready before it runs, then sends `jscadMain` separately.

### jscadMain
Re-run main() with new parameters.

```typescript
interface RunMainOptions {
  params: Record<string, any>
  skipLog?: boolean
  stream?: boolean   // default true
  runId?: unknown    // echoed on each jscadCells and on a streamed result
  held?: string[]    // hashes of meshes the app already has; see below
  supersede?: boolean // read and stripped by the frame; see supersede below
}

interface JscadMainResult {
  entities: Entity[]
  mainTime: number
  convertTime: number
  streamed?: true
  runId?: unknown    // set only when streamed
  trapped?: true     // set when the worker's WASM instance has trapped
  lost?: { url: string, reason: string }[]  // set on a run that fanned out; see jscadClaim
}
```

`trapped: true` is set on a `jscadMain` or `jscadScript` result (never on a
rejection) when `globalThis.__allWasmTrap` is set, meaning some earlier cell in
this worker trapped the shared WASM instance. Once set it is never cleared, so
every later result from this worker carries it; the worker is expected to be
retired, not reused. An error still rejects with its original `name` — a
`WebAssembly.RuntimeError` arrives as `RuntimeError`, as before.

When `stream` is true (the default) and the loaded script is an ALL.js grid,
every grid level emits its own leaves through the stream hook: a nested grid
does not arrive at its parent as one cell, it streams each of its own leaves
the same way the outermost grid does. Each leaf is sent as a `jscadCells`
notification as soon as that leaf finishes, instead of the worker holding
every cell's geometry until main returns. A run during which anything was
emitted resolves with `entities: []`, `streamed: true` and the request's
`runId`; a normal (non-grid) run is unaffected and returns entities as before.
`jscadScript` passes its `runId` to the main run it starts.

A request with `runId` set whose `main` did not stream itself but returned
more than one solid is streamed too: the worker posts one `jscadCells` batch
per solid, in the order `main` returned them, then resolves the same way
(`entities: []`, `streamed: true`, `runId`). Unlike the grid case, the worker
keeps the solids afterward, so export needs no re-run. A request with no
`runId`, or whose `main` returns zero or one solid, gets the whole result in
one piece as before.

During a streamed run the worker posts `jscadCells`, `params: [{ entities,
runId }]`, one per emitted cell, with that cell's typed-array buffers passed as
transfer. Notifications carry no request id, so `runId` is how the app tells one
run's cells from an older run's still arriving.

When the request carries `held`, even an empty array, every `mesh` entity in
the whole result and in each `jscadCells` batch carries `hash`: a 16-character
lowercase hex string from two 32-bit FNV-1a lanes fed the entity's `type` and
its `vertices`, `indices`, `normals` and `colors` contents, 32-bit words at a
time, each field prefixed by its name and byte length (`meshHash` in
`@jscadui/format-common`). The hash is never stored, so the function can change
between releases. Hashing 400K indexed triangles takes about 20 ms in Node, so a
request without `held` (an animation frame, an export re-run, an agent
evaluation) gets meshes with no `hash`. The frame's replay on a promoted worker
reuses the app's recorded options, `held` included, so it is hashed although
the frame drops its answer. When `held` contains a mesh's hash, the
worker sends a `MeshRef` in its place, with no typed arrays and no transfer
buffers, and the app draws the mesh it already holds under that hash. A buffer a
ref'd mesh shares with another entity in the same message stays in the transfer
list. `held` does not apply to `line`, `lines` or `instance` entities.

Each `jscadCells` batch carries copies of the typed arrays it sends, one copy
per distinct array in the batch, and transfers the copies' buffers. A solid
emitted in two batches, or kept for export, keeps its own arrays. The worker
clears its conversion cache after each batch and after every `jscadMain`,
success or failure, so a later run converts each solid again. The whole result
is not copied: it transfers the converted arrays, which for a `ManifoldGeom3`
are the solid's own cached mesh arrays.

`jscadExportData`, `jscadMeasure` and `jscadCheck` need the solids. A grid run
does not keep them, so after one of those the worker re-runs main with
`stream: false`. During that re-run `globalThis.__jscadProgress` is set, and the
grid calls it once per cell, which posts `jscadProgress` (`params: []`). The
stream hook also offers `progress()`, which posts the same message. The frame
relays `jscadProgress` only while one of those three requests is pending.

With `useGpuNormals` set on the manifold package, each mesh entity arrives
indexed (`vertices`, `indices`) and carries no `normals`.

### jscadClaim

Only a worker whose `jscadInit` had `claims: true` claims. Before running a
leaf, a grid's stream hook posts

```
{ method: 'jscadClaim', id, params: [{ key, url, runId }] }
```

The host answers with the notification

```
{ method: '__CLAIM__', params: [{ id, won }] }
```

with the id inside `params` rather than at the top level, because a message
with a top-level id is a request the worker would answer. The frame answers
`won: false` to a worker outside the run named by `runId` and to any claim
made after the run has closed.

A worker that joins a `jscadMain` run late is sent that same `jscadMain`
request, and reloads whichever script the frame had most recently relayed as
`jscadScript` when the `jscadMain` arrived, even if that load had not finished
yet, which is not necessarily the last script that finished loading without error. A
load that answers with an error is not the script a joiner reloads; the frame
falls back to the last one that did.

### supersede and SupersededError

The app may set `supersede: true` on the options of `jscadScript` or
`jscadMain`. The frame reads it and strips it; the worker never sees it. If the
active worker has an app `jscadMain` or `jscadScript` pending that started at
least 500 ms earlier (`ABANDON_AFTER_MS`), the frame rejects it and every other
pending `jscadMain` and `jscadScript` on that worker with
`{ name: 'SupersededError', message: 'superseded by a newer run' }`, terminates
that worker, and runs the new request on an idle worker it promotes to active.
A superseding `jscadMain` does not abandon a pending `jscadScript`. Other
requests on the terminated worker reject with `AbortError`, apart from mirrored
setup the promoted worker also received, which resolves with the promoted
worker's answer. No `frameWorkerTerminated` is
sent. When every pending run is younger than 500 ms, none is abandoned, and
the new request runs after them on the same worker.

Requests that wait behind a promoted worker's reload have not reached a worker
yet. A superseding request rejects every `jscadMain` waiting there with the same
`SupersededError` and takes its place in the queue, except a `jscadMain` that a
queued `jscadExportData`, `jscadMeasure` or `jscadCheck` after it will read. A
queued `jscadScript` is never rejected this way.

A run that has fanned out across the pool is superseded as a whole: the
superseding request rejects it `SupersededError` at once, closes it to further
claims, and stops relaying its `jscadCells`. A member on a leaf it started at
least `ABANDON_AFTER_MS` ago is retired the same way as above; the rest finish
their current leaf, find every later claim answered `false`, and go idle. A
run that has not yet fanned out is closed to claims, so it never gets the
chance to fan out, but not answered this way. The ordinary supersede rules
above answer it instead. Either way, a superseding `jscadMain` leaves
a grid load alone and never retires a worker still holding a pending app
`jscadScript`.

### jscadExportData
Export model to a format.

```typescript
interface ExportDataOptions {
  format: 'stla' | 'stlb' | 'amf' | 'json' | 'obj' | 'x3d' | 'svg' | '3mf'
  options?: Record<string, any>
}

interface ExportResult {
  data: ArrayBuffer[]
}
```

### jscadGetExportFormats
Get available export formats.

```typescript
interface ExportFormatInfo {
  id: string
  label: string
  extension: string
}
```

## Entity Format

Geometry is returned in WebGL-ready format with typed arrays as transferables:

```typescript
interface MeshEntity {
  type: 'mesh'
  id: number
  vertices: Float32Array    // [x,y,z, ...]
  normals: Float32Array
  indices: Uint16Array | Uint32Array
  color?: [r, g, b, a]
  colors?: Float32Array     // Per-vertex
  isTransparent?: boolean
  transforms?: number[]     // 4x4 matrix
  hash?: string             // 16 hex chars, only when the request carried held; see jscadMain
}

// Sent in place of a MeshEntity whose hash was in the request's held
interface MeshRef {
  type: 'mesh'
  hash: string
  ref: true
  id?: number
  color?: [r, g, b, a]
  transforms?: number[]
  isTransparent?: boolean
  opacity?: number
}

interface LineEntity {
  type: 'line' | 'lines'
  id: number
  vertices: Float32Array
  color?: [r, g, b, a]
}

interface InstanceEntity {
  type: 'instance'
  id: number
  originalId: number
  list: Array<{ color?: [r,g,b,a], transforms?: number[] }>
}
```

## Usage

```javascript
import { messageProxy } from '@jscadui/postmessage'

/** @type {import('@jscadui/worker').JscadWorker} */
const workerApi = messageProxy(new Worker('bundle.frame-worker.js'), {})

await workerApi.jscadInit({ bundles: { '@jscad/modeling': '/bundle.js' } })

const { entities } = await workerApi.jscadScript({ script, url: 'model.js' })
// render entities...

const { entities: updated } = await workerApi.jscadMain({ params: { size: 20 } })

const { data } = await workerApi.jscadExportData({ format: 'stlb' })
```

## Type Definitions

Full types are in `packages/worker/worker.js` (JSDoc) and `packages/format-common/` (TypeScript).
