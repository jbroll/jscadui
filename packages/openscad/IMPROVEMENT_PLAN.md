# OpenSCAD Translator Improvement Plan

Based on testing 133 models (18 corpus + 115 OpenSCAD-Snippet), with 93 passing (70%) at 0.98 Jaccard threshold.

## Issue Categories

### 1. Missing `center` Parameter for `linear_extrude` (HIGH PRIORITY)
**Impact:** ~10% of failures (e.g., Beam_C.scad, Beam_Angular.scad)

**Problem:** OpenSCAD's `linear_extrude(height=10, center=true)` centers the extrusion on the XY plane (z from -5 to +5). JSCAD's `extrudeLinear` always extrudes upward from z=0.

**Solution:** When `center=true`, wrap the result in `translate([0, 0, -height/2], ...)`:
```javascript
// Current output:
extrudeLinear({ height: 10 }, polygon(...))

// Fixed output for center=true:
translate([0, 0, -5], extrudeLinear({ height: 10 }, polygon(...)))
```

**Files to modify:**
- `src/emitter/emit.ts`: Update `emitExtrusion()` to check params.center

---

### 2. Missing `rands()` Function (LOW PRIORITY)
**Impact:** 1 model (Bricks.scad)

**Already implemented:** cos, sin, tan, acos, asin, atan, atan2, abs, floor, ceil, round, sqrt, pow, exp, ln, log, min, max, len, str, chr, ord, concat, norm, cross, search

**Missing:**
- `rands(min, max, count, seed?)` - generate array of random numbers

**Solution:**
```javascript
case 'rands': {
  const [min, max, count, seed] = evalArgs() as number[]
  const result: number[] = []
  for (let i = 0; i < count; i++) {
    result.push(min + Math.random() * (max - min))
  }
  return result
}
```

**Files to modify:**
- `src/evaluator/expressions.ts`

---

### 3. Arc/Rotate Extrude Partial Angle (MEDIUM PRIORITY)
**Impact:** Arc_01, Arc_02 have ~0.33 Jaccard

**Problem:** Models using `rotate_extrude(angle=...)` with partial angles may have tessellation or positioning differences.

**Investigation needed:** Check if:
- Angle is being applied correctly
- Starting position matches OpenSCAD
- Segment calculation is correct for partial arcs

**Files to check:**
- `src/emitter/emit.ts`: `rotate_extrude` handling
- Manifold's `extrudeRotate` implementation

---

### 4. Empty STL Generation (MEDIUM PRIORITY)
**Impact:** 5 comparison errors (Fence_01, Shaft_01, Shaft_02, Stairs_02, Stairs_03)

**Problem:** Generated STL files are empty (just header/footer).

**Possible causes:**
1. JSCAD throws during execution but error isn't propagated
2. Geometry is invalid (non-manifold, self-intersecting)
3. Transform creates degenerate geometry

**Solution:**
- Add error logging in `run-jscad.js`
- Check for empty geometry before export
- Add verbose mode to show JSCAD errors

---

### 5. OpenSCAD-side Failures (LOW PRIORITY)
**Impact:** 4 models fail in OpenSCAD itself

**Failing models:**
- Coin_02.scad - references undefined module `Coin_01`
- Letter_A.scad - likely uses `text()` which needs fonts
- Mech_Piece_03.scad, Mech_Piece_04.scad - unknown issues
- Screw.scad - possibly uses unsupported features

**Solution:** These are issues with the test models, not our translator. Skip or fix the models.

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 hours)
1. Fix `linear_extrude` center parameter
2. Add basic math functions (cos, sin, abs, min, max)

### Phase 2: Core Functions (2-4 hours)
3. Add remaining math functions
4. Add `rands()` function
5. Improve error logging in test harness

### Phase 3: Investigation (2-4 hours)
6. Debug rotate_extrude partial angle issues
7. Debug empty STL generation
8. Add more test coverage

## Expected Improvement

After Phase 1+2, expect to reach ~80-85% pass rate (up from 70%).

## Running Tests

```bash
# Test built-in corpus
node bin/test-harness.js --corpus --threshold 0.98

# Test external models
node bin/test-harness.js --dir /path/to/models --threshold 0.98

# Test specific file with debug
node bin/test-harness.js model.scad --verbose --keep-temp
```
