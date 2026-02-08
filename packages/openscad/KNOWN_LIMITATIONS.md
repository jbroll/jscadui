# OpenSCAD Translator - Known Limitations

## Unsupported Constructs

| Construct | Reason |
|-----------|--------|
| `text()` | Requires font rendering system |
| `import()` | STL/OFF/DXF file loading not implemented |
| `surface()` | Heightmap loading not implemented |
| `offset()` | 2D offset operations not implemented |
| `projection()` | 3D to 2D projection not implemented |

## Expected Test Failures

| Model | Jaccard | Reason |
|-------|---------|--------|
| Bricks.scad | ~0.76 | Uses `rands()` - geometry differs each run |
| Wood_Crate.scad | ~0.75 | Uses 0.01-thick cubes - CSG precision differs between Manifold implementations |

## Notes

- Test suite: 246/246 passing (100%) excluding expected failures above
- BOSL library: 119/119 examples passing
- No `--fn` workaround needed - tessellation matches OpenSCAD
