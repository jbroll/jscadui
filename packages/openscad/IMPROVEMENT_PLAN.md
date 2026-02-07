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

## Tessellation Investigation (2025-02-07)

Investigation into why `--fn 48` is needed as a workaround and what causes tessellation mismatches.

### Root Cause 1: Minimum Segment Count Mismatch

**Location:** `transpile.ts:1160` in `_getSegments` helper

**Problem:** Our minimum is 12, OpenSCAD's minimum is 5.

```javascript
// Current (wrong):
return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 12))

// Should be:
return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
```

**Impact:** For small radii (e.g., r=0.3), OpenSCAD uses ~5-7 segments while we use 12. More segments = more circular = larger volume.

**Example:** `cylinder(5, 0.3, 0.3)` in Weights_01.scad
- OpenSCAD: 7 facets
- Our code: 12 segments (minimum)

**Fix:** Change minimum from 12 to 5. Easy fix.

### Root Cause 2: Sphere Tessellation Algorithm Differs

**Problem:** JSCAD and OpenSCAD use different sphere meshing algorithms.

**Evidence:** Same `$fn=20` produces different facet counts:
- JSCAD sphere(segments=20): 200 polygons
- OpenSCAD sphere($fn=20): 182 facets

**Affected Models:** Abacus.scad (uses `sphere(r=1, $fn=20)`)

**Fix Options:**
1. Accept the difference (spheres will never match exactly)
2. Implement custom sphere primitive matching OpenSCAD's UV-sphere algorithm
3. Use higher `$fn` to minimize relative difference

### Root Cause 3: List Comprehension Bug

**Location:** `transpile.ts:618-620` (VectorExpr case)

**Problem:** `[for (i = range) expr]` gets double-wrapped in arrays.

```openscad
angles = [for (i = [0:5]) i*60];
```

Transpiles to:
```javascript
const angles = [_range(0, 5).map(i => i*60)]  // Wrong: [[0, 60, 120, ...]]
```

Should be:
```javascript
const angles = _range(0, 5).map(i => i*60)    // Correct: [0, 60, 120, ...]
```

**Cause:** `VectorExpr` wraps all children in `[...]`, but when the only child is `LcForExpr`, the map result is already an array.

**Fix:** Check if VectorExpr has single LcForExpr child and skip the wrapper.

**Note:** Not currently affecting test models because they use built-in `_regular_polygon` helper instead of the transpiled local function.

### What's NOT the Issue

**Circle/Cylinder Vertex Placement:** Both OpenSCAD and JSCAD use circumscribed circles (vertices placed exactly at the specified radius). Verified via STL vertex analysis.

### Primitive Comparison Table

| Primitive | Same Algorithm? | Notes |
|-----------|-----------------|-------|
| cube | ✅ Yes | Identical |
| cylinder | ⚠️ Mostly | Min segments differ (5 vs 12) |
| sphere | ❌ No | Different tessellation (182 vs 200 facets for $fn=20) |
| circle | ⚠️ Mostly | Min segments differ |
| polygon | ✅ Yes | Direct mapping |
| rotate_extrude | ✅ Yes | Same segment interpretation |
| linear_extrude | ✅ Yes | Same behavior |

### Why `--fn 48` Helps

Using `--fn 48` forces both OpenSCAD and our transpiler to use 48 segments for all curved primitives, which:
1. Overrides the minimum segment difference (5 vs 12 becomes moot)
2. Makes sphere differences proportionally smaller (at higher segment counts, different algorithms converge)
3. Produces more similar volumes even with different tessellation

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

**Tessellation Fixes (to reduce `--fn 48` dependency):**
1. Fix minimum segment count (12→5) in `_getSegments` - easy fix
2. Fix list comprehension double-wrapping in VectorExpr - easy fix
3. Consider custom sphere primitive matching OpenSCAD - hard

**Feature Work:**
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
