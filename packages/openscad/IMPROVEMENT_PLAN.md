# OpenSCAD Translator Improvement Plan

## Current Status

**Test Results (2025-02):**
- Built-in corpus: 19/19 passing (100%) with `--fn 48`
- OpenSCAD-Snippet library: 98/110 passing (89.1%) at 0.99 Jaccard threshold
- 0 transpiler errors, 12 geometry mismatches, 5 OpenSCAD-side failures

## Architecture

The translator uses a **transpile-to-JavaScript** approach:
1. Parse OpenSCAD with `openscad-parser`
2. Transpile AST to JavaScript that uses `@jscad/modeling` API
3. Execute with Manifold backend for CSG operations

Key files:
- `src/transpiler/transpile.ts` - Main transpiler
- `bin/run-jscad.js` - CLI executor with integrated transpiler
- `bin/test-harness.js` - Fidelity testing against OpenSCAD

## Recently Fixed

### Session 2025-02-07:
- **Trig functions degrees/radians** - OpenSCAD uses degrees, JS uses radians. Added conversion for sin/cos/tan/asin/acos/atan/atan2 (fixes Gear_01, Gear_02, +6 models)
- **extrudeRotate negative X profiles** - Manifold's revolve() requires X > 0; mirror profiles with X ≤ 0 before revolving (fixes Shaft_01, Shaft_02_With_Keyway)
- **Deeply nested modules** - Recursive module handling for modules inside modules (fixes Cup_01, Key_Old_01)
- **echo() support** - Transpiles to `console.log()` for debugging (fixes Beam_T, Display_Seven_Segments)
- **translate in _linearExtrude** - Added translate to imports when linear_extrude is used (fixes Beam_C)
- **Top-level assignments** - `x = 5;` at file scope now works in main() (fixes Sign_01-03)
- **Assignments in boolean blocks** - Variables inside difference/union/intersection wrapped in IIFE (fixes Flange models)

### Previous sessions:
- **Math functions** - Added `sign`, `norm`, `cross`, `lookup`, `rands`
- **Special variables $preview, $t** - `$preview` returns false, `$t` returns 0
- **Regular polygon primitive** - `regular_polygon(n, r)` using `circle({ radius, segments })`
- **Minkowski operation** - Transpile `minkowski()` to JSCAD/Manifold
- **Polygon winding order** - Auto-detect and normalize CCW winding for Manifold
- **For loops** - `for (i = [0:10]) body` → `union(..._range(0, 10).map(i => body))`
- **Nested modules** - Modules inside modules hoisted as local functions
- **Local variables** - `x = 5;` inside modules → `const x = 5`
- **Scoped variables** - Variables in nested blocks use IIFE for proper scoping
- **Positional extrusion params** - `linear_extrude(2)` → `{ height: 2 }`
- **Hull children** - Pass children as separate args, not wrapped in union
- **Global $fn** - `--fn` option for both OpenSCAD and transpiler

---

## Remaining Failures (12 models)

### Category 1: Expected/Unfixable (2 models)
| Model | Jaccard | Issue |
|-------|---------|-------|
| Bricks.scad | 0.64 | Uses `rands()` - different geometry each run |
| Pendulum.scad | 0.30 | Invalid `sphere([array])` syntax in source |

### Category 2: Thin Geometry Precision (3 models)
| Model | Jaccard | Issue |
|-------|---------|-------|
| Wood_Crate.scad | 0.75 | Uses 0.01-thick cubes - CSG precision differs |
| Ingot_01.scad | 0.81 | Thin geometry precision issues |
| Tree_01.scad | 0.89 | Geometry differences - needs investigation |

### Category 3: Near-Passing - Algorithm Differences (7 models)
| Model | Jaccard | Notes |
|-------|---------|-------|
| Tower.scad | 0.98 | Tessellation differences |
| Abacus.scad | 0.98 | Minor geometry differences |
| Fireplace_01.scad | 0.95 | Algorithm differences |
| Weights_01.scad | 0.95 | Tessellation differences |
| Pipe_90.scad | 0.94 | Curved surface tessellation |
| Sword_01.scad | 0.94 | Complex CSG differences |
| Pipe_45.scad | 0.93 | Curved surface tessellation |

---

## Unsupported Constructs

**Not yet supported:**
- `text()` module (requires font rendering)
- `import()` for STL/OFF files
- `surface()` for heightmaps
- `children()` for module children access
- `$children` special variable
- Complex list comprehensions with multiple variables

---

## Implementation Priority

### Completed
1. ~~Add missing special variables: `$preview`, `$t`~~ ✓
2. ~~Add missing math functions (rands, norm, cross, lookup, sign)~~ ✓
3. ~~Fix transpiler syntax errors~~ ✓ (0 remaining)
4. ~~Fix trig functions degrees/radians~~ ✓
5. ~~Fix extrudeRotate for negative X profiles~~ ✓

### Future Work
1. Add `children()` support for module children access
2. Improve thin geometry handling
3. Add `text()` support (complex - needs font system)
4. Add `import()` for external files

## Running Tests

### NPM Scripts (Recommended)

```bash
# Test built-in corpus (should be 100%)
npm run test:corpus

# Test OpenSCAD-Snippet library (default: ~/src/OpenSCAD-Snippet)
npm run test:fidelity

# Use custom location for OpenSCAD-Snippet
OPENSCAD_SNIPPET=/path/to/OpenSCAD-Snippet npm run test:fidelity
```

### Direct CLI Usage

```bash
# Test built-in corpus
node bin/test-harness.js --corpus --fn 48

# Test specific directory
node bin/test-harness.js --dir /path/to/models --fn 48

# Test specific file with debug output
node bin/test-harness.js model.scad --verbose --keep-temp

# See transpiled JavaScript
node bin/transpile-file.js model.scad
```

## Test Model Locations

- **Built-in corpus:** `test/corpus/` (checked into repo)
- **OpenSCAD-Snippet:** Clone from https://github.com/AngeloNicoli/OpenSCAD-Snippet
  - Default location: `~/src/OpenSCAD-Snippet`
  - Set `OPENSCAD_SNIPPET` env var for custom location
