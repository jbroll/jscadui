# BOSL2 Library Integration Plan

## Current Status

**Test Results:** 0/9 passing (transpiler support needed)

**Blockers:** BOSL2 uses advanced OpenSCAD features not yet fully supported:
- Version assertion: `assert(version_num()>=20190500, ...)`
- Complex include chains with flag variables (`_BOSL2_STD`)
- Extensive use of `$` special variables for attachment system

The test infrastructure is ready - tests will pass once BOSL2 transpiler support is implemented.

## Overview

BOSL2 (Belfry OpenSCAD Library v2) is a complete rewrite of BOSL with a more modular architecture. The main entry point is `std.scad` which includes all core modules.

**Usage pattern:**
```openscad
include <lib/std.scad>   // Includes everything
// or
use <lib/shapes3d.scad>  // Individual module
```

## Module Breakdown

BOSL2 contains 56 module files. Priority order for testing:

### Phase 1: Core Transforms (Priority: HIGH)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| transforms.scad | move, rot, scale, mirror, skew | 100-1xx | Not started |
| distributors.scad | xcopies, ycopies, zcopies, grid_copies | 110-1xx | Not started |

### Phase 2: Basic Shapes (Priority: HIGH)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| shapes3d.scad | cuboid, cyl, sphere, prismoid | 200-2xx | Not started |
| shapes2d.scad | rect, circle, oval, hexagon | 250-2xx | Not started |

### Phase 3: Attachments (Priority: MEDIUM)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| attachments.scad | attach, position, orient | 300-3xx | Not started |

### Phase 4: Advanced Geometry (Priority: MEDIUM)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| rounding.scad | round_corners, offset_sweep | 400-4xx | Not started |
| masks.scad | edge_mask, corner_mask | 450-4xx | Not started |
| skin.scad | skin, sweep | 480-4xx | Not started |

### Phase 5: Paths & Beziers (Priority: MEDIUM)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| paths.scad | path operations | 500-5xx | Not started |
| beziers.scad | bezier curves | 550-5xx | Not started |

### Phase 6: Specialized Parts (Priority: LOW)

| File | Description | Tests | Status |
|------|-------------|-------|--------|
| threading.scad | threaded_rod, threaded_nut | 600-6xx | Not started |
| screws.scad | screw, nut | 650-6xx | Not started |
| gears.scad | spur_gear, bevel_gear | 700-7xx | Not started |

## Test File Naming Convention

```
test/corpus/bosl2/
├── 100-xxx.scad      # transforms.scad tests
├── 110-xxx.scad      # distributors.scad tests
├── 200-xxx.scad      # shapes3d.scad tests
├── 250-xxx.scad      # shapes2d.scad tests
├── 300-xxx.scad      # attachments.scad tests
├── 400-xxx.scad      # rounding.scad tests
├── 450-xxx.scad      # masks.scad tests
├── 500-xxx.scad      # paths.scad tests
├── 600-xxx.scad      # threading.scad tests
└── BOSL2_PLAN.md     # This file
```

## Key Differences from BOSL (v1)

1. **Entry point**: Use `include <lib/std.scad>` instead of individual includes
2. **Attachment system**: BOSL2 has a powerful attachment/anchoring system
3. **VNF operations**: Vertices 'N' Faces polyhedra manipulation
4. **Regions**: 2D boolean operations on paths
5. **More comprehensive**: 56 modules vs ~25 in BOSL

## Running Tests

```bash
# Test all BOSL2 examples
node bin/test-harness.js test/corpus/bosl2

# Test specific file with debug output
node bin/test-harness.js test/corpus/bosl2/100-move.scad --verbose
```

## Next Steps

1. Start with Phase 1 transforms (move, rot, scale)
2. Add Phase 2 shapes (cuboid, cyl)
3. Iterate based on what the transpiler supports
