# @jscadui/openscad

```
    .scad                      .js
  ┌─────────┐               ┌─────────┐
  │ cube(5);│ ─────────────►│ cube(5) │
  │         │   transpile   │         │
  │ sphere  │               │ sphere  │
  │ (r=10); │               │ ({r:10})│
  └─────────┘               └─────────┘
      ▲                          │
      │                          ▼
  OpenSCAD                   Browser
```

Transpiles OpenSCAD to JavaScript. Run `.scad` files directly in [jscad.app](https://jscad.app).

## Installation

```bash
npm install @jscadui/openscad
```

## Usage

```javascript
import { parse, transpile } from '@jscadui/openscad'

const scad = `
  module gear(teeth = 12, radius = 10) {
    cylinder(r = radius, h = 5);
  }
  gear(teeth = 24);
`

const ast = parse(scad)
const { code } = transpile(ast)
// → JavaScript with JSCAD imports, ready to execute
```

### Multi-file Projects

```javascript
const result = transpile(ast, {
  currentFile: 'main.scad',
  fileResolver: async (path) => {
    // Return source code for `use <path>` statements
    return await readFile(path)
  }
})

// result.transpiledFiles contains all resolved dependencies
```

## CLI Tools

```bash
# Transpile a file
npx scad2jscad model.scad > model.js

# Execute and export to STL
npx run-jscad model.scad -o model.stl

# Compare two STL files (Jaccard similarity)
npx compare-stl expected.stl actual.stl

# Run test corpus
npx test-harness test/corpus/
```

## What Works

| Feature | Status |
|---------|--------|
| Primitives (`cube`, `sphere`, `cylinder`, `polyhedron`) | ✓ |
| 2D shapes (`circle`, `square`, `polygon`) | ✓ |
| Booleans (`union`, `difference`, `intersection`) | ✓ |
| Transforms (`translate`, `rotate`, `scale`, `mirror`, `multmatrix`) | ✓ |
| Extrusions (`linear_extrude`, `rotate_extrude`) | ✓ |
| Hulls (`hull`, `minkowski`) | ✓ |
| Modules & Functions | ✓ |
| `use` / `include` statements | ✓ |
| Special variables (`$fn`, `$fa`, `$fs`) | ✓ |
| BOSL library | ✓ |

## What Doesn't (Yet)

| Feature | Reason |
|---------|--------|
| `text()` | Needs font rendering |
| `import()` | STL/DXF loading not implemented |
| `surface()` | Heightmap loading not implemented |
| `offset()` | 2D offset not implemented |
| `projection()` | 3D→2D projection not implemented |

## Test Results

```
Corpus:  246/246 passing
BOSL:    119/119 passing
```

## How It Works

1. **Parse** → AST via [openscad-parser](https://github.com/openscad/openscad-parser)
2. **Resolve** → Recursively transpile `use`/`include` dependencies
3. **Transpile** → Convert AST to JavaScript with JSCAD imports
4. **Execute** → Run in browser via [@jscadui/worker](../worker)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture.

## License

MIT
