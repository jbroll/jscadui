# Corpus Modifications

This document tracks intentional modifications made to the corpus files that differ from upstream sources.

## BOSL v1

### Library path normalization

The following files were modified to use `lib/` prefix instead of `BOSL/`:

- `bosl/rotations.scad`: Changed `use <BOSL/transforms.scad>` to `use <lib/transforms.scad>`
- `bosl/transforms.scad`: Changed `use <BOSL/transforms.scad>` to `use <lib/transforms.scad>`
- `bosl/up.scad`: Changed `use <BOSL/transforms.scad>` to `use <lib/transforms.scad>`

**Reason**: Normalizes library paths across all test files. All library includes use `lib/` prefix, which is resolved via OPENSCADPATH (test harness) or configured library directories (browser).

## BOSL2

### arc-3d.scad - Invalid parameter combination

- **File**: `bosl2/arc-3d.scad`
- **Original**: `linear_extrude(5) arc(r=20, angle=120, width=3);`
- **Modified**: `linear_extrude(5) arc(r=20, angle=120);`
- **Reason**: BOSL2 arc() constraint violation - cannot combine `angle` with `width`. Confirmed failure in OpenSCAD 2026.01.24.fp.

## File Naming

Number prefixes (e.g., `100-move.scad`) are used in `examples/` for ordered browsing but have been removed from `corpus/` files for easier maintenance. The organize-corpus.js script adds prefixes when syncing to examples.
