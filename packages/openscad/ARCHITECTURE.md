# OpenSCAD Transpiler Architecture

## Overview

The OpenSCAD transpiler converts `.scad` files to JavaScript that can be executed by the JSCAD worker. This enables users to load OpenSCAD files directly in jscad.app without manual conversion.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                              UI                                   │
│                                                                   │
│   User loads file (model.scad or model.js)                       │
│                         │                                         │
│                         ▼                                         │
│              postMessage({ source, filename })                    │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                            Worker                                 │
│                                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   File Type Detection                     │   │
│   │                                                           │   │
│   │   filename.endsWith('.scad') → OpenSCAD path             │   │
│   │   filename.endsWith('.js')   → JavaScript path           │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                    │
│              ┌───────────────┴───────────────┐                   │
│              ▼                               ▼                    │
│   ┌─────────────────────┐         ┌─────────────────────┐       │
│   │   OpenSCAD Path     │         │   JavaScript Path   │       │
│   │                     │         │                     │       │
│   │  1. Parse .scad     │         │  1. Load JS module  │       │
│   │  2. Transpile to JS │         │  2. Execute main()  │       │
│   │  3. Cache result    │         │                     │       │
│   │  4. Execute main()  │         │                     │       │
│   └─────────────────────┘         └─────────────────────┘       │
│              │                               │                    │
│              └───────────────┬───────────────┘                   │
│                              ▼                                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Geometry Result                          │   │
│   │                                                           │   │
│   │   Return JSCAD geometry to UI for rendering              │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Module Resolution

When an OpenSCAD file uses `use <file.scad>`:

```
main.scad
    │
    ├── use <hardware.scad>
    │       │
    │       ├── use <threads.scad>
    │       └── use <fasteners.scad>
    │
    └── use <utils.scad>
```

The transpiler:

1. **Parses** the main file
2. **Discovers** `use` statements
3. **Recursively transpiles** each dependency
4. **Caches** transpiled files (single parse per file)
5. **Generates** proper `require()` statements

### Generated JavaScript

```javascript
// hardware.js (transpiled from hardware.scad)
const { Bolt, Nut } = require('./fasteners.js')
const { Thread } = require('./threads.js')

const HexBolt = (length = 20, diameter = 5) => {
  return union(
    Bolt(length, diameter),
    Thread(length)
  )
}

module.exports = { HexBolt }
```

```javascript
// main.js (transpiled from main.scad)
const { HexBolt } = require('./hardware.js')
const { double } = require('./utils.js')

const main = () => {
  return HexBolt(double(15))
}

module.exports = { main }
```

## Worker Integration

The worker's module loader is extended to handle `.scad` files:

```javascript
// In worker's require system
function require(path) {
  // Check cache first
  if (moduleCache.has(path)) {
    return moduleCache.get(path)
  }

  // Load source
  const source = loadFile(path)

  // Transpile if OpenSCAD
  let jsCode
  if (path.endsWith('.scad')) {
    const ast = parse(source)
    const result = transpile(ast, {
      fileResolver: loadFile,
      currentFile: path
    })
    jsCode = result.code
  } else {
    jsCode = source
  }

  // Evaluate and cache
  const module = evaluate(jsCode)
  moduleCache.set(path, module)
  return module
}
```

## Caching Strategy

### Phase 1: Source Code Caching (Current)

Cache transpiled JavaScript source code:

```javascript
Map<filename, {
  code: string,      // Transpiled JS source
  exports: string[]  // Exported symbol names
}>
```

Benefits:
- Simple to implement
- Easy to debug (can inspect generated code)
- Works with existing module system

### Phase 2: Evaluated Module Caching (Future)

Cache evaluated JavaScript modules:

```javascript
Map<filename, {
  module: { Bolt, Nut, ... },  // Actual functions
  exports: string[]
}>
```

Benefits:
- No re-parsing of generated JS
- Direct function calls
- Better performance for repeated loads

### Phase 3: Direct Evaluation (Future Optimization)

Skip JavaScript generation entirely:

```
.scad source → AST → evaluate → geometry
```

Benefits:
- No intermediate string generation
- Single-pass compilation + execution
- Optimal performance

## File Resolution

The transpiler supports multiple resolution strategies:

### Relative Paths
```openscad
use <./lib/hardware.scad>
use <../common/utils.scad>
```

### Library Paths (Future)
```openscad
use <MCAD/bearing.scad>
use <BOSL2/std.scad>
```

Libraries would be resolved from:
1. Project's `libraries/` folder
2. Global library path
3. Remote URLs (unpkg, etc.)

## Current Status

### Implemented
- [x] AST-to-JavaScript transpiler
- [x] Module definitions → exported functions
- [x] `use` statements → destructured `require()`
- [x] Multi-file transpilation with caching
- [x] OpenSCAD compatibility helpers (_cube, _cylinder, etc.)
- [x] Parameter preservation with defaults

### TODO
- [ ] Integrate transpiler into worker
- [ ] Hook into worker's require system
- [ ] File resolution for library paths
- [ ] `include` statement support (vs `use`)
- [ ] Error source mapping (.scad line numbers)
- [ ] Watch mode for development

## Testing

### CLI Test Harness

```bash
# Transpile single file
node bin/transpile-file.js model.scad

# Test with file resolver (multi-file)
node bin/test-transpile.js

# Run full test harness (compare with OpenSCAD output)
node bin/test-harness.js --corpus
```

### Test Corpus

Located in `test/corpus/`:
- Basic primitives (cube, sphere, cylinder)
- Boolean operations (union, difference, intersection)
- Transforms (translate, rotate, scale, mirror)
- Extrusions (linear_extrude, rotate_extrude)
- Complex CSG combinations
