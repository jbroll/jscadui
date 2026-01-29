# Manifold Worker Implementation Plan

## Current Architecture

```
User Script (requires @jscad/modeling)
    ↓
Worker (packages/worker/worker.js)
    ↓ require() via packages/require
Bundle Alias: '@jscad/modeling' → './build/bundle.jscad_modeling.js'
    ↓
@jscad/modeling (BSP-based booleans - BROKEN)
    ↓
geom3/geom2 objects
    ↓
JscadToCommon (packages/format-jscad)
    ↓
WebGL-ready format (vertices, indices, normals)
```

## Problem

JSCAD's BSP-based boolean operations produce non-manifold geometry:
- `subtract(cube, cylinder)` → 290+ non-manifold edges
- Swiss Cheese (20 holes) → 3090 non-manifold edges
- Tests skip validation because they know it fails

## Proposed Architecture

```
User Script (requires '@jscad/modeling')
    ↓
Worker (unchanged)
    ↓ require() via packages/require
Bundle Alias: '@jscad/modeling' → './build/bundle.manifold_modeling.js'
    ↓
@jscadui/manifold-modeling (NEW - Manifold WASM)
    ↓
Manifold objects (internal) → geom3 (output)
    ↓
JscadToCommon (unchanged)
    ↓
WebGL-ready format
```

## Implementation Strategy

### Hybrid Approach (Recommended)

Use Manifold for operations with direct 1-to-1 mappings. For everything else, use the original @jscad/modeling implementation and convert to/from Manifold format.

**Core principle:**
- Manifold-native for: primitives, booleans, basic transforms, extrusions
- JSCAD fallback for: hull, expand, offset, slice, text, complex operations
- Conversion functions bridge between formats

**Advantages:**
- Get guaranteed-manifold booleans (the critical fix)
- Don't reimplement complex algorithms that already work
- Incremental migration - move more ops to Manifold over time
- Full API compatibility from day one

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│                  @jscadui/manifold-modeling             │
├─────────────────────────────────────────────────────────┤
│  Manifold-native          │  JSCAD fallback + convert   │
│  ─────────────────        │  ─────────────────────────  │
│  • cube, cuboid           │  • hull, hullChain          │
│  • sphere, cylinder       │  • expand, offset           │
│  • union, subtract        │  • slice, project           │
│  • intersect              │  • text                     │
│  • translate, rotate      │  • measureArea (2D)         │
│  • scale, mirror          │  • complex paths            │
│  • extrudeLinear          │  • ...anything else         │
│  • extrudeRotate          │                             │
├─────────────────────────────────────────────────────────┤
│              Conversion Layer                           │
│  ─────────────────────────────────────────────────────  │
│  • geom3ToManifold(geom3) → Manifold                   │
│  • manifoldToGeom3(manifold) → geom3                   │
│  • geom2ToCrossSection(geom2) → CrossSection           │
│  • crossSectionToGeom2(cs) → geom2                     │
└─────────────────────────────────────────────────────────┘
```

**Conversion functions:**

```javascript
// geom3 → Manifold (for JSCAD fallback results entering Manifold ops)
const geom3ToManifold = (geom3) => {
  const polygons = geom3.polygons;
  // Triangulate and build indexed mesh
  const vertices = [];
  const triVerts = [];
  // ... triangulation logic
  return new Manifold(new Mesh({ vertProperties, triVerts, numProp: 3 }));
};

// Manifold → geom3 (for output or entering JSCAD fallback ops)
const manifoldToGeom3 = (manifold) => {
  const mesh = manifold.getMesh();
  const polygons = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    polygons.push({
      vertices: [
        Array.from(mesh.position(mesh.triVerts[i])),
        Array.from(mesh.position(mesh.triVerts[i+1])),
        Array.from(mesh.position(mesh.triVerts[i+2]))
      ]
    });
  }
  return geom3.create(polygons);
};
```

**Example: hull operation (JSCAD fallback)**

```javascript
// src/hulls/hull.js
import { hull as jscadHull } from '@jscad/modeling/hulls';
import { geom3ToManifold, manifoldToGeom3 } from '../conversions';

export const hull = (...objects) => {
  // Convert any Manifold objects to geom3
  const geom3Objects = objects.flat().map(obj =>
    obj._manifold ? manifoldToGeom3(obj._manifold) : obj
  );

  // Use JSCAD's hull implementation
  const result = jscadHull(geom3Objects);

  // Convert back to Manifold for consistent output
  return new ManifoldGeom3(geom3ToManifold(result));
};
```

**When to convert:**

| Scenario | Action |
|----------|--------|
| Manifold op receives JSCAD geom3 | Convert input to Manifold |
| JSCAD op receives ManifoldGeom3 | Convert input to geom3 |
| Final output for rendering | Lazy convert via `polygons` getter |
| Between two Manifold ops | No conversion needed |
| Between two JSCAD ops | No conversion needed |

---

## Conversion Layer (Critical Component)

The conversion layer enables seamless mixing of Manifold-native and JSCAD-fallback operations.

### geom3 → Manifold

```javascript
// src/conversions/geom3ToManifold.js
import { getManifold } from '../init.js';

export const geom3ToManifold = (geom3) => {
  const { Manifold, Mesh } = getManifold();
  const polygons = geom3.polygons;

  // Build indexed triangle mesh
  const vertexMap = new Map();
  const vertices = [];
  const triVerts = [];

  const addVertex = (v) => {
    const key = `${v[0].toFixed(9)},${v[1].toFixed(9)},${v[2].toFixed(9)}`;
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertices.length / 3);
      vertices.push(v[0], v[1], v[2]);
    }
    return vertexMap.get(key);
  };

  for (const poly of polygons) {
    const verts = poly.vertices;
    // Fan triangulation for n-gons
    for (let i = 1; i < verts.length - 1; i++) {
      triVerts.push(
        addVertex(verts[0]),
        addVertex(verts[i]),
        addVertex(verts[i + 1])
      );
    }
  }

  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(triVerts)
  });

  return new Manifold(mesh);
};
```

### Manifold → geom3

```javascript
// src/conversions/manifoldToGeom3.js
import { geom3 } from '@jscad/modeling/geometries';

export const manifoldToGeom3 = (manifold) => {
  const mesh = manifold.getMesh();
  const polygons = [];

  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    polygons.push({
      vertices: [
        Array.from(mesh.position(mesh.triVerts[i])),
        Array.from(mesh.position(mesh.triVerts[i + 1])),
        Array.from(mesh.position(mesh.triVerts[i + 2]))
      ]
    });
  }

  return geom3.create(polygons);
};
```

### Smart Wrapper Pattern

```javascript
// Helper to accept either ManifoldGeom3 or plain geom3
const toManifold = (obj) => {
  if (obj._manifold) return obj._manifold;  // Already Manifold
  return geom3ToManifold(obj);              // Convert from JSCAD
};

const toGeom3 = (obj) => {
  if (obj._manifold) return manifoldToGeom3(obj._manifold);
  return obj;  // Already geom3
};

// Usage in JSCAD fallback:
export const hull = (...objects) => {
  const geom3Inputs = objects.flat().map(toGeom3);
  const result = jscadHull(geom3Inputs);
  return new ManifoldGeom3(geom3ToManifold(result));
};
```

---

## Detailed Plan

### Phase 1: Core Package Structure

Create `packages/manifold-modeling/`:

```
packages/manifold-modeling/
├── package.json
├── src/
│   ├── index.js              # Main exports (mirrors @jscad/modeling)
│   ├── init.js               # WASM initialization
│   ├── primitives/
│   │   ├── index.js
│   │   ├── cube.js
│   │   ├── cuboid.js
│   │   ├── sphere.js
│   │   ├── cylinder.js
│   │   ├── torus.js
│   │   └── ...
│   ├── booleans/
│   │   ├── index.js
│   │   ├── union.js
│   │   ├── subtract.js
│   │   └── intersect.js
│   ├── transforms/
│   │   ├── index.js
│   │   ├── translate.js
│   │   ├── rotate.js
│   │   ├── scale.js
│   │   └── ...
│   ├── extrusions/
│   │   ├── index.js
│   │   ├── extrudeLinear.js
│   │   └── extrudeRotate.js
│   ├── geometries/
│   │   ├── geom3.js          # Wrapper/conversion
│   │   └── geom2.js          # Uses CrossSection
│   └── conversions/
│       ├── toGeom3.js        # Manifold → geom3
│       └── fromGeom3.js      # geom3 → Manifold (if needed)
```

### Phase 2: WASM Initialization

```javascript
// src/init.js
import Module from 'manifold-3d';

let wasm = null;
let initPromise = null;

export const initManifold = async () => {
  if (wasm) return wasm;
  if (initPromise) return initPromise;

  initPromise = Module().then(m => {
    m.setup();
    wasm = m;
    return wasm;
  });

  return initPromise;
};

export const getManifold = () => {
  if (!wasm) throw new Error('Manifold not initialized. Call initManifold() first.');
  return wasm;
};
```

### Phase 3: Geometry Wrapper

```javascript
// src/geometries/ManifoldGeom3.js

// Internal class that wraps Manifold objects but presents geom3-like interface
export class ManifoldGeom3 {
  constructor(manifold) {
    this._manifold = manifold;
    this._geom3Cache = null;  // Lazy conversion
  }

  // Called by JscadToCommon when it sees 'polygons' property
  get polygons() {
    if (!this._geom3Cache) {
      this._geom3Cache = this._toPolygons();
    }
    return this._geom3Cache;
  }

  _toPolygons() {
    const mesh = this._manifold.getMesh();
    const polygons = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      polygons.push({
        vertices: [
          Array.from(mesh.position(mesh.triVerts[i])),
          Array.from(mesh.position(mesh.triVerts[i + 1])),
          Array.from(mesh.position(mesh.triVerts[i + 2]))
        ]
      });
    }
    return polygons;
  }

  // For transforms - identity matrix, actual transform is in Manifold
  get transforms() {
    return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  }

  // Memory management
  delete() {
    if (this._manifold) {
      this._manifold.delete();
      this._manifold = null;
    }
  }
}
```

### Phase 4: Primitives

```javascript
// src/primitives/cuboid.js
import { getManifold } from '../init.js';
import { ManifoldGeom3 } from '../geometries/ManifoldGeom3.js';

export const cuboid = (options = {}) => {
  const { Manifold } = getManifold();
  const { size = [2, 2, 2], center = [0, 0, 0] } = options;

  const s = typeof size === 'number' ? [size, size, size] : size;
  let m = Manifold.cube(s, true);

  if (center[0] !== 0 || center[1] !== 0 || center[2] !== 0) {
    const translated = m.translate(center);
    m.delete();
    m = translated;
  }

  return new ManifoldGeom3(m);
};
```

### Phase 5: Booleans

```javascript
// src/booleans/subtract.js
import { getManifold } from '../init.js';
import { ManifoldGeom3 } from '../geometries/ManifoldGeom3.js';

export const subtract = (...objects) => {
  const { Manifold } = getManifold();
  const flat = objects.flat();

  if (flat.length === 0) return new ManifoldGeom3(Manifold.cube([0,0,0], true));
  if (flat.length === 1) return flat[0];

  let result = flat[0]._manifold;

  for (let i = 1; i < flat.length; i++) {
    const newResult = result.subtract(flat[i]._manifold);
    if (i > 0) result.delete();  // Don't delete first (owned by input)
    result = newResult;
  }

  return new ManifoldGeom3(result);
};
```

### Phase 6: Transforms

```javascript
// src/transforms/translate.js
import { ManifoldGeom3 } from '../geometries/ManifoldGeom3.js';

export const translate = (offset, ...objects) => {
  return objects.flat().map(obj => {
    const translated = obj._manifold.translate(offset);
    // Don't delete original - user might still reference it
    return new ManifoldGeom3(translated);
  });
};
```

### Phase 7: 2D Operations (CrossSection)

```javascript
// src/geometries/ManifoldGeom2.js
export class ManifoldGeom2 {
  constructor(crossSection) {
    this._crossSection = crossSection;
    this._sidesCache = null;
  }

  get sides() {
    if (!this._sidesCache) {
      this._sidesCache = this._toSides();
    }
    return this._sidesCache;
  }

  _toSides() {
    const polygons = this._crossSection.toPolygons();
    const sides = [];
    for (const poly of polygons) {
      for (let i = 0; i < poly.length; i++) {
        sides.push([poly[i], poly[(i + 1) % poly.length]]);
      }
    }
    return sides;
  }
}
```

### Phase 8: Extrusions

```javascript
// src/extrusions/extrudeLinear.js
export const extrudeLinear = (options, geometry) => {
  const { height = 1, twist = 0, slices = 1 } = options;

  if (geometry._crossSection) {
    // 2D → 3D via CrossSection.extrude
    const manifold = geometry._crossSection.extrude(
      height,
      slices,
      twist * 180 / Math.PI,  // Convert radians to degrees
      [1, 1],
      false
    );
    return new ManifoldGeom3(manifold);
  }

  throw new Error('extrudeLinear requires 2D geometry');
};
```

---

## Code Reuse Analysis

### Can Reuse (unchanged):

| Component | Location | Notes |
|-----------|----------|-------|
| Worker core | `packages/worker/worker.js` | Script execution, params, exports |
| Require system | `packages/require/` | Module loading unchanged |
| Format conversion | `packages/format-jscad/` | Works with any object that has `polygons` |
| PostMessage | `packages/postmessage/` | RPC layer unchanged |
| Params system | `packages/params-*/` | Parameter handling unchanged |
| Renderers | `packages/render-*/` | WebGL rendering unchanged |
| Exporters | `file-format/3mf/` | Works with format-jscad output |

### Needs Adaptation:

| Component | Changes Needed |
|-----------|----------------|
| Bundle | New `bundle.manifold_modeling.js` |
| Worker init | Initialize Manifold WASM before script execution |

### Replace:

| Component | Replacement |
|-----------|-------------|
| `@jscad/modeling` | `@jscadui/manifold-modeling` |

---

## Bundle Configuration

```javascript
// apps/jscad-web/src_bundle/bundle.manifold_modeling.js
export * from '@jscadui/manifold-modeling'
```

```javascript
// apps/jscad-web/main.js (modified)
bundles: {
  '@jscad/modeling': toUrl('./build/bundle.manifold_modeling.js'),
}
```

---

## Memory Management Strategy

Manifold WASM objects must be manually deleted. Options:

### Option 1: Reference Counting (Complex)
Track all references to each Manifold object, delete when count reaches 0.

### Option 2: Batch Cleanup (Recommended)
- Track all Manifold objects created during `main()` execution
- Delete all after conversion to geom3 polygons
- Clear tracking after each `jscadMain()` call

```javascript
// src/tracking.js
let currentBatch = new Set();

export const track = (manifoldGeom) => {
  currentBatch.add(manifoldGeom);
  return manifoldGeom;
};

export const cleanupBatch = () => {
  for (const geom of currentBatch) {
    geom.delete();
  }
  currentBatch.clear();
};
```

### Option 3: Lazy Deletion (Simplest)
- Only delete intermediate results in operations
- Let WASM memory grow, rely on page refresh for cleanup
- Acceptable for interactive use

---

## API Coverage Checklist

### Manifold-Native (Implement from scratch)

| Category | Function | Manifold API |
|----------|----------|--------------|
| Primitives | cube, cuboid | `Manifold.cube()` |
| | sphere | `Manifold.sphere()` |
| | cylinder | `Manifold.cylinder()` |
| | torus | Compose from revolve |
| | polygon (2D) | `CrossSection()` |
| | circle (2D) | `CrossSection.circle()` |
| | square (2D) | `CrossSection.square()` |
| Booleans | union | `Manifold.union()` |
| | subtract | `manifold.subtract()` |
| | intersect | `Manifold.intersection()` |
| Transforms | translate | `manifold.translate()` |
| | rotate | `manifold.rotate()` |
| | scale | `manifold.scale()` |
| | mirror | `manifold.mirror()` |
| Extrusions | extrudeLinear | `crossSection.extrude()` |
| | extrudeRotate | `crossSection.revolve()` |
| Measurements | boundingBox | `manifold.boundingBox()` |

### JSCAD Fallback (Re-export with conversion wrapper)

| Category | Function | Notes |
|----------|----------|-------|
| Transforms | center, align | Use JSCAD, convert in/out |
| Hulls | hull, hullChain | Use JSCAD, convert in/out |
| Expansions | expand, offset | Use JSCAD, convert in/out |
| Modifiers | slice, project | Use JSCAD, convert in/out |
| Text | text, vectorText | Use JSCAD, convert in/out |
| Measurements | measureArea (2D) | Use JSCAD directly |
| Colors | colorize | Pass through (metadata only) |
| Utils | degToRad, radToDeg | Pass through (pure functions) |

### Pass-Through (No geometry, just re-export)

```javascript
// These don't touch geometry, just re-export from @jscad/modeling
export { degToRad, radToDeg } from '@jscad/modeling/utils';
export { colorize, hexToRgb, hslToRgb } from '@jscad/modeling/colors';
export { maths } from '@jscad/modeling';  // vec2, vec3, mat4, etc.
```

---

## Testing Strategy

1. **Unit tests per function** - Compare output to known-good results
2. **Validation tests** - Every output must pass `geom3.validate()`
3. **Benchmark comparison** - Run existing benchmarks with both backends
4. **Visual regression** - Render outputs must match (within tolerance)

---

## Migration Path

### Phase 1: Parallel Implementation
- Build manifold-modeling alongside existing
- Add feature flag to switch backends
- Test with existing examples

### Phase 2: Opt-in Testing
- Let users test Manifold backend
- Collect feedback on compatibility

### Phase 3: Default Switch
- Make Manifold the default
- Keep JSCAD backend as fallback

### Phase 4: Deprecation
- Remove JSCAD backend
- Simplify codebase

---

## Estimated Effort

### With Hybrid Approach (JSCAD fallback for complex ops)

| Phase | Effort | Notes |
|-------|--------|-------|
| Package setup | 0.5 day | Structure, build config |
| Conversion layer | 1 day | geom3↔Manifold, geom2↔CrossSection |
| Core primitives | 1 day | cube, sphere, cylinder (direct mapping) |
| Booleans | 0.5 day | union, subtract, intersect (direct mapping) |
| Basic transforms | 0.5 day | translate, rotate, scale, mirror |
| 2D primitives | 0.5 day | circle, square, polygon via CrossSection |
| Extrusions | 0.5 day | extrudeLinear, extrudeRotate |
| JSCAD fallback wrappers | 1 day | hull, expand, etc. with conversion |
| Pass-through exports | 0.5 day | colors, maths, utils |
| Memory management | 0.5 day | Batch cleanup after main() |
| Worker integration | 0.5 day | WASM init, bundle config |
| Testing | 1 day | Validation, existing benchmarks |
| **Total** | **~1 week** | Much faster with hybrid approach |

### Risk Factors

| Risk | Mitigation |
|------|------------|
| Conversion overhead | Profile; only convert at boundaries |
| Missing API functions | JSCAD fallback catches all |
| WASM init delay | Pre-init in worker startup |
| Memory leaks | Batch cleanup; document for users |

---

## Open Questions

1. **Async initialization**: Manifold WASM loads async. How to handle scripts that immediately use primitives?
   - Option: Pre-initialize in worker before accepting scripts
   - Option: Make all primitives async

2. **Color/material support**: How to preserve vertex colors through Manifold operations?
   - Manifold supports `numProp > 3` for extra vertex data

3. **2D boolean consistency**: Does CrossSection handle all geom2 edge cases?

4. **Performance**: Is the Manifold overhead worth it for simple non-boolean operations?
   - Consider: Only use Manifold for booleans, keep JSCAD for primitives?
