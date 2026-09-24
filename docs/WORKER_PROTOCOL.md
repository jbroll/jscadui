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
}

interface JscadScriptResult {
  def: ParameterDefinition[]
  params: Record<string, any>
  entities: Entity[]
  mainTime: number
  convertTime: number
}
```

### jscadMain
Re-run main() with new parameters.

```typescript
interface RunMainOptions {
  params: Record<string, any>
  skipLog?: boolean
  stream?: boolean   // default true
  runId?: unknown    // echoed on each jscadCells and on a streamed result
  held?: string[]    // hashes of meshes the app already has; see below
}

interface JscadMainResult {
  entities: Entity[]
  mainTime: number
  convertTime: number
  streamed?: true
  runId?: unknown    // set only when streamed
}
```

When `stream` is true (the default) and the loaded script is an ALL.js grid,
only the outermost grid emits: it streams each cell as a `jscadCells`
notification as soon as that cell finishes, instead of the worker holding
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

Every `mesh` entity, in the whole result and in each `jscadCells` batch,
carries `hash`: a 16-character lowercase hex 64-bit FNV-1a hash of its
`vertices`, `indices`, `normals` and `colors` bytes (`meshHash` in
`@jscadui/format-common`). When the request's `held` contains that hash, the
worker sends a `MeshRef` in its place, with no typed arrays and no transfer
buffers, and the app draws the mesh it already holds under that hash. A buffer a
ref'd mesh shares with another entity in the same message stays in the transfer
list. `held` does not apply to `line`, `lines` or `instance` entities.

The worker clears its conversion cache after every `jscadMain`, success or
failure, so a later run converts each solid again instead of reusing an entity
whose buffers were transferred away.

`jscadExportData`, `jscadMeasure` and `jscadCheck` need the solids. A grid run
does not keep them, so after one of those the worker re-runs main with
`stream: false`. During that re-run `globalThis.__jscadProgress` is set, and the
grid calls it once per cell, which posts `jscadProgress` (`params: []`). The
stream hook also offers `progress()`, which posts the same message. The frame
relays `jscadProgress` only while one of those three requests is pending.

With `useGpuNormals` set on the manifold package, each mesh entity arrives
indexed (`vertices`, `indices`) and carries no `normals`.

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
  hash: string              // 16 hex chars, see jscadMain
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
