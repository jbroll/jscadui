| Package | Import | Holds |
|---|---|---|
| `@jscad/modeling` | `const { primitives, booleans, transforms } = require('@jscad/modeling')` | `primitives`, `booleans`, `transforms`, `extrusions`, `expansions`, `hulls`, `minkowski`, `modifiers`, `colors`, `measurements`, `maths`, `geometries`, `curves`, `text`, `utils` |
| `@jscadui/jscad-text` | `const jscadText = require('@jscadui/jscad-text')` | TTF and Hershey text outlines |

Shapes such as `sphere` and `cube` are members of `primitives`, not packages:
`const { sphere } = require('@jscad/modeling').primitives`.

## @jscad/modeling style

Take each function from its namespace: `const { cuboid, cylinder } = primitives`.
Every function returns plain geometry with no methods, so transform and
combine by passing shapes in: `translate([x, y, z], shape)`,
`subtract(base, hole)`, `union(a, b, c)`. Measuring works the same way:
`measureDimensions(shape)`, `measureBoundingBox`, `measureCenter`,
`measureVolume` (3D) and `measureArea` (2D) from `measurements`.
