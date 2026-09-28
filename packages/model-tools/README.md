# @jscadui/model-tools

Browser-safe `measure` and `check` for `@jscad/modeling` geometry (geom2,
geom3, or arrays of them) — no Node APIs, so it runs inside the sandboxed
compute frame.

```js
import { measure, check } from '@jscadui/model-tools'

measure(model) // { boundingBox, dimensions, center, volume, polygonCount, ... }
check(model, { bed: 'mk3' }) // { watertight, manifold, fitsBed, ... }
```

`measure` options: `parts` (selectors like `"0"` or `"1-3"`), `between`,
`anchors`, `section`.

`check` options: `bed`, one of the named beds in `BEDS` (`mk3`, `mk4`,
`mini`, `x1`, `p1`, `a1mini`, `ender3`, case-insensitive) or its size in mm
as `[x, y, z]`, `{x, y, z}`, or a JSON array string (`"[x, y, z]"`). It
reports `watertight`, `manifold`, `openEdges`, `nonManifoldEdges`,
`selfIntersecting` and `fitsBed` for solids, and `closed`/`outlines` for 2D
profiles.
