# @jscadui/model-tools

Browser-safe `measure` and `check` for `@jscad/modeling` geometry (geom2,
geom3, or arrays of them) — no Node APIs, so it runs inside the sandboxed
compute frame.

```js
import { measure, check } from '@jscadui/model-tools'

measure(model) // { boundingBox, dimensions, center, volume, polygonCount, ... }
check(model, { bed: 'mk3' }) // { watertight, manifold, fitsBed, ... }
```

`measure` options: `parts` (an index selector like `"0"` or `"1-3"`, a part
name, `"all"`, an array of selectors, where `"all"` stands for every part, or
that array as a JSON string; indexes number the array `main()` returns, and a
whole number stands for its index; a range must run low to high, `"1-3"` not
`"3-1"`), `between`
(exactly two selectors; `"all"` is refused there), `anchors` (boolean), `section` (an axis `"x"`/`"y"`/
`"z"`, an offset like `"z=5"`, or `{axis, offset}`). A part name is an anchor
frame name the `anchors` option reports (a dotted param path such as
`front.left`): the exact name, or a unique whole-segment suffix of one (`left`
for `front.left`), selects every item carrying that frame. An unknown name is
refused with the indexes and names the model has, and a suffix several names
share is refused as ambiguous. `src/partRefs.js` holds the matching rule; the
app's `view` look-at uses it too. A negative-volume geom3
gets `insideOut: true` and a `notes` entry saying it is inside out; for an
array, the note names each such part.

A section answers its net `area`, `boundingBox` and `dimensions`, `plane`
(the two axes its points use: `["y", "z"]` for x, `["x", "z"]` for y,
`["x", "y"]` for z) and `loops`, largest first: each `{ area, hole, points }`
with its outline cut to at most 40 points (collinear points dropped, then the
least significant ones) and rounded to 0.001 mm. At most 12 loops are listed;
`loopsLeftOut` counts the rest.

`check`'s only option: `bed` (optional), one of the named beds in `BEDS` (`mk3`, `mk4`,
`mini`, `x1`, `p1`, `a1mini`, `ender3`, case-insensitive) or its size in mm
as `[x, y, z]`, `{x, y, z}`, or a JSON array string (`"[x, y, z]"`). It
reports `watertight`, `manifold`, `openEdges`, `nonManifoldEdges`,
`selfIntersecting`, `insideOut`, `bbox` and `dimensions` for solids, with
`openEdgeSamples` (the midpoints of up to 5 open edges, to 0.001 mm) when
there are open edges and `intersectionSamples` likewise, and
`closed`/`outlines` for 2D profiles; `fitsBed` only when a bed is given. A negative-volume solid is never
`watertight`; `insideOut` and a `notes` entry say why.

For an array, `check` also intersects the solids whose bounding boxes overlap
and reports shared volume (above `INTERFERENCE_EPSILON`, 0.001 mm³) as
`interference: { pairs, total }`: each pair is `{ a, b, volume, size }`,
largest first, at most 20; `total` counts all. Candidates are intersected in
order of bounding-box overlap volume, largest first. At most
`MAX_INTERSECTIONS` (300) are intersected, and none is started once
`INTERFERENCE_BUDGET_MS` (5000 ms) has passed since the first: one plain-jscad
intersection of two 8192-polygon spheres takes about 2.3 s.
`interferenceUnchecked` counts the candidates left out by either limit, and
each pair whose intersection throws (Manifold rejects a non-manifold imported
mesh). Pass `interference: false` to skip this. Items with `previewOnly` are
not parts and are skipped.

An item tagged `reference = 'reason'` or `reference = { reason, allow? }` is a
stand-in for something outside the printed part. It still collides with other
parts unless `allow` lists them (selectors as in `measure`'s `parts`). `check`
lists each tagged item in `references` as `{ part, reason, allow?, overlaps }`,
where `overlaps` holds the allowed shared volumes, largest first. A malformed tag (no reason,
`allow` not a list, an unresolvable selector, a part allowing itself) adds a
`part N: ...` message to `tagErrors`.
