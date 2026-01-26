# Worker Communication Protocol

This document describes the RPC protocol used for communication between the main thread and the JSCAD worker.

## Overview

```
┌─────────────┐    postMessage RPC    ┌─────────────┐
│ Main Thread │◄────────────────────►│   Worker    │
│             │                       │             │
│ messageProxy│  Request: {method,    │ handlers    │
│             │   params, id}         │             │
│             │                       │             │
│             │  Response: {method:   │             │
│             │   '__RESPONSE__',     │             │
│             │   params|error, id}   │             │
└─────────────┘                       └─────────────┘
```

The protocol is built on `@jscadui/postmessage`, which provides:
- Promise-based RPC over postMessage
- Automatic request/response ID matching
- Transferable object support for zero-copy ArrayBuffer transfer
- Error serialization with stack trace preservation

## Message Format

### Request
```typescript
{
  method: string,      // Method name to invoke
  params: any[],       // Array of parameters
  id?: number          // Request ID (omitted for notifications)
}
```

### Response
```typescript
{
  method: '__RESPONSE__',
  params?: any,        // Result value (on success)
  error?: {            // Error object (on failure)
    message: string,
    name: string,
    stack: string
  },
  id: number           // Matches request ID
}
```

## Worker Methods

### jscadInit

Initialize the worker with configuration.

**Request:**
```typescript
interface InitOptions {
  baseURI?: string                    // Base URL for relative imports
  alias?: Array<{name: string, path: string}>  // Path aliases
  bundles?: Record<string, string>    // Package URL mappings (e.g., {'@jscad/modeling': 'http://...'})
  userInstances?: boolean             // Enable geometry instancing
}
```

**Response:** `void`

**Example:**
```javascript
await workerApi.jscadInit({
  baseURI: 'http://localhost:5120/',
  bundles: { '@jscad/modeling': '/bundle.jscad-modeling.js' }
})
```

---

### jscadScript

Load and execute a JSCAD script.

**Request:**
```typescript
interface RunScriptOptions {
  script?: string   // Inline script content
  url?: string      // Script URL/name (used for error messages, imports)
  base?: string     // Base URL for relative imports
  root?: string     // Root path (prevents access above this path)
}
```

**Response:**
```typescript
interface JscadScriptResult {
  def: ParameterDefinition[]  // Parameter definitions from getParameterDefinitions()
  params: Record<string, any> // Default parameter values
  entities: Entity[]          // Rendered geometry (transferable)
  mainTime: number            // Script execution time (ms)
  convertTime: number         // Geometry conversion time (ms)
}
```

**Example:**
```javascript
const result = await workerApi.jscadScript({
  script: `
    const { cube } = require('@jscad/modeling').primitives
    function main() { return cube({ size: 10 }) }
    module.exports = { main }
  `,
  url: 'inline.js',
  base: 'http://localhost:5120/'
})
```

---

### jscadMain

Re-run the main() function with new parameters.

**Request:**
```typescript
interface RunMainOptions {
  params: Record<string, any>  // Parameter values
  skipLog?: boolean            // Skip console logging
}
```

**Response:**
```typescript
interface JscadMainResult {
  entities: Entity[]    // Rendered geometry (transferable)
  mainTime: number      // Script execution time (ms)
  convertTime: number   // Geometry conversion time (ms)
}
```

**Example:**
```javascript
const result = await workerApi.jscadMain({
  params: { size: 20, segments: 32 }
})
```

---

### jscadExportData

Export the current model in a specified format.

**Request:**
```typescript
interface ExportDataOptions {
  format: 'stla' | 'stlb' | 'amf' | 'json' | 'obj' | 'x3d' | 'svg' | '3mf'
  options?: Record<string, any>  // Format-specific options
}
```

**Response:**
```typescript
interface ExportResult {
  data: ArrayBuffer[]  // Exported data (transferable)
}
```

**Example:**
```javascript
const { data } = await workerApi.jscadExportData({ format: 'stlb' })
const blob = new Blob(data, { type: 'application/octet-stream' })
```

---

### jscadGetExportFormats

Get available export formats (dynamic menu support).

**Request:** None

**Response:**
```typescript
interface ExportFormatInfo {
  id: string        // Format identifier (e.g., 'stlb')
  label: string     // Display label (e.g., 'STL (binary)')
  extension: string // File extension (e.g., 'stl')
}[]
```

---

### jscadClearFileCache / jscadClearTempCache

Clear cached files or temporary data.

**Request:** `void` or `{ paths?: string[] }`

**Response:** `void`

## Entity Format

Geometry returned by the worker in a WebGL-ready format:

```typescript
interface MeshEntity {
  type: 'mesh'
  id: number                    // Unique geometry ID
  vertices: Float32Array        // [x,y,z, x,y,z, ...] (transferable)
  normals: Float32Array         // [nx,ny,nz, ...] (transferable)
  indices: Uint16Array | Uint32Array  // Triangle indices (transferable)
  color?: [r, g, b, a]          // RGBA 0-1
  colors?: Float32Array         // Per-vertex colors (transferable)
  isTransparent?: boolean       // Has transparency
  transforms?: number[]         // 4x4 transformation matrix
}

interface LineEntity {
  type: 'line'
  id: number
  vertices: Float32Array        // [x,y,z, x,y,z, ...] (transferable)
  color?: [r, g, b, a]
}

interface LinesEntity {
  type: 'lines'
  id: number
  vertices: Float32Array        // Line segment pairs (transferable)
  color?: [r, g, b, a]
}

interface InstanceEntity {
  type: 'instance'
  id: number
  originalId: number            // ID of the instanced geometry
  list: Array<{                 // Instance transforms
    color?: [r, g, b, a]
    transforms?: number[]
  }>
}
```

## Transferable Objects

For performance, large typed arrays are transferred (not copied) using the [Transferable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) mechanism:

- `Float32Array` (vertices, normals, colors)
- `Uint16Array` / `Uint32Array` (indices)
- `ArrayBuffer` (export data)

After transfer, the original buffer becomes unusable (zero-length). The `withTransferable()` helper attaches transfer metadata:

```javascript
// In worker
return withTransferable({ entities, mainTime }, [
  entities[0].vertices.buffer,
  entities[0].normals.buffer,
  entities[0].indices.buffer
])
```

## Error Handling

Errors thrown in handlers are serialized and propagated to the caller:

```javascript
// Worker handler throws
const jscadScript = async (options) => {
  if (!options.script && !options.url) {
    throw new Error('Either script or url required')
  }
  // ...
}

// Main thread receives
try {
  await workerApi.jscadScript({})
} catch (error) {
  console.error(error.message)  // 'Either script or url required'
  console.error(error.stack)    // Full stack trace from worker
}
```

## Timeout Handling

Requests can specify a timeout (in milliseconds):

```javascript
// Using initMessaging directly
const { sendCmd } = initMessaging(worker, handlers)
await sendCmd('jscadMain', [{ params }], null, 30000)  // 30s timeout
```

On timeout, the promise rejects with a timeout error and the request is cleaned up.

## Sequence Diagrams

### Script Loading Flow

```
Main Thread                          Worker
    │                                   │
    │──── jscadInit({bundles}) ────────►│
    │◄─────────── void ─────────────────│
    │                                   │
    │──── jscadScript({script}) ───────►│
    │                                   │ parse script
    │                                   │ extract params
    │                                   │ run main()
    │                                   │ convert to GL format
    │◄── {def, params, entities} ───────│
    │      (entities transferable)      │
    │                                   │
```

### Parameter Update Flow

```
Main Thread                          Worker
    │                                   │
    │──── jscadMain({params}) ─────────►│
    │                                   │ run main(params)
    │                                   │ convert to GL format
    │◄──────── {entities} ──────────────│
    │      (entities transferable)      │
    │                                   │
```

### Export Flow

```
Main Thread                          Worker
    │                                   │
    │── jscadExportData({format}) ─────►│
    │                                   │ serialize geometry
    │◄─────── {data: ArrayBuffer[]} ────│
    │         (data transferable)       │
    │                                   │
    │ create Blob                       │
    │ trigger download                  │
    │                                   │
```

## Usage Example

```javascript
import { messageProxy } from '@jscadui/postmessage'

// Create worker
const worker = new Worker('bundle.worker.js')

// Create typed proxy
/** @type {import('@jscadui/worker').JscadWorker} */
const workerApi = messageProxy(worker, {
  // Optional: handle worker-to-main notifications
  onProgress: (percent) => updateProgressBar(percent)
}, {
  onJobCount: (count) => showSpinner(count > 0)
})

// Initialize
await workerApi.jscadInit({
  bundles: { '@jscad/modeling': '/bundle.jscad-modeling.js' }
})

// Load script
const { def, params, entities } = await workerApi.jscadScript({
  script: myScript,
  url: 'my-model.js'
})

// Render entities to WebGL...
renderToCanvas(entities)

// Update with new parameters
const { entities: updated } = await workerApi.jscadMain({
  params: { ...params, size: 20 }
})

// Export
const { data } = await workerApi.jscadExportData({ format: 'stlb' })
downloadBlob(new Blob(data), 'model.stl')
```

## Related Documentation

- `packages/postmessage/README.md` - RPC utility documentation
- `packages/worker/worker.js` - Worker implementation with JSDoc types
- `packages/format-jscad/index.js` - Geometry conversion
- `packages/format-common/` - TypeScript type definitions
