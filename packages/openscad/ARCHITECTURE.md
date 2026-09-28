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

### `include`

`include <file.scad>` inlines the file's constants, functions and modules
into the including file (`processIncludeStatements`, `createBundledParts`),
except a file of only functions and modules, which becomes a `require()` like
`use`. OpenSCAD pastes an include's text in at the include line, so constants
are written out in source order across includes: a local assignment above
an include comes before the included constants, and one below comes after.
BOSL2 depends on this. `std.scad` sets `_BOSL2_STD` and then includes files
whose guards test it. When a name is assigned both in the file and in an
include, the file's value takes the included assignment's position (last
value at first position).

### Tail recursion

A function that calls itself in tail position (`tailCall.ts`) compiles to a
`while (true)` loop: the tail call returns a bounce object, and the loop
rebinds the parameters and goes round again, so the recursion uses no stack.
Because a recursion that never ends then never overflows either, the loop
stops after `j$.TAIL_CALL_LIMIT` (1,000,000) iterations with OpenSCAD's
`Recursion detected calling function '<name>'`. That is OpenSCAD's own limit,
and OpenSCAD counts at least one step per tail call, so the cap never rejects a
model OpenSCAD runs. Mutual recursion is not converted; see
`docs/design/mutual-tail-calls-trial.md` for why.

### Undefined symbols

A `.scad` file may legally call a module or function that is never defined;
OpenSCAD warns and renders nothing. So after generating a file, the transpiler
scans it for bare `foo_$m` / `foo_$f` references and declares a no-op `var` for
any that nothing in the file declares, which keeps the JS valid. Both the
references and the declarations are collected in single passes: with a library
bundled in, the generated file is megabytes, and scanning it once per
referenced name was 90% of what a transpile cost.

### Freeing intermediate geometry

The runtime's booleans, hulls, minkowski, transforms, extrusions, `offset`
and `color` (`openscad-runtime/src/consume.js`) delete the Manifold handle of
every `ManifoldGeom3` or `ManifoldGeom2` input they did not return. Each
wrapper owns one handle and otherwise frees it only from a
`FinalizationRegistry`. Finalizers cannot run while a synchronous `main()`
holds the thread, so every intermediate CSG result stayed in the 4 GB WASM
heap until the model finished. Manifold's transforms and 3D booleans free the
temporary handle they make from a plain jscad geometry. Eager disposal is safe
because OpenSCAD has no geometry values: generated code passes each geometry
to exactly one op, and `children()` re-runs its thunk rather than reusing a
result. The
2D minkowski sweep for jscad `geom2`, which does reuse its operands, calls the
unwrapped ops. On the jscad engine the inputs are plain objects and nothing is
freed.

### 2D booleans

`union`, `difference` and `intersection` of `geom2` run in the modeling fork
on `clipper-lib` (Clipper 1) over integer coordinates scaled by 1e9. The
manifold runtime uses the same code for any operand built from a jscad geom2
(`hasJscadSource` in `packages/manifold/src/booleans/index.js`). The fork used
to extrude each operand into an open prism, run the 3D BSP boolean and read the
walls back. The BSP splits against an absolute `EPS` of 1e-5, so parallel walls
closer than that were dropped, and 25 models got outlines that did not close.

The floating-point sweep-line clippers were tried first and each throws
"Unable to complete output ring" on inputs from the example corpus:
`polygon-clipping` on `heart2heart_maze.scad` and `fidget_boo.scad`, its fork
`polyclip-ts` on `pin_headers.scad`, `maze_yinyan.scad`, `forest.scad`,
`voronoi_penholder.scad` and three more. Clipper decides every one of them;
the failing calls are kept as fixtures in the fork's tests.

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

## Preview modifiers (`%` and `#`)

`%child` and `#child` transpile to `j$.background(child)` and
`j$.highlight(child)`. `overlay.js` in `@jscadui/openscad-runtime` keeps
overlay records (`{ kind, mesh, matrix }`) in a `WeakMap` keyed by the result
geometry, so a value carries its ghosts without changing shape. The
transforms (translate, rotate, scale, mirror, multmatrix, resize) compose
their matrix onto the overlays they receive. `safeUnion`, `union`,
`subtract`, `intersect`, `hull`, `minkowski`, `color`, `offset` and the
extrusions gather the overlays off their inputs; `children()` passes them
through. Ops outside
that set drop overlays; a test in `test/preview-overlays.test.ts` fails when a
new `j$` function is not classified.

`background()` snapshots the child's own geometry into an overlay and returns
a `Ghosts` placeholder holding it (plus any overlays the child already
carried), so the geometry itself does not propagate downstream. OpenSCAD
skips a `%` node only where it is a direct child, so a bare `Ghosts` from
`background()` is absent (`strip()` gives `NO_CHILD`), while a `Ghosts` that
comes out of any op is empty (`strip()` gives `undefined`):
`intersection(){ cube(10); translate([20,0,0]) %sphere(1); }` is empty.
Nodes that pass their child through unchanged mark it empty with `j$.group`:
`if`, `let`, `echo` and `assert` whose child can be a bare `%` statement, and a
module whose single statement is one, including a nested `{ }` block around it
or a `children()` call that may be handed a `%` child. `subtract` takes its
subject from the first child that is not a bare `Ghosts`, so
`difference(){ %cube(20); cube(10); sphere(6); }` cuts `cube(10)`.
`background()` returns a `Ghosts` even when the child is absent or empty and
there is nothing to draw, so `difference(){ %if (false) cube(20); cube(10); }`
still skips it and keeps `cube(10)`.

`main()` ends with `j$.withOverlays`, which turns the collected overlay
records into ghost geometry alongside the real result, merged into at most
one 3D and one 2D ghost per kind so a loop of `#` children stays under the
viewport's entity cap. It never reads `$preview`.

## Current Status

### Implemented
- [x] AST-to-JavaScript transpiler
- [x] Module definitions → exported functions
- [x] `use` statements → destructured `require()`
- [x] Multi-file transpilation with caching
- [x] OpenSCAD compatibility helpers (_cube, _cylinder, etc.)
- [x] Parameter preservation with defaults
- [x] `include` statements, bundled in source order

### TODO
- [ ] Integrate transpiler into worker
- [ ] Hook into worker's require system
- [ ] File resolution for library paths
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
