# BOSL Library Integration Plan

## Current Status

**Test Results (2026-02-07):** 119/119 passing (100%)

**children() support**: Implemented and working
- `children()` - returns all children as union
- `children(n)` - returns nth child
- `children([a, b, c])` - returns union of specified children
- `$children` - returns count of children

**Phase 1 - Transforms:** ✅ Complete (70 tests)
- Transform wrappers: up, left, right, fwd, back, move, xmove, ymove, zmove
- Rotations: rot, xrot, yrot, zrot, rot_copies, xrot_copies, yrot_copies, zrot_copies
- Scaling: xscale, yscale, zscale, xflip, yflip, zflip
- Skewing: skew_xy, skew_yz, skew_xz (via multmatrix)
- Distributors: spread, xspread, yspread, zspread, distribute, xdistribute, ydistribute, zdistribute
- Grids: grid2d, grid3d
- Rings: xring, yring, zring, arc_of
- Reflections: mirror_copy, xflip_copy, yflip_copy, zflip_copy
- Mutators: half_of, top_half, bottom_half, left_half, right_half, front_half, back_half, chain_hull
- Copies: place_copies, translate_copies, line_of

**Phase 2 - Shapes:** ✅ Complete (19 tests)
- Cuboids: cuboid, leftcube, rightcube, fwdcube, backcube, downcube, upcube, chamfcube, rcube
- Prismoids: prismoid, right_triangle
- Cylinders: cyl, xcyl, ycyl, zcyl, tube, torus (with chamfer support)
- Organic: teardrop, onion
- Printing: narrowing_strut
- Slots: slot, arced_slot, interior_fillet
- Utilities: nil, noop, pie_slice

**Phase 3 - Masks:** ✅ Complete (16 tests)
- Edge masks: angle_pie_mask, chamfer_mask, chamfer_mask_x/y/z, fillet_mask, fillet_mask_x/y/z
- Cylinder masks: chamfer_cylinder_mask, fillet_cylinder_mask, cylinder_mask
- Corner masks: fillet_corner_mask, fillet_angled_corner_mask
- Hole masks: chamfer_hole_mask, fillet_hole_mask
- Modifiers: chamfer (edge modifier), fillet (edge modifier), fillet_angled_edge_mask

**Phase 4 - Threading:** ✅ Complete (11 tests)
- threaded_rod, threaded_nut - standard metric/UTS threads
- trapezoidal_threaded_rod/nut - core threading module
- acme_threaded_rod/nut - ACME profile threads
- buttress_threaded_rod - buttress profile threads
- square_threaded_rod - square profile threads
- metric_trapezoidal_threaded_rod - metric trapezoidal
- Left-handed and beveled thread options

## BOSL Module Breakdown

### Phase 1: transforms.scad (Priority: HIGH) ✅ COMPLETE

| Category | Modules | Tests | Status |
|----------|---------|-------|--------|
| Translations | move, xmove, ymove, zmove, left, right, fwd, back, up, down | 100-103 | ✅ Complete |
| Rotations | rot, xrot, yrot, zrot | 104-106, 111 | ✅ Complete |
| Scaling | xscale, yscale, zscale, xflip, yflip, zflip | 107-114 | ✅ Complete |
| Skewing | skew_xy, skew_yz, skew_xz | 115-117 | ✅ Complete |
| Distributors | spread, xspread, yspread, zspread | 118-121 | ✅ Complete |
| Distributors | distribute, xdistribute, ydistribute, zdistribute | 122-125 | ✅ Complete |
| Distributors | grid2d, grid3d | 126-127 | ✅ Complete |
| Rotational | rot_copies, xrot_copies, yrot_copies, zrot_copies | 128-131 | ✅ Complete |
| Rotational | xring, yring, zring, arc_of | 132-135 | ✅ Complete |
| Reflectional | mirror_copy, xflip_copy, yflip_copy, zflip_copy | 136-139 | ✅ Complete |
| Mutators | half_of, top_half, bottom_half, left_half, right_half, front_half, back_half | 140-146 | ✅ Complete |
| Mutators | chain_hull | 147 | ✅ Complete |
| Copies | place_copies, translate_copies, line_of | 148-150 | ✅ Complete |

**Remaining Phase 1 items (not yet tested):**
- `ovoid_spread` - requires spherical coordinate transforms
- `extrude_arc` - requires rotate_extrude with angle parameter
- `orient_and_align` - complex alignment system

### Phase 2: shapes.scad (Priority: HIGH) ✅ COMPLETE

| Category | Modules | Tests | Status |
|----------|---------|-------|--------|
| Cuboids | cuboid, leftcube, rightcube, fwdcube, backcube, downcube, upcube | 200-201 | ✅ Complete |
| Chamfered/Rounded | chamfcube, rcube | 202-203 | ✅ Complete |
| Prismoids | prismoid | 204 | ✅ Complete |
| Triangles | right_triangle | 205 | ✅ Complete |
| Cylindroids | cyl, xcyl, ycyl, zcyl, tube, torus | 206-209 | ✅ Complete |
| Cyl with chamfer | cyl (chamfer parameter) | 218 | ✅ Complete |
| Organic | teardrop, onion | 210-211 | ✅ Complete |
| Printing shapes | narrowing_strut | 217 | ✅ Complete |
| Misc | nil, noop, pie_slice, slot, arced_slot, interior_fillet | 212-216 | ✅ Complete |

**Key fixes implemented for Phase 2:**
- Multi-variable for loops: `for (i = [0:3], axis = [0:2])` now transpiles correctly
- polyhedron primitive: Added `_polyhedron` wrapper with face winding correction
- Nested array operations: `_vadd`/`_vsub` now recursively handle nested arrays (e.g., EDGES_ALL)
- Safe union: `_safeUnion` filters undefined values (from assertion modules)

### Phase 3: masks.scad (Priority: MEDIUM) ✅ COMPLETE

| Category | Modules | Tests | Status |
|----------|---------|-------|--------|
| Edge masks | angle_pie_mask, chamfer_mask, chamfer_mask_x/y/z | 300-302 | ✅ Complete |
| Edge masks | fillet_mask, fillet_mask_x/y/z | 303-304 | ✅ Complete |
| Cylinder masks | chamfer_cylinder_mask, fillet_cylinder_mask | 305-306 | ✅ Complete |
| Corner masks | fillet_corner_mask, fillet_angled_corner_mask | 307, 313 | ✅ Complete |
| Cylinder mask | cylinder_mask (with fillet option) | 308-309 | ✅ Complete |
| Modifiers | chamfer, fillet (edge modifiers) | 310-311 | ✅ Complete |
| Angled edges | fillet_angled_edge_mask | 312 | ✅ Complete |
| Hole masks | chamfer_hole_mask, fillet_hole_mask | 314-315 | ✅ Complete |

### Phase 4: threading.scad (Priority: MEDIUM) ✅ COMPLETE

| Category | Modules | Tests | Status |
|----------|---------|-------|--------|
| Standard | threaded_rod, threaded_nut | 400-401 | ✅ Complete |
| Trapezoidal | trapezoidal_threaded_rod/nut | 402-403 | ✅ Complete |
| ACME | acme_threaded_rod/nut | 404, 410 | ✅ Complete |
| Buttress | buttress_threaded_rod | 405 | ✅ Complete |
| Square | square_threaded_rod | 406 | ✅ Complete |
| Metric | metric_trapezoidal_threaded_rod | 407 | ✅ Complete |
| Options | left_handed, bevel | 408-409 | ✅ Complete |

**Key fixes implemented for Phase 4:**
- Nested function definitions: Functions defined inside modules now transpile correctly
- Include re-exports: `include <file>` now re-exports included symbols (fixed `_default` undefined)
- Import deduplication: Prevents duplicate symbol imports when files re-export shared dependencies

### Phase 5: paths.scad & beziers.scad (Priority: MEDIUM) 🔄 IN PROGRESS

| Category | Modules | Tests | Status |
|----------|---------|-------|--------|
| Path basics | modulated_circle | 500 | ✅ Complete |
| Path extrusion | extrude_from_to | 501 | ✅ Complete |
| Path extrusion | extrude_from_to (twist+scale) | 502 | ✅ Complete (0.99 Jaccard) |

**Key fixes implemented for Phase 5:**
- **min/max array handling**: `min([1,2,3])` and `max([1,2,3])` now work correctly (OpenSCAD returns min/max of array elements)
- **Twist direction fix**: OpenSCAD twists clockwise, JSCAD counter-clockwise - now properly negated
- **linear_extrude with scale**: Uses `extrudeFromSlices` since JSCAD's `extrudeLinear` ignores scale parameter
- **Edge subdivision for twist**: Polygon edges are subdivided before twisting for smoother results (matches OpenSCAD's `segments` behavior)
- **slice naming conflict**: JSCAD's `slice` import renamed to `_jscadSlice` to avoid conflict with OpenSCAD's `slice()` function

### Phase 6: Standard Parts (Priority: LOW)

| Module | Description | Status |
|--------|-------------|--------|
| involute_gears.scad | Gears and racks | Not started |
| joiners.scad | Connectors | Not started |
| sliders.scad | Slider/rail | Not started |
| metric_screws.scad | Fasteners | Not started |
| linear_bearings.scad | LMxUU mounts | Not started |
| nema_steppers.scad | Motor mounts | Not started |
| phillips_drive.scad | Screw tips | Not started |
| torx_drive.scad | Torx holes | Not started |
| wiring.scad | Wire routing | Not started |
| acme_screws.scad | ACME threads | Not started |

## Missing Features Needed

| Feature | Required For | Priority | Status |
|---------|-------------|----------|--------|
| `multmatrix()` | Skew transforms | HIGH | ✅ Implemented |
| `offset()` | 2D operations | MEDIUM | Not started |
| `projection()` | 2D from 3D | LOW | Not started |
| `text()` | Labels | LOW | Not started |
| `import()` | External files | LOW | Not started |

## Test Files

All tests use numeric series naming convention:
```
test/corpus/bosl/
├── 20-35 series (standalone examples, not BOSL library)
├── 100-150 series (Phase 1 transforms)
├── 200-218 series (Phase 2 shapes)
├── 300-315 series (Phase 3 masks)
├── 400-410 series (Phase 4 threading)
├── 500-502 series (Phase 5 paths)
└── BOSL_PLAN.md (this file)
```

## Next Steps

1. **Phase 5: paths.scad & beziers.scad** - Path extrusion and curves
2. **Implement `offset()`** - Needed for many 2D operations
3. **Phase 6** - Standard parts based on user demand

## Transpiler Improvements Made

The following transpiler improvements were made during BOSL testing:

**Phase 2:**
1. **Multi-variable for loops**: `for (i = [0:3], axis = [0:2])` now generates nested `flatMap/map` calls
2. **polyhedron primitive**: Added support with automatic face winding correction for JSCAD compatibility
3. **Recursive vector operations**: `_vadd` and `_vsub` now handle nested arrays recursively
4. **Safe union helper**: `_safeUnion` filters out undefined values from assertion calls
5. **Special variable defaults**: `$fn`, `$fa`, `$fs` defaults are only added if not user-defined
6. **Equality operator fix**: `_eq` helper properly included for list comprehensions with conditions

**Phase 4:**
7. **Nested function declarations**: Functions defined inside modules now transpile correctly
8. **Include re-exports**: `include <file>` now properly re-exports all symbols from included files
9. **Import deduplication**: Prevents duplicate symbol imports when multiple files re-export shared dependencies

**Phase 5:**
10. **min/max with arrays**: `_min` and `_max` helpers spread array arguments (`max([1,2,3])` returns 3)
11. **linear_extrude twist/scale**: Uses `extrudeFromSlices` with proper twist direction (negated to match OpenSCAD)
12. **Edge subdivision**: Polygon edges subdivided during twist extrusion for smoother results (matches OpenSCAD's `segments` behavior)
13. **Slice naming**: JSCAD's `slice` imported as `_jscadSlice` to avoid conflicts with OpenSCAD's `slice()` function

**Known Limitations:**
- `$fn` passed to modules that don't declare it in their parameter list will be ignored (not yet supporting dynamic scoping for special variables)

## Running Tests

```bash
# Test all BOSL examples
node bin/test-harness.js --dir test/corpus/bosl

# Test specific file with debug output
node bin/test-harness.js test/corpus/bosl/140-bosl-half-of.scad --verbose --keep-temp
```
