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
}

interface JscadMainResult {
  entities: Entity[]
  mainTime: number
  convertTime: number
}
```

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
const workerApi = messageProxy(new Worker('bundle.worker.js'), {})

await workerApi.jscadInit({ bundles: { '@jscad/modeling': '/bundle.js' } })

const { entities } = await workerApi.jscadScript({ script, url: 'model.js' })
// render entities...

const { entities: updated } = await workerApi.jscadMain({ params: { size: 20 } })

const { data } = await workerApi.jscadExportData({ format: 'stlb' })
```

## Type Definitions

Full types are in `packages/worker/worker.js` (JSDoc) and `packages/format-common/` (TypeScript).
