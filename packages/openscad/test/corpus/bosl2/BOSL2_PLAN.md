# BOSL2 Library Integration Plan

## Current Status (Updated 2026-02-08)

**Test Results:** 20/31 passing (64.5%)

| Phase | Module | Tests | Passing | Notes |
|-------|--------|-------|---------|-------|
| 1 | transforms.scad | 100-109 | 10/10 | Complete |
| 1 | distributors.scad | 110-115 | 3/6 | grid_copies failing |
| 2 | shapes3d.scad | 200-209 | 6/10 | prismoid, tube, wedge, teardrop, onion failing |
| 2 | shapes2d.scad | 250-255 | 0/6 | All failing - attachment system issues |

**Recent Fixes:**
- Named parameter reordering for included files (commit eeed1c8)
- Recursive `_vdiv`/`_vneg` for matrix operations (commit 01ddb6b)
- `is_function` built-in support
- Extended `is_vector()` signature for BOSL2 compatibility
- Full implementation of `search()` function in runtime

## Failing Tests Analysis

### Phase 1: Distributors (3 failing)

| Test | Error | Root Cause |
|------|-------|------------|
| 113-grid-copies | Empty assertion | Unknown assertion in grid_copies logic |
| 114-rot-copies | SKIPPED | OpenSCAD reference failure |
| 115-mirror-copy | - | Not yet investigated |

### Phase 2: 3D Shapes (4 failing)

| Test | Error | Root Cause |
|------|-------|------------|
| 203-prismoid | Stack overflow in vnf_vertex_array | Recursive path computation |
| 204-tube | `$fn` before initialization | Variable scoping issue |
| 206-wedge | Assertion in _find_anchor | Zero vector passed to rot() |
| 208-teardrop | Assertion in teardrop2d | Path generation issue |
| 209-onion | column() assertion | Invalid column index on path |

### Phase 2: 2D Shapes (6 failing)

| Test | Error | Root Cause |
|------|-------|------------|
| 250-rect | Empty assertion | Attachment system issue |
| 251-hexagon | Assertion in regular_ngon | Path/anchor computation |
| 252-star | "Anchor type must be hull/intersect" | Missing default value |
| 253-ellipse | Axis direction validation | Invalid axis in linear_extrude |
| 254-trapezoid | Polygon < 3 points | Empty path from trapezoid() |
| 255-regular-ngon | Assertion "2" | Path/anchor computation |

## Priority Fixes for Next Phase

### Priority 1: Fix 2D Shape Path Generation (6 tests)

Most 2D shape failures stem from the attachment system's path computation. The `regular_ngon`, `rect`, and related functions use `attachable()` which computes anchors from geometry bounds.

**Root cause:** The `attach_geom()` function receives invalid geometry descriptors, causing assertion failures.

**Files to investigate:**
- `lib/attachments.scad` - `attach_geom()`, `_find_anchor()`
- `lib/shapes2d.scad` - path generation functions

### Priority 2: Fix `$fn` Scoping (1 test)

The 204-tube test fails with "Cannot access '$fn' before initialization". This is a JavaScript temporal dead zone issue where `$fn` is referenced before its `const` declaration.

**Fix:** Ensure special variables are declared at module scope before any function that references them.

### Priority 3: Fix Zero Vector in Anchoring (2 tests)

Tests 206-wedge and potentially others fail when `_find_anchor()` computes a zero-length direction vector, which then gets passed to `rot(from=...)`.

**Fix:** Add fallback handling in `unit()` or `rot()` for zero vectors.

### Priority 4: Fix VNF Path Overflow (1 test)

The 203-prismoid test causes stack overflow in `vnf_vertex_array`. This is likely due to recursive path computation with no termination condition.

## Module Breakdown

BOSL2 contains 56 module files. Priority order for testing:

### Phase 1: Core Transforms (Priority: HIGH) - COMPLETE

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| transforms.scad | move, rot, scale, mirror, skew | 100-109 | 10/10 |
| distributors.scad | xcopies, ycopies, zcopies, grid_copies | 110-115 | 3/6 |

### Phase 2: Basic Shapes (Priority: HIGH) - IN PROGRESS

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| shapes3d.scad | cuboid, cyl, sphere, prismoid | 200-209 | 6/10 |
| shapes2d.scad | rect, circle, oval, hexagon | 250-255 | 0/6 |

### Phase 3: Attachments (Priority: MEDIUM) - NOT STARTED

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| attachments.scad | attach, position, orient | 300-3xx | Not started |

### Phase 4: Advanced Geometry (Priority: MEDIUM) - NOT STARTED

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| rounding.scad | round_corners, offset_sweep | 400-4xx | Not started |
| masks.scad | edge_mask, corner_mask | 450-4xx | Not started |
| skin.scad | skin, sweep | 480-4xx | Not started |

### Phase 5: Paths & Beziers (Priority: MEDIUM) - NOT STARTED

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| paths.scad | path operations | 500-5xx | Not started |
| beziers.scad | bezier curves | 550-5xx | Not started |

### Phase 6: Specialized Parts (Priority: LOW) - NOT STARTED

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| threading.scad | threaded_rod, threaded_nut | 600-6xx | Not started |
| screws.scad | screw, nut | 650-6xx | Not started |
| gears.scad | spur_gear, bevel_gear | 700-7xx | Not started |

## Test File Naming Convention

```
test/corpus/bosl2/
├── 1xx.scad          # transforms.scad & distributors.scad tests
├── 2xx.scad          # shapes3d.scad & shapes2d.scad tests
├── 3xx.scad          # attachments.scad tests (planned)
├── 4xx.scad          # rounding.scad & masks.scad tests (planned)
├── 5xx.scad          # paths.scad & beziers.scad tests (planned)
├── 6xx.scad          # threading.scad & screws.scad tests (planned)
└── BOSL2_PLAN.md     # This file
```

## Running Tests

```bash
# Test all BOSL2 examples
node bin/test-harness.js test/corpus/bosl2

# Test specific file with verbose output
node bin/run-jscad.js test/corpus/bosl2/250-rect.scad -o /tmp/test.stl 2>&1

# Compare with OpenSCAD reference
openscad -o /tmp/ref.stl test/corpus/bosl2/250-rect.scad
node bin/compare-stl.js /tmp/ref.stl /tmp/test.stl
```

## Key Differences from BOSL (v1)

1. **Entry point**: Use `include <lib/std.scad>` instead of individual includes
2. **Attachment system**: BOSL2 has a powerful attachment/anchoring system using `$` variables
3. **VNF operations**: Vertices 'N' Faces polyhedra manipulation
4. **Regions**: 2D boolean operations on paths
5. **More comprehensive**: 56 modules vs ~25 in BOSL
