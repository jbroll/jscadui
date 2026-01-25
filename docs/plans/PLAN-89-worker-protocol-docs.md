# Plan: Document Worker Communication Protocol (#89)

## Overview
Create formal documentation for the worker communication protocol.

## Documentation Structure

### 1. Protocol Overview
- Purpose and design goals
- Architecture diagram
- Message flow

### 2. Message Types

#### jscadInit
Initialize the worker with configuration.

```typescript
// Request
{
  type: 'jscadInit',
  id: number,
  payload: {
    bundles?: Record<string, string>,  // Package URL mappings
    alias?: Array<{ match: RegExp, alias: string }>,  // Path aliases
  }
}

// Response
{
  type: 'jscadInit',
  id: number,
  result: {
    success: boolean
  }
}
```

#### jscadScript
Load and execute a JSCAD script.

```typescript
// Request
{
  type: 'jscadScript',
  id: number,
  payload: {
    script?: string,   // Inline script content
    url?: string,      // URL to load script from
    base?: string,     // Base URL for relative imports
    root?: string      // Root path for file resolution
  }
}

// Response
{
  type: 'jscadScript',
  id: number,
  result: {
    def?: ParameterDefinitions,  // Parameter definitions from getParameterDefinitions()
    entities?: Entity[]          // Rendered geometry
  }
}
```

#### jscadMain
Re-run script with new parameters.

```typescript
// Request
{
  type: 'jscadMain',
  id: number,
  payload: {
    params: Record<string, any>
  }
}

// Response
{
  type: 'jscadMain',
  id: number,
  result: {
    entities: Entity[]
  }
}
```

#### jscadExportData
Export model in specified format.

```typescript
// Request
{
  type: 'jscadExportData',
  id: number,
  payload: {
    format: 'stla' | 'stlb' | 'amf' | 'obj' | 'x3d' | 'svg' | '3mf' | 'json'
  }
}

// Response
{
  type: 'jscadExportData',
  id: number,
  result: {
    data: ArrayBuffer | string | ArrayBuffer[]
  }
}
```

### 3. Entity Format
Document the geometry format returned by the worker.

```typescript
interface Entity {
  type: 'mesh' | 'line' | 'points',
  vertices: Float32Array,   // [x,y,z, x,y,z, ...]
  normals?: Float32Array,   // [nx,ny,nz, ...]
  indices?: Uint32Array,    // Triangle indices
  color?: [r, g, b, a],     // RGBA 0-1
  // ... additional properties
}
```

### 4. Error Handling
- Error message format
- Error codes
- Recovery strategies

### 5. Transfer Objects
- Which objects use Transferable
- Memory ownership rules
- Performance implications

## Implementation Steps

### Phase 1: Document Current Behavior (4 hours)
1. [ ] Read worker.js and document all message handlers
2. [ ] Document postmessage wrapper behavior
3. [ ] Create TypeScript interfaces for all message types

### Phase 2: Write Documentation (3-4 hours)
1. [ ] Create `docs/WORKER_PROTOCOL.md`
2. [ ] Add sequence diagrams
3. [ ] Add code examples

### Phase 3: Type Definitions (2-3 hours)
1. [ ] Create/update `.d.ts` files
2. [ ] Ensure types match documentation
3. [ ] Add JSDoc comments to source

### Phase 4: Examples (2 hours)
1. [ ] Add usage examples
2. [ ] Document common patterns
3. [ ] Document error handling patterns

## Output Files
- `docs/WORKER_PROTOCOL.md` - Main documentation
- `packages/worker/types.d.ts` - TypeScript definitions
- Update `CLAUDE.md` with protocol summary

## Estimated Total Effort
10-12 hours
