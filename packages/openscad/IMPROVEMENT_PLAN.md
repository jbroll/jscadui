# OpenSCAD Translator Improvement Plan

## Current Status

**Test Results (2024-02):**
- Built-in corpus: 19/19 passing (100%) with `--fn 48`
- OpenSCAD-Snippet library: 77/110 passing (70.0%) at 0.99 Jaccard threshold
- 23 transpiler errors, 10 geometry mismatches, 5 OpenSCAD-side failures

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

### Completed in this session:
- **Minkowski operation** - Transpile `minkowski()` to JSCAD/Manifold (fixes Mech_Piece models)
- **Polygon winding order** - Auto-detect and normalize CCW winding for Manifold (fixes Stairs models)
- **For loops** - `for (i = [0:10]) body` → `union(..._range(0, 10).map(i => body))`
- **Nested modules** - Modules inside modules hoisted as local functions
- **Local variables** - `x = 5;` inside modules → `const x = 5`
- **Scoped variables** - Variables in nested blocks use IIFE for proper scoping
- **Positional extrusion params** - `linear_extrude(2)` → `{ height: 2 }`
- **Hull children** - Pass children as separate args, not wrapped in union
- **Global $fn** - `--fn` option for both OpenSCAD and transpiler

---

## Open Issues

### 1. Missing `regular_polygon` Module
**Impact:** 3+ models (Tree_01, Weights_01, etc.)

**Problem:** OpenSCAD has a built-in `regular_polygon` or models define it themselves. The transpiler doesn't recognize it as a built-in.

**Error:** `polygon requires at least 3 points`

**Solution:** Add `regular_polygon` as a built-in module:
```javascript
// regular_polygon(n, r) - n-sided polygon with circumradius r
const regular_polygon = (n, r) => {
  const points = []
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    points.push([r * Math.cos(angle), r * Math.sin(angle)])
  }
  return polygon({ points })
}
```

**Files to modify:**
- `src/transpiler/transpile.ts` - Add to built-in modules

---

---

### 3. Missing Math Functions
**Impact:** Some models use uncommon OpenSCAD functions

**Already implemented:** sin, cos, tan, asin, acos, atan, atan2, abs, floor, ceil, round, sqrt, pow, exp, log, ln, min, max, len, concat

**Missing:**
- `rands(min, max, count, seed?)` - Random number array
- `norm(v)` - Vector length
- `cross(v1, v2)` - Cross product
- `lookup(val, table)` - Table interpolation
- `sign(x)` - Sign of number

**Files to modify:**
- `src/transpiler/transpile.ts` - `transpileFunctionCall()`

---

### 4. Geometry Precision Differences
**Impact:** 12 models fail threshold (0.93-0.98 Jaccard)

**Examples:**
- Wood_Crate.scad: 0.75 Jaccard
- Walking_Stick.scad: 0.96 Jaccard
- Sword_01.scad: 0.94 Jaccard

**Possible causes:**
1. Different tessellation algorithms between Manifold and OpenSCAD
2. Floating point precision differences
3. Different handling of edge cases (thin walls, etc.)

**Solutions:**
- Use `--fn 48` or higher for better tessellation match
- Some models may never match exactly due to algorithm differences
- Consider lowering threshold for specific models

---

### 5. Unsupported Constructs
**Impact:** Various models

**Not yet supported:**
- `$preview` special variable (4 models)
- `$t` animation variable (1 model)
- `echo()` for debugging (1 model)
- `text()` module (requires font rendering)
- `import()` for STL/OFF files
- `surface()` for heightmaps
- `children()` for module children access
- `$children` special variable
- Complex list comprehensions with multiple variables

---

## Implementation Priority

### Phase 1: High Impact (fixes ~5 models)
1. Add `regular_polygon` built-in (3+ models)
2. Add missing special variables: `$preview`, `$t` (~5 models)

### Phase 2: Medium Impact (fixes ~5 models)
3. Add missing math functions (rands, norm, cross)
4. Fix remaining transpiler syntax errors

### Phase 3: Low Priority
6. Add children() support
7. Improve error messages
8. Add text() support (complex - needs font system)

## Running Tests

```bash
# Test built-in corpus (should be 100% with --fn 48)
node bin/test-harness.js --corpus --fn 48

# Test OpenSCAD-Snippet library
node bin/test-harness.js --dir /path/to/OpenSCAD-Snippet/Asset_SCAD

# Test specific file with debug output
node bin/test-harness.js model.scad --verbose --keep-temp

# See transpiled JavaScript
node bin/transpile-file.js model.scad
```

## Test Model Locations

- Built-in corpus: `test/corpus/`
- OpenSCAD-Snippet: https://github.com/AngeloNicoli/OpenSCAD-Snippet
