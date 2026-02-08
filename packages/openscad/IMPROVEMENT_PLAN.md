# OpenSCAD Translator Improvement Plan

## Current Status

**Test Results (2026-02-07):**
- Built-in corpus: 19/19 passing (100%)
- OpenSCAD-Snippet library: **108/110 passing (98.2%)** at 0.99 Jaccard threshold
- **BOSL library examples: 119/119 passing (100%)**
- No `--fn 48` workaround needed - special variables properly propagate to children
- 0 transpiler errors, 2 geometry mismatches, 5 OpenSCAD-side failures

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

### Session 2026-02-07 (BOSL Phase 5 paths.scad):
- **linear_extrude twist/scale** - Uses `extrudeFromSlices` with proper twist direction (OpenSCAD clockwise, JSCAD counter-clockwise - now negated)
- **Edge subdivision for twist** - Polygon edges are subdivided before twisting for smoother results (matches OpenSCAD's `segments` parameter)
- **min/max with arrays** - `max([1,2,3])` now correctly returns 3 (JavaScript `Math.max([1,2,3])` returns NaN)
- **slice naming conflict** - JSCAD's `slice` import renamed to `_jscadSlice` to avoid conflict with OpenSCAD's `slice()` function
- All 119 BOSL library tests now pass with Jaccard ≥ 0.99

### Session 2026-02-07 (children() support):
- **children() module** - Full support for `children()`, `children(n)`, and `children([indices])` in user modules
- **$children variable** - Returns count of children passed to a module
- **Curried module pattern** - Modules now use curried functions to support default parameters with children
- **BOSL-style examples** - 16 new test cases demonstrating transform wrappers, distributors, and utility modules
- All BOSL examples pass with Jaccard 1.0

### Session 2026-02-07 (earlier):
- **linear_extrude scale parameter** - Added scale support to `_linearExtrude` (fixes Fireplace_01, Sword_01, Weights_01, Tower)
- **rotate_extrude segment calculation** - Use `ceil()` instead of `round()` to match OpenSCAD (fixes Pipe_90)
- **Invalid argument handling** - Added `_num()` validator for all primitives to handle invalid args like OpenSCAD (fixes Pendulum)
- All 5 near-passing models now pass with perfect Jaccard 1.0

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

## Remaining Failures (2 models)

| Model | Jaccard | Issue |
|-------|---------|-------|
| Bricks.scad | 0.76 | Uses `rands()` - different geometry each run (expected) |
| Wood_Crate.scad | 0.75 | Uses 0.01-thick cubes - CSG precision differs between backends |

Both failures are expected/unfixable:
- **Bricks.scad**: Uses random positioning via `rands()`, so geometry differs every run
- **Wood_Crate.scad**: Uses very thin cubes (0.01 units), exposing floating-point precision differences between Manifold implementations

---

## Tessellation Investigation (2025-02-07)

Investigation into why `--fn 48` is needed as a workaround and what causes tessellation mismatches.

### Root Cause 1: Minimum Segment Count Mismatch ✓ FIXED

**Location:** `transpile.ts:1160` in `_getSegments` helper

**Problem:** Our minimum was 12, OpenSCAD's minimum is 5.

**Solution:** Changed minimum from 12 to 5 in `_getSegments`:
```javascript
return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
```

**Impact:** For small radii (e.g., r=0.3), OpenSCAD uses ~5-7 segments while we were using 12. More segments = more circular = larger volume. Now matches OpenSCAD.

### Root Cause 2: Sphere Tessellation Algorithm Differs ✓ FIXED

**Problem:** JSCAD and OpenSCAD use different sphere meshing algorithms.

**Evidence:** Same `$fn=20` produces different facet counts:
- JSCAD sphere(segments=20): 200 polygons
- OpenSCAD sphere($fn=20): 182 facets

**Affected Models:** Abacus.scad (uses `sphere(r=1, $fn=20)`)

**Solution Implemented:** Custom `_sphere` function using `polyhedron()` that matches OpenSCAD's algorithm:
- `numRings = floor((fn + 1) / 2)` horizontal rings
- Rings placed at latitude `(180 * (i + 0.5)) / numRings`
- No pole vertices - caps are flat triangulated polygons
- Result: Abacus.scad now passes with Jaccard 1.0

### Root Cause 3: List Comprehension Bug ✓ FIXED

**Location:** `transpile.ts:618-620` (VectorExpr case)

**Problem:** `[for (i = range) expr]` was getting double-wrapped in arrays.

```openscad
angles = [for (i = [0:5]) i*60];
```

Was transpiling to:
```javascript
const angles = [_range(0, 5).map(i => i*60)]  // Wrong: [[0, 60, 120, ...]]
```

**Solution:** Added check for single `LcForExpr` child and skip the wrapper:
```javascript
if (children.length === 1 && children[0].constructor.name === 'LcForExpr') {
  return transpileExpression(children[0], ctx)  // Returns array directly
}
```

Now correctly transpiles to:
```javascript
const angles = _range(0, 5).map(i => i*60)    // Correct: [0, 60, 120, ...]
```

### What's NOT the Issue

**Circle/Cylinder Vertex Placement:** Both OpenSCAD and JSCAD use circumscribed circles (vertices placed exactly at the specified radius). Verified via STL vertex analysis.

### Primitive Comparison Table

| Primitive | Same Algorithm? | Notes |
|-----------|-----------------|-------|
| cube | ✅ Yes | Identical |
| cylinder | ✅ Yes | Min segments fixed (5) |
| sphere | ✅ Yes | Custom polyhedron-based matching OpenSCAD |
| circle | ✅ Yes | Min segments fixed (5) |
| polygon | ✅ Yes | Direct mapping |
| rotate_extrude | ✅ Yes | Same segment interpretation |
| linear_extrude | ✅ Yes | Same behavior |

### `--fn 48` Workaround No Longer Needed

All tessellation issues have been fixed:
1. ✅ Minimum segments now match OpenSCAD (5)
2. ✅ Sphere tessellation matches OpenSCAD exactly
3. ✅ Special variables (`$fn`, `$fa`, `$fs`) properly propagate to children
4. ✅ `rotate_extrude` scales segments proportionally to angle

---

## Unsupported Constructs

**Not yet supported:**
- `text()` module (requires font rendering)
- `import()` for STL/OFF files
- `surface()` for heightmaps
- `offset()` for 2D operations
- `projection()` for 2D from 3D

---

## Implementation Priority

### Completed
1. ~~Add missing special variables: `$preview`, `$t`~~ ✓
2. ~~Add missing math functions (rands, norm, cross, lookup, sign)~~ ✓
3. ~~Fix transpiler syntax errors~~ ✓ (0 remaining)
4. ~~Fix trig functions degrees/radians~~ ✓
5. ~~Fix extrudeRotate for negative X profiles~~ ✓

### Future Work

**Tessellation Fixes (to reduce `--fn 48` dependency):**
1. ~~Fix minimum segment count (12→5) in `_getSegments`~~ ✓
2. ~~Fix list comprehension double-wrapping in VectorExpr~~ ✓
3. ~~Implement OpenSCAD-style sphere tessellation using polyhedron~~ ✓ (fixes Abacus.scad)

**Feature Work:**
1. ~~Add `children()` support for module children access~~ ✓
2. ~~Add `$children` special variable~~ ✓
3. ~~Add `multmatrix()` for skew transforms~~ ✓
4. Improve thin geometry handling
5. Add `text()` support (complex - needs font system)
6. Add `import()` for external files

**Refactoring (Technical Debt):**
1. **Runtime module**: Move helper functions (`_cube`, `_cylinder`, `_rotate`, etc.) to a separate runtime module instead of inlining them in every transpiled file. This would:
   - Reduce transpiled file size
   - Make helpers easier to maintain and test
   - Avoid namespace conflicts with user-defined modules

**BOSL Library Examples:**
- **119 BOSL library tests** created and passing (100%)
- Phases complete: transforms, shapes, masks, threading, paths
- See `test/corpus/bosl/BOSL_PLAN.md` for full breakdown

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
node bin/test-harness.js --corpus

# Test specific directory
node bin/test-harness.js --dir /path/to/models

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
