| Package | Import | Holds |
|---|---|---|
| `@jbroll/jscad-fluent` | `const jf = require('@jbroll/jscad-fluent')` | shapes with chainable methods: `jf.cuboid({ size: [4, 4, 5] }).translate([18, 0, 0])`, `a.subtract(b, c)`, `jf.polygon([[x, y], ...]).extrudeLinear({ height })`, `shape.hull()`, `shape.colorize([r, g, b])` |
| `@jscadui/jscad-text` | `const jscadText = require('@jscadui/jscad-text')` | TTF and Hershey text outlines |

Do not require `@jscad/modeling` or mix in its calls. The one exception:
jscad-text needs `jscadText.init(require('@jscad/modeling'))` before
`jscadText.text2d(...)`; wrap the outline it returns as
`new jf.FluentGeom2(outline)` to chain on it.

## jscad-fluent style

Write one method chain per logical shape, starting from a `jf.*` factory,
and combine shapes with methods: `base.subtract(hole)`, `a.union(b, c)`.
Name a part in a local only when the name makes the model clearer.
Measuring is a method too: `shape.measureDimensions()`,
`.measureBoundingBox()`, `.measureCenter()`, `.measureVolume()` (3D),
`.measureArea()` (2D).
