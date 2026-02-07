# OpenSCAD Translator Improvement Plan

## Current Status

**Test Results (2024-02):**
- Built-in corpus: 19/19 passing (100%) with `--fn 48`
- OpenSCAD-Snippet library: 82/110 passing (74.5%) at 0.99 Jaccard threshold
- 13 transpiler errors, 15 geometry mismatches, 5 OpenSCAD-side failures

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
- **Math functions** - Added `sign`, `norm`, `cross`, `lookup`, `rands` (fixes Bricks.scad transpiler error)
- **Special variables $preview, $t** - `$preview` returns false, `$t` returns 0 (fixes Ring, Pipe_00)
- **Regular polygon primitive** - `regular_polygon(n, r)` using `circle({ radius, segments })` (fixes Weights_01, Tree_01)
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

### 1. Geometry Precision Differences
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

### 2. Unsupported Constructs
**Impact:** Various models

**Not yet supported:**
- `echo()` for debugging (1 model)
- `text()` module (requires font rendering)
- `import()` for STL/OFF files
- `surface()` for heightmaps
- `children()` for module children access
- `$children` special variable
- Complex list comprehensions with multiple variables

---

## Implementation Priority

### Phase 1: High Impact
1. ~~Add missing special variables: `$preview`, `$t`~~ ✓ Done
2. ~~Add missing math functions (rands, norm, cross, lookup, sign)~~ ✓ Done

### Phase 2: Medium Impact
3. Fix remaining transpiler syntax errors

### Phase 3: Low Priority
4. Add children() support
5. Improve error messages
6. Add text() support (complex - needs font system)

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
