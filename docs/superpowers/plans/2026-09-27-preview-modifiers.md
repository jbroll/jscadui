# `%` and `#` Viewport Ghosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw OpenSCAD `%` (background) and `#` (highlight) subtrees as transparent ghosts in the jscad-web viewport while every export and the STL comparison exclude them.

**Architecture:** The runtime snapshots `%`/`#` children into overlay records kept in a `WeakMap` beside the real geometry; every geometry op carries its inputs' overlays to its result (affine ops compose a matrix onto them). The transpiled `main()` ends in `j$.withOverlays(...)`, which returns `[solid, ...ghosts]` with each ghost flagged `previewOnly: true`. Consumers (worker, `run-jscad.js`, grid cells) drop flagged items from anything exported or unioned.

**Tech Stack:** JavaScript ES modules (`packages/openscad-runtime`, `packages/worker`), TypeScript transpiler (`packages/openscad`), vitest, `@jscad/modeling` and `@jscadui/manifold` engines.

**Spec:** `docs/superpowers/specs/2026-09-27-preview-modifiers-design.md`

Worktree: `/home/john/src/jscadui/.worktrees/next-20260927b`, branch `work/next-20260927b`. All paths below are relative to it.

## Global Constraints

- Background ghost color `[0.5, 0.5, 0.5, 0.3]`; highlight ghost color `[1, 0.32, 0.32, 0.5]`; the child's own `color()` is ignored.
- Ghosts carry `previewOnly: true`; nothing in the runtime reads `$preview` for this feature (reading it latches `j$.previewUsed`).
- A model with no `%`/`#` must produce the same geometry as today: every wrapper takes the unwrapped path when there are no overlays.
- `*` keeps emitting `undefined`. `!` is out of scope.
- Targets modern browsers and Node 20+; no polyfills.
- Comments: default to none; one or two lines saying why, never what.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never open a pull request. Never run the full OpenSCAD comparison suite locally (`packages/openscad/CLAUDE.md`).
- Unit tests: `cd packages/openscad && npx vitest run <file>`; worker tests: `cd packages/worker && npx vitest run <file>`.

---

### Task 1: Overlay core module

**Files:**
- Create: `packages/openscad-runtime/src/sentinels.js`
- Create: `packages/openscad-runtime/src/overlay.js`
- Modify: `packages/openscad-runtime/src/primitives.js:10-16` (move `NO_CHILD` out)
- Modify: `packages/openscad-runtime/src/index.js` (imports, `init`, `j$` entries, named exports)
- Test: `packages/openscad/test/preview-overlays.test.ts`

**Model:** `sonnet` — code is given; needs care wiring a new module into the runtime without an import cycle.

**Interfaces:**
- Produces (from `overlay.js`):
  - `initOverlays(jscad)`
  - `class Ghosts { list; empty }` and `isGhosts(x): boolean`
  - `overlaysOf(x): Overlay[]` where `Overlay = { kind: 'background'|'highlight', mesh, matrix: number[16] }`
  - `strip(x)`: replaces `Ghosts` with `NO_CHILD` (or `undefined` when `empty`), filters them from arrays
  - `attach(result, list)`: returns `result` carrying `list`
  - `gathering(op)`: wrapper for ops that keep every input's overlays
  - `affine(matrixOf, op)`: wrapper for `(arg, geo)` ops; `matrixOf(arg, strippedGeo) => number[16]`
  - `IDENTITY`, `mul(a, b)` (column-major 4x4, index `col*4+row`)
  - `highlight(child)`, `background(child)`, `withOverlays(result)`
- Produces on `j$`: `j$.highlight`, `j$.background`, `j$.withOverlays`

- [ ] **Step 1: Move `NO_CHILD` to its own module**

`overlay.js` needs `NO_CHILD`, and `primitives.js` will import `overlay.js` in Task 2, so `NO_CHILD` moves out of `primitives.js` to avoid an import cycle.

Create `packages/openscad-runtime/src/sentinels.js`:

```js
/**
 * Sentinel for "no child produced by a conditional branch".
 * `if(cond) child` with cond=false and no else branch emits j$.NO_CHILD.
 * Distinct from undefined (which means "module/geometry produced nothing").
 * In intersection: NO_CHILD is absent (skipped); undefined makes intersection empty.
 */
export const NO_CHILD = Symbol('no_child')
```

In `primitives.js`, replace lines 10-16 (the doc comment and `export const NO_CHILD = Symbol('no_child')`) with:

```js
import { NO_CHILD } from './sentinels.js'
export { NO_CHILD }
```

(Put the `import` with the other imports at the top of the file and keep `export { NO_CHILD }` where the constant was.)

- [ ] **Step 2: Write the failing test**

Create `packages/openscad/test/preview-overlays.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

type Ghost = { polygons?: { vertices: number[][] }[], sides?: number[][][], color: number[], previewOnly: boolean }
const J = j$ as unknown as Record<string, any>

const bounds = (points: number[][]) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < p.length; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  return [lo.slice(0, points[0].length), hi.slice(0, points[0].length)]
}
const ghostBounds = (g: Ghost) => g.polygons
  ? bounds(g.polygons.flatMap(p => p.vertices))
  : bounds(g.sides!.flat())

describe('overlay core', () => {
  beforeAll(async () => { await initScadRuntime() })

  it('withOverlays returns a result without overlays unchanged', () => {
    const c = J.cube({ size: 10 })
    expect(J.withOverlays(c)).toBe(c)
    expect(J.withOverlays(undefined)).toBe(undefined)
  })

  it('highlight returns its child and adds a pink ghost', () => {
    const c = J.cube({ size: 10 })
    expect(J.highlight(c)).toBe(c)
    const out = J.withOverlays(c)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(c)
    expect(out[1].previewOnly).toBe(true)
    expect(out[1].color).toEqual([1, 0.32, 0.32, 0.5])
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('background returns a placeholder that is only a grey ghost', () => {
    const out = J.withOverlays(J.background(J.cube({ size: 4 })))
    expect(out).toHaveLength(1)
    expect(out[0].color).toEqual([0.5, 0.5, 0.5, 0.3])
    expect(ghostBounds(out[0])).toEqual([[0, 0, 0], [4, 4, 4]])
  })

  it('records nothing for an absent child', () => {
    expect(J.highlight(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.highlight(undefined)).toBe(undefined)
    expect(J.background(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.background(undefined)).toBe(J.NO_CHILD)
  })

  it('snapshots a 2D child as sides', () => {
    const out = J.withOverlays(J.background(J.square({ size: 3 })))
    expect(out[0].sides.length).toBeGreaterThan(0)
    expect(ghostBounds(out[0])).toEqual([[0, 0], [3, 3]])
  })

  it('keeps the ghost after the highlighted child is disposed', () => {
    const c = J.cube({ size: 10 })
    J.highlight(c)
    const out = J.withOverlays(c)
    c.dispose()
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('waits for a promised child', async () => {
    const out = await J.withOverlays(J.highlight(Promise.resolve(J.cube({ size: 2 }))))
    expect(out).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/openscad && npx vitest run test/preview-overlays.test.ts`
Expected: FAIL with `J.withOverlays is not a function` (or similar).

- [ ] **Step 4: Write `overlay.js`**

Create `packages/openscad-runtime/src/overlay.js`:

```js
/**
 * Ghost geometry for OpenSCAD's % (background) and # (highlight) modifiers.
 * Overlays ride beside the real geometry in a WeakMap and reach the viewport
 * as previewOnly entities, which every export drops.
 */
import { NO_CHILD } from './sentinels.js'

const COLORS = { background: [0.5, 0.5, 0.5, 0.3], highlight: [1, 0.32, 0.32, 0.5] }

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export const mul = (a, b) => {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  }
  return out
}

const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

let geom2, geom3

export const initOverlays = (jscad) => {
  geom2 = jscad.geometries.geom2
  geom3 = jscad.geometries.geom3
}

const table = new WeakMap()

// Stands in for a child whose only content is overlays. `empty` keeps the
// difference between an empty result (undefined) and an absent one (NO_CHILD).
export class Ghosts {
  constructor(list, empty) {
    this.list = list
    this.empty = empty
  }
}

export const isGhosts = (x) => x instanceof Ghosts

const isThenable = (x) => x !== null && typeof x === 'object' && typeof x.then === 'function'

const present = (g) => g !== undefined && g !== null && g !== NO_CHILD && !(g instanceof Ghosts)

export const overlaysOf = (x) => {
  if (x === null || typeof x !== 'object') return []
  if (Array.isArray(x)) return x.flatMap(overlaysOf)
  if (x instanceof Ghosts) return x.list
  return table.get(x) ?? []
}

export const strip = (x) => {
  if (x instanceof Ghosts) return x.empty ? undefined : NO_CHILD
  if (Array.isArray(x)) return x.filter(g => !(g instanceof Ghosts)).map(strip)
  return x
}

const forget = (x) => {
  if (x === null || typeof x !== 'object') return
  if (Array.isArray(x)) x.forEach(forget)
  else table.delete(x)
}

export const attach = (result, list) => {
  if (list.length === 0) return result
  if (isThenable(result)) return result.then(r => attach(r, list))
  if (Array.isArray(result)) {
    forget(result)
    return [...result, new Ghosts(list, false)]
  }
  if (result === null || typeof result !== 'object' || result instanceof Ghosts) {
    const empty = result === undefined || result === null || (result instanceof Ghosts && result.empty)
    return new Ghosts(list, empty)
  }
  table.set(result, list)
  return result
}

export const gathering = (op) => function (...args) {
  const list = overlaysOf(args)
  if (list.length === 0) return op.apply(this, args)
  return attach(op.apply(this, args.map(strip)), list)
}

export const affine = (matrixOf, op) => function (arg, geo) {
  const list = overlaysOf(geo)
  if (list.length === 0) return op.call(this, arg, geo)
  const g = strip(geo)
  const m = matrixOf(arg, g)
  return attach(op.call(this, arg, g), list.map(o => ({ ...o, matrix: mul(m, o.matrix) })))
}

// `in`, not a read: on ManifoldGeom2 these are getters that convert the cross-section.
const is2D = (g) => 'sides' in g || 'outlines' in g

const snapshot = (g) => {
  if (is2D(g)) return { dim: 2, sides: geom2.toSides(g).map(([a, b]) => [[a[0], a[1]], [b[0], b[1]]]) }
  const polygons = g.isManifoldGeom3 ? g.polygons : geom3.toPolygons(g)
  return { dim: 3, polygons: polygons.map(p => p.vertices.map(v => [v[0], v[1], v[2]])) }
}

// Taken now: under # the child is also a CSG input, and consume.js disposes it.
const snapshots = (kind, child) =>
  [child].flat(Infinity).filter(present).map(g => ({ kind, mesh: snapshot(g), matrix: IDENTITY }))

export const highlight = (child) => {
  if (isThenable(child)) return child.then(highlight)
  return attach(child, [...overlaysOf(child), ...snapshots('highlight', strip(child))])
}

export const background = (child) => {
  if (isThenable(child)) return child.then(background)
  const list = [...overlaysOf(child), ...snapshots('background', strip(child))]
  return list.length === 0 ? NO_CHILD : new Ghosts(list, false)
}

const ghostOf = ({ kind, mesh, matrix }) => {
  const flip = det3(matrix) < 0
  const base = { transforms: [...IDENTITY], color: [...COLORS[kind]], previewOnly: true }
  if (mesh.dim === 2) {
    const to2 = (p) => apply(matrix, [p[0], p[1], 0]).slice(0, 2)
    return { ...base, sides: mesh.sides.map(([a, b]) => flip ? [to2(b), to2(a)] : [to2(a), to2(b)]) }
  }
  return {
    ...base,
    polygons: mesh.polygons.map(vs => {
      const out = vs.map(v => apply(matrix, v))
      return { vertices: flip ? out.reverse() : out }
    }),
  }
}

export const withOverlays = (result) => {
  if (isThenable(result)) return result.then(withOverlays)
  const list = overlaysOf(result)
  if (list.length === 0) return result
  const solids = [strip(result)].flat(Infinity).filter(present)
  return [...solids, ...list.map(ghostOf)]
}
```

- [ ] **Step 5: Wire it into the runtime**

In `packages/openscad-runtime/src/index.js`:

Add to the imports (after the `consume.js` import):

```js
import { initOverlays, highlight as _highlight, background as _background, withOverlays as _withOverlays } from './overlay.js'
```

Add to the `j$` object, directly after the `color: _color,` entry:

```js
  // % and # modifiers (overlay.js)
  highlight: _highlight,
  background: _background,
  withOverlays: _withOverlays,
```

In `init(jscad, options)`, add `initOverlays(jscad)` after `initText(jscad)`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/openscad && npx vitest run test/preview-overlays.test.ts`
Expected: PASS (7 tests). If a bounds assertion fails only by float noise (e.g. `1e-15`), compare with `toBeCloseTo` per coordinate instead of `toEqual`.

- [ ] **Step 7: Run the whole openscad unit suite**

Run: `cd packages/openscad && npx vitest run`
Expected: PASS, same count as before plus 7. Nothing calls the new functions yet, so no other test changes.

- [ ] **Step 8: Commit**

```bash
git add packages/openscad-runtime/src/sentinels.js packages/openscad-runtime/src/overlay.js packages/openscad-runtime/src/primitives.js packages/openscad-runtime/src/index.js packages/openscad/test/preview-overlays.test.ts
git commit -m "feat(openscad-runtime): overlay records for % and # ghosts"
```

---

### Task 2: Carry overlays through every geometry op

**Files:**
- Modify: `packages/openscad-runtime/src/transforms.js` (whole file)
- Modify: `packages/openscad-runtime/src/primitives.js:241-259, 267-273, 464-517, 597-604`
- Modify: `packages/openscad-runtime/src/color.js:25-41`
- Modify: `packages/openscad-runtime/src/extrusions.js:37, 92`
- Modify: `packages/openscad-runtime/src/index.js` (`offset` method)
- Test: `packages/openscad/test/preview-overlays.test.ts` (append)

**Model:** `sonnet` — code is given; the matrix builders must match the engine, which the probe tests check.

**Interfaces:**
- Consumes: `gathering`, `affine`, `IDENTITY`, `mul`, `overlaysOf` from `overlay.js` (Task 1).
- Produces: the ops below carry overlays. Affine: `translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `resize`. Gathering: `safeUnion`, `safeUnion2D`, `union`, `subtract`, `intersect`, `hull`, `minkowski`, `color`, `offset`, `linearExtrude`, `rotateExtrude`. `childrenAt`/`childrenAtRange` carry through the wrapped `safeUnion` or by returning the child itself.

- [ ] **Step 1: Write the failing tests**

Append to `packages/openscad/test/preview-overlays.test.ts`:

```ts
describe('overlays through ops (manifold)', () => {
  let measure: (g: unknown) => number[][]
  beforeAll(async () => {
    const ctx = await initScadRuntime()
    measure = (g) => (ctx.jscadModeling as any).measurements.measureBoundingBox(g)
  })

  const cube = () => J.cube({ size: 10 })
  const close = (a: number[][], b: number[][]) => {
    for (let i = 0; i < 2; i++) for (let k = 0; k < a[i].length; k++) expect(a[i][k]).toBeCloseTo(b[i][k], 4)
  }

  // Each transform's ghost must land where the engine put the real geometry.
  const transforms: [string, (g: unknown) => unknown][] = [
    ['translate', g => J.translate([1, 2, 3], g)],
    ['rotate euler', g => J.rotate([10, 20, 30], g)],
    ['rotate scalar', g => J.rotate(40, g)],
    ['rotate a=[..]', g => J.rotate({ a: [0, 90, 0] }, g)],
    ['rotate axis', g => J.rotate({ a: 30, v: [1, 1, 0] }, g)],
    ['scale', g => J.scale([2, 1, 3], g)],
    ['scale uniform', g => J.scale(2, g)],
    ['mirror', g => J.mirror([1, 0, 0], g)],
    ['mirror short', g => J.mirror([0, 1], g)],
    ['multmatrix', g => J.multmatrix([[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0]], g)],
    ['resize', g => J.resize([20, 0, 0], g)],
  ]
  it.each(transforms)('%s moves the ghost with the geometry', (_name, op) => {
    const expected = measure(op(cube()))
    const out = J.withOverlays(op(J.highlight(cube())))
    expect(out).toHaveLength(2)
    close(ghostBounds(out[1]), expected)
    close(measure(out[0]), expected)
  })

  it('nested transforms compose in OpenSCAD order', () => {
    const expected = measure(J.translate([10, 0, 0], J.rotate([0, 0, 90], cube())))
    const out = J.withOverlays(J.translate([10, 0, 0], J.rotate([0, 0, 90], J.highlight(cube()))))
    close(ghostBounds(out[1]), expected)
  })

  it('a mirrored ghost keeps outward winding', () => {
    const [, ghost] = J.withOverlays(J.mirror([1, 0, 0], J.highlight(cube())))
    const [a, b, c] = ghost.polygons[0].vertices
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]
    const centroid = ghost.polygons[0].vertices.reduce((s: number[], v: number[]) => s.map((x, i) => x + v[i] / ghost.polygons[0].vertices.length), [0, 0, 0])
    const out = centroid.map((x: number, i: number) => x - (i === 0 ? -5 : 5))
    expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0)
  })

  const multi: [string, (a: unknown, b: unknown) => unknown][] = [
    ['safeUnion', (a, b) => J.safeUnion([a, [b]])],
    ['union', (a, b) => J.union(a, b)],
    ['subtract', (a, b) => J.subtract(a, b)],
    ['intersect', (a, b) => J.intersect(a, b)],
    ['hull', (a, b) => J.hull(a, b)],
    ['minkowski', (a, b) => J.minkowski(a, b)],
  ]
  it.each(multi)('%s keeps a highlighted operand\'s ghost', (_name, op) => {
    const out = J.withOverlays(op(cube(), J.highlight(J.translate([5, 5, 5], cube()))))
    expect(out.filter((g: Ghost) => g.previewOnly)).toHaveLength(1)
  })

  it.each(multi)('%s leaves a background operand out of the CSG', (_name, op) => {
    const plain = measure(op(cube(), J.NO_CHILD) ?? cube())
    const out = J.withOverlays(op(cube(), J.background(J.translate([50, 50, 50], cube()))))
    expect(out.filter((g: Ghost) => g.previewOnly)).toHaveLength(1)
    close(measure(out[0]), plain)
  })

  it('an undefined result still carries its operands\' ghosts', () => {
    // intersect with an empty (undefined) operand returns undefined
    const out = J.withOverlays(J.intersect(J.highlight(cube()), undefined))
    expect(out).toHaveLength(1)
    expect(out[0].previewOnly).toBe(true)
  })

  it('a highlighted child survives disposal by the op that consumes it', () => {
    const out = J.withOverlays(J.union(J.highlight(cube()), J.translate([20, 0, 0], cube())))
    close(ghostBounds(out[1]), [[0, 0, 0], [10, 10, 10]])
  })

  it('color, offset and the extrusions pass ghosts through', () => {
    expect(J.withOverlays(J.color('red', undefined, J.highlight(cube())))).toHaveLength(2)
    const sq = () => J.square({ size: 10 })
    expect(J.withOverlays(J.offset({ delta: 1 }, J.highlight(sq())))).toHaveLength(2)
    expect(J.withOverlays(J.linearExtrude({ height: 2 }, J.highlight(sq())))).toHaveLength(2)
    expect(J.withOverlays(J.rotateExtrude({}, J.highlight(J.translate([5, 0], sq()))))).toHaveLength(2)
  })

  it('childrenAt carries ghosts for one index and for a list', () => {
    const kids = [() => J.highlight(cube()), () => J.translate([20, 0, 0], cube())]
    expect(J.withOverlays(J.childrenAt(kids, 0))).toHaveLength(2)
    expect(J.withOverlays(J.childrenAt(kids, [0, 1]))).toHaveLength(2)
    expect(J.withOverlays(J.childrenAtRange(kids, 0, 1, 1))).toHaveLength(2)
  })

  it('a background-only transform chain stays absent', () => {
    const out = J.translate([1, 0, 0], J.background(cube()))
    expect(J.intersect(cube(), out)).toBeDefined()
    expect(J.withOverlays(out)).toHaveLength(1)
  })
})

// Every function on j$ is either a geometry op the tests above cover, or not
// a geometry op. A new function fails here until someone decides which.
const GEOMETRY_OPS = ['translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'resize', 'safeUnion', 'safeUnion2D',
  'union', 'subtract', 'intersect', 'hull', 'minkowski', 'childrenAt', 'childrenAtRange', 'color', 'offset',
  'linearExtrude', 'rotateExtrude']
const NOT_GEOMETRY_OPS: string[] = [/* Step 2 fills this */]

describe('overlay coverage', () => {
  it('classifies every function on j$', () => {
    const fns = Object.keys(J).filter(k => typeof J[k] === 'function').sort()
    const known = new Set([...GEOMETRY_OPS, ...NOT_GEOMETRY_OPS])
    expect(fns.filter(k => !known.has(k))).toEqual([])
  })
})
```

- [ ] **Step 2: Fill `NOT_GEOMETRY_OPS`**

Run: `cd packages/openscad && node -e "import('@jscadui/openscad-runtime').then(m => console.log(JSON.stringify(Object.keys(m.default).filter(k => typeof m.default[k] === 'function').sort())))"`

Put every name it prints that is not in `GEOMETRY_OPS` into `NOT_GEOMETRY_OPS`, sorted, one array literal. Check each one: a function that takes a geometry value as input (not one that only creates geometry from numbers, such as `cube` or `text`) belongs in `GEOMETRY_OPS` and needs a wrapper; stop and report it rather than listing it as not-geometry.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/openscad && npx vitest run test/preview-overlays.test.ts`
Expected: FAIL. The transform, multi-op, pass-through and childrenAt tests fail with length 1 instead of 2 (or an engine error on a `Ghosts` input). The coverage test passes.

- [ ] **Step 4: Transforms carry overlays by matrix**

Replace `packages/openscad-runtime/src/transforms.js` with:

```js
/**
 * Transform helpers for OpenSCAD compatibility
 */

import { NO_CHILD } from './sentinels.js'
import { consuming } from './consume.js'
import { affine, IDENTITY, mul } from './overlay.js'

// Filter null/undefined/NO_CHILD from geometry arrays before passing to JSCAD.
// OpenSCAD silently ignores absent children; JSCAD throws on null array elements.
const filterGeo = (geo) => {
  if (!Array.isArray(geo)) return geo
  const filtered = geo.filter(g => g != null && g !== NO_CHILD)
  return filtered.length === 0 ? undefined : filtered
}

// JSCAD transforms - injected at init time
let translate, rotateX, rotateY, rotateZ, scale, mirror, transform, measureBoundingBox

export const initTransforms = (jscad) => {
  translate = consuming(jscad.transforms.translate)
  rotateX = consuming(jscad.transforms.rotateX)
  rotateY = consuming(jscad.transforms.rotateY)
  rotateZ = consuming(jscad.transforms.rotateZ)
  scale = consuming(jscad.transforms.scale)
  mirror = consuming(jscad.transforms.mirror)
  transform = consuming(jscad.transforms.transform)
  measureBoundingBox = jscad.measurements.measureBoundingBox
}

const toRad = d => d * Math.PI / 180
const isNum = x => typeof x === 'number'
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum)

const translationMatrix = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scaleMatrix = ([x, y, z]) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const rotateXMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] }
const rotateYMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
const rotateZMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }

const translateVector = (v) => {
  // v can be [x,y] or [x,y,z] or an object with v property
  const vec = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  const [x = 0, y = 0, z = 0] = Array.isArray(vec) ? vec : [0, 0, 0]
  return [x, y, z]
}

const scaleVector = (v) => {
  // v can be a number (uniform), [x,y] or [x,y,z] or an object with v property
  const val = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  if (typeof val === 'number') return [val, val, val]
  const [x = 1, y = 1, z = 1] = Array.isArray(val) ? val : [1, 1, 1]
  return [x, y, z]
}

// OpenSCAD reads a short normal such as [0, 1] or [1] with zeros for the
// missing components; jscad builds its plane from all three, so a missing
// one makes the plane NaN.
const mirrorNormal = (v) => Array.isArray(v) && v.length < 3 ? [v[0] ?? 0, v[1] ?? 0, 0] : v
// OpenSCAD treats a zero normal as identity
const isZeroNormal = (n) => Array.isArray(n) && n[0] === 0 && n[1] === 0 && n[2] === 0

const mirrorMatrix = (v) => {
  const n = mirrorNormal(v)
  if (!Array.isArray(n) || isZeroNormal(n)) return IDENTITY
  const len = Math.hypot(n[0], n[1], n[2])
  const [x, y, z] = [n[0] / len, n[1] / len, n[2] / len]
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, 0, -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0, -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0, 0, 0, 0, 1]
}

// Rodrigues' rotation formula, column-major for JSCAD's transform; null for a
// near-zero axis, which OpenSCAD treats as no rotation.
const axisAngleMatrix = (angle, [x, y, z]) => {
  const len = Math.sqrt(x*x + y*y + z*z)
  if (len < 0.0001) return null
  const nx = x/len, ny = y/len, nz = z/len
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [
    t*nx*nx + c,    t*nx*ny + s*nz, t*nx*nz - s*ny, 0,
    t*nx*ny - s*nz, t*ny*ny + c,    t*ny*nz + s*nx, 0,
    t*nx*nz + s*ny, t*ny*nz - s*nx, t*nz*nz + c,    0,
    0, 0, 0, 1
  ]
}

const eulerMatrix = (a) => {
  let m = IDENTITY
  if (a[0] !== 0) m = mul(rotateXMatrix(toRad(a[0])), m)
  if (a[1] !== 0) m = mul(rotateYMatrix(toRad(a[1])), m)
  if (a[2] !== 0) m = mul(rotateZMatrix(toRad(a[2])), m)
  return m
}

// Mirrors _rotate's argument handling below, as a matrix for overlays.
const rotateMatrix = (params) => {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const a = params.a
    if (Array.isArray(a)) return eulerMatrix(a)
    if (!isNum(a)) return IDENTITY
    if (isVec3(params.v)) return axisAngleMatrix(toRad(a), params.v) ?? IDENTITY
    return a !== 0 ? rotateZMatrix(toRad(a)) : IDENTITY
  }
  if (!Array.isArray(params) && !isNum(params)) return IDENTITY
  return eulerMatrix(Array.isArray(params) ? params : [0, 0, params])
}

// OpenSCAD multmatrix uses row-major 4x4 or 4x3 matrix
// JSCAD transform uses column-major flat array [m00,m10,m20,m30,m01,m11,...]
const flatMatrix = (m) => {
  const flat = []
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < (m.length < 4 ? 3 : 4); row++) {
      flat.push(m[row] && m[row][col] !== undefined ? m[row][col] : (row === col ? 1 : 0))
    }
    if (m.length < 4) flat.push(col === 3 ? 1 : 0)
  }
  return flat
}

// newsize[i] = 0 means keep that axis unchanged
const resizeFactors = (newsize, geo) => {
  const bounds = measureBoundingBox(geo)
  const curSize = [
    bounds[1][0] - bounds[0][0],
    bounds[1][1] - bounds[0][1],
    bounds[1][2] - bounds[0][2],
  ]
  return newsize.map((s, i) => (s > 0 && curSize[i] > 0) ? s / curSize[i] : 1)
}

export const _translate = affine((v) => translationMatrix(translateVector(v)), (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return translate(translateVector(v), g)
})

export const _scale = affine((v) => scaleMatrix(scaleVector(v)), (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return scale(scaleVector(v), g)
})

export const _mirror = affine(mirrorMatrix, (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  const normal = mirrorNormal(v)
  if (isZeroNormal(normal)) return g
  return mirror({ normal }, g)
})

// Rotation helper for Euler angles
export const _rotate = affine(rotateMatrix, (params, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  geo = g
  // OpenSCAD (checked against 2026.09): an angle that is neither a number nor a
  // list (undef, a string) is no rotation; a number with an axis that is not a
  // 3-vector of numbers (undef, [0,1,0,0]) rotates about Z.
  // Handle object form: rotate(a=angle, v=[x,y,z]) or rotate(a=angle)
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const a = params.a
    // If a is an array (Euler angles), handle like rotate([x, y, z])
    if (Array.isArray(a)) {
      let result = geo
      if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
      if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
      if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
      return result
    }
    if (!isNum(a)) return geo
    const angle = toRad(a)
    if (isVec3(params.v)) {
      const m = axisAngleMatrix(angle, params.v)
      return m ? transform(m, geo) : geo
    }
    // No axis specified, rotate around Z (like rotate(a))
    return angle !== 0 ? rotateZ(angle, geo) : geo
  }
  // Handle Euler angles: rotate([x, y, z]) or rotate(z)
  if (!Array.isArray(params) && !isNum(params)) return geo
  const a = Array.isArray(params) ? params : [0, 0, params]
  let result = geo
  if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
  if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
  if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
  return result
})

// Resize helper - scales geometry to fit target dimensions
const resizeMatrix = (newsize, geo) => {
  const g = geo === NO_CHILD ? undefined : filterGeo(geo)
  return g == null ? IDENTITY : scaleMatrix(resizeFactors(newsize, g))
}

export const _resize = affine(resizeMatrix, (newsize, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return scale(resizeFactors(newsize, g), g)
})

// Multmatrix helper - applies a 4x4 transformation matrix
export const _multmatrix = affine(flatMatrix, (m, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return transform(flatMatrix(m), g)
})
```

- [ ] **Step 5: Multi-input ops gather overlays**

In `packages/openscad-runtime/src/primitives.js`:

Add to the imports: `import { gathering } from './overlay.js'`

Replace `_safeUnion` and `_safeUnion2D` (lines 250-259 and 267-273) with:

```js
const _safeUnionFlat = gathering((flattened) => _unionPresent(flattened))

export const _safeUnion = (parts) => {
  // Flatten nested arrays and filter out undefined/null/NO_CHILD values
  // This handles cases where children return empty arrays or nested undefined values
  const flattened = parts.flat(Infinity)

  // Check if any element is a Promise (async children thunks, e.g. from text())
  const hasPromise = flattened.some(p => p instanceof Promise || (p && typeof p.then === 'function'))
  if (hasPromise) return Promise.all(flattened).then(_safeUnionFlat)
  return _safeUnionFlat(flattened)
}
```

```js
// Children of linear_extrude/rotate_extrude: OpenSCAD extrudes the 2D ones and
// ignores 3D ones ("Ignoring 3D child object for 2D operation") in any order.
const _safeUnion2DFlat = gathering((all) => _unionPresent(all.filter(p => _isAbsent(p) || _is2D(p))))

export const _safeUnion2D = (parts) => {
  const flattened = parts.flat(Infinity)
  const hasPromise = flattened.some(p => p instanceof Promise || (p && typeof p.then === 'function'))
  if (hasPromise) return Promise.all(flattened).then(_safeUnion2DFlat)
  return _safeUnion2DFlat(flattened)
}
```

Wrap `_hull`, `_union`, `_subtract`, `_intersect` and `_minkowski` by changing each definition from `export const _X = (...args) => { ... }` to `export const _X = gathering((...args) => { ... })`, bodies unchanged. For example:

```js
export const _hull = gathering((...args) => {
  const valid = args.filter(a => !_isAbsent(a))
  if (valid.length === 0) return undefined
  return hull(...valid)
})
```

`_minkowski`'s internal `valid.reduce(_minkowski2D)` and `valid.reduce((a, b) => minkowski(a, b))` stay as they are.

- [ ] **Step 6: Pass-through ops**

`packages/openscad-runtime/src/color.js`: add `import { gathering } from './overlay.js'` and change `export const _color = (color, alpha, geo) => {` to `export const _color = gathering((color, alpha, geo) => {` with the closing `}` becoming `})`.

`packages/openscad-runtime/src/extrusions.js`: add `import { gathering } from './overlay.js'` and wrap `_linearExtrude` and `_rotateExtrude` the same way: `export const _linearExtrude = gathering((args, geo) => { ... })`, `export const _rotateExtrude = gathering(({ angle = 360, $fn, $fa, $fs } = {}, geo) => { ... })`.

`packages/openscad-runtime/src/index.js`: import `gathering` alongside the Task 1 overlay imports, and turn the `offset` method into a property that keeps `this`:

```js
  offset: gathering(function ({ r, delta, chamfer = false } = {}, child) {
    // (existing body unchanged)
  }),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd packages/openscad && npx vitest run test/preview-overlays.test.ts`
Expected: PASS. If a transform's probe test fails, the matrix builder disagrees with the engine: fix the builder, not the test.

- [ ] **Step 8: Run the whole openscad unit suite**

Run: `cd packages/openscad && npx vitest run`
Expected: PASS with no regressions. No model emits `%`/`#` wrappers yet, so every op takes its unwrapped path.

- [ ] **Step 9: Commit**

```bash
git add packages/openscad-runtime/src packages/openscad/test/preview-overlays.test.ts
git commit -m "feat(openscad-runtime): carry % and # overlays through geometry ops"
```

---

### Task 3: Consumers drop preview-only ghosts from exports

**Files:**
- Modify: `packages/worker/worker.js:299-371`
- Create: `packages/worker/worker.ghosts.test.js`
- Modify: `packages/openscad/bin/run-jscad.js:643-665, 808-832`
- Create: `packages/openscad/test/export-ghosts.test.ts`
- Modify: `apps/jscad-web/examples/lib/grid-utils.js:309`
- Modify: `apps/jscad-web/src/gridLayout.js:85`

**Model:** `sonnet` — three independent call sites with given code; the worker test needs judgment about what `JscadToCommon.prepare` produces for plain polygon objects.

**Interfaces:**
- Consumes: the ghost shape from Task 1: `{ polygons | sides, transforms, color, previewOnly: true }`.
- Produces: `export const exportedGeometry = (result) => ...` in `run-jscad.js`.

- [ ] **Step 1: Write the failing worker test**

Create `packages/worker/worker.ghosts.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, currentSolids } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const tri = () => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('preview-only ghosts', () => {
  afterEach(() => {
    workerState.main = undefined
    workerState.useParamsProxy = undefined
  })

  it('draws ghosts without keeping them as solids', async () => {
    const solid = { polygons: [tri()], transforms: identity }
    const ghost = { polygons: [tri()], transforms: identity, color: [0.5, 0.5, 0.5, 0.3], previewOnly: true }
    workerState.main = () => [solid, ghost]

    const result = await jscadMain({ params: {} })

    expect(result.entities).toHaveLength(2)
    expect(result.entities.some(e => e.color?.[3] === 0.3)).toBe(true)
    expect(workerState.solids).toEqual([solid])
  })
})
```

Read `worker.stream.test.js` first; if `currentSolids` is not what reads `workerState.solids`, drop it from the import. If `prepare` merges entities differently than one per solid, assert on what distinguishes the ghost (its color) rather than the count, and say so in the report.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/worker && npx vitest run worker.ghosts.test.js`
Expected: FAIL: `workerState.solids` contains the ghost.

- [ ] **Step 3: Split ghosts in the worker**

In `packages/worker/worker.js`, inside `jscadMain`, replace the three `workerState.solids = flatten(await runMain(...))` assignments (lines 319, 325, 329) with assignments to a local `let out`, declared just before `let proxyState = null`, and add right after the `if (workerState.useParamsProxy) { ... } else { ... }` block:

```js
    // % and # ghosts are drawn but never exported, so they stay out of solids
    const ghosts = out.filter(g => g?.previewOnly)
    workerState.solids = ghosts.length ? out.filter(g => !g?.previewOnly) : out
```

In the `streamParts` branch, after `for (const solid of workerState.solids) hook.emit([solid])`, add:

```js
      if (ghosts.length) hook.emit(ghosts)
```

Before adding that line, read `packages/worker/src/stream.js` and confirm `hook.emit` does not push into `workerState.solids`; if it does, skip this line and report it.

In the non-streamed branch, change the `JscadToCommon.prepare(workerState.solids, ...)` call to:

```js
        const prepared = toRefs(JscadToCommon.prepare(ghosts.length ? [...workerState.solids, ...ghosts] : workerState.solids, undefined, workerState.userInstances).all, heldSet, [])
```

- [ ] **Step 4: Run the worker tests**

Run: `cd packages/worker && npx vitest run`
Expected: PASS, including the new test.

- [ ] **Step 5: Write the failing run-jscad test**

Create `packages/openscad/test/export-ghosts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { exportedGeometry } from '../bin/run-jscad.js'

describe('exportedGeometry', () => {
  it('drops preview-only ghosts from a result list', () => {
    const solid = { id: 1 }
    expect(exportedGeometry([solid, { previewOnly: true }])).toEqual([solid])
  })

  it('is null when only ghosts remain', () => {
    expect(exportedGeometry([{ previewOnly: true }])).toBe(null)
  })

  it('passes a single geometry through', () => {
    const solid = { id: 1 }
    expect(exportedGeometry(solid)).toBe(solid)
  })
})
```

Run: `cd packages/openscad && npx vitest run test/export-ghosts.test.ts`
Expected: FAIL: `exportedGeometry` is not exported.

- [ ] **Step 6: Filter ghosts in run-jscad.js**

Add above `evalScadSolidSync` in `packages/openscad/bin/run-jscad.js`:

```js
// % and # ghosts are viewport-only; OpenSCAD leaves them out of every export.
export const exportedGeometry = (result) => {
  if (!Array.isArray(result)) return result
  const solids = result.flat(Infinity).filter(g => g && !g.previewOnly)
  return solids.length === 0 ? null : solids
}
```

In `evalScadSolidSync`, replace the final line `return Array.isArray(result) ? jscadModeling.booleans.union(result) : result` with:

```js
  const geometry = exportedGeometry(result)
  if (geometry === null) return null
  return Array.isArray(geometry) ? jscadModeling.booleans.union(geometry) : geometry
```

(`raw` keeps returning everything: it feeds display checks, which draw ghosts too.)

In the CLI `main()`, right after the `writeEcho()` that follows the main-call block (line 808), add:

```js
    result = exportedGeometry(result)
```

- [ ] **Step 7: Grid cells drop ghosts**

`apps/jscad-web/examples/lib/grid-utils.js:309`:

```js
          const geoms = [].concat(await fn(params[name])).flat().filter(g => !g?.previewOnly)
```

`apps/jscad-web/src/gridLayout.js:85` (inside the generated source template):

```js
      const geoms = [].concat(fn(params[name])).flat().filter(g => !g?.previewOnly)
```

- [ ] **Step 8: Run tests**

Run: `cd packages/openscad && npx vitest run`
Expected: PASS.
Run: `cd apps/jscad-web && npx vitest run src/gridLayout.test.js`
Expected: PASS (update an exact-source snapshot there if one captures line 85).

- [ ] **Step 9: Commit**

```bash
git add packages/worker/worker.js packages/worker/worker.ghosts.test.js packages/openscad/bin/run-jscad.js packages/openscad/test/export-ghosts.test.ts apps/jscad-web/examples/lib/grid-utils.js apps/jscad-web/src/gridLayout.js
git commit -m "feat: keep % and # ghosts out of worker solids, run-jscad and grid cells"
```

---

### Task 4: Transpiler emits `%`/`#` wrappers and `withOverlays`

**Files:**
- Modify: `packages/openscad/src/transpiler/statements.ts:174-178, 541-551`
- Modify: `packages/openscad/src/transpiler/transpile.ts:577-581`
- Create: `packages/openscad/test/preview-modifiers.test.ts`
- Modify: any existing test that asserts `%` transpiles to `undefined` or that `main` returns bare `j$.safeUnion(`

**Model:** `sonnet` — small transpiler edit, but emitted code affects every model; must update existing expectations carefully.

**Interfaces:**
- Consumes: `j$.highlight`, `j$.background`, `j$.withOverlays` (Task 1), op propagation (Task 2), consumer filtering (Task 3).

**Do not commit this task.** Transpiler changes are committed only after the full GPU comparison baseline passes (`packages/openscad/CLAUDE.md`). Leave the changes staged-ready in the working tree and report the unit test results; the controller runs the GPU baseline and commits.

- [ ] **Step 1: Write the failing test**

Create `packages/openscad/test/preview-modifiers.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

const code = (src: string) => transpile(parse(src).ast, { currentFile: '/m.scad' }).code

const run = (src: string) => {
  const fn = new Function('require', 'module', 'exports', 'j$', code(src))
  const mod = { exports: {} as Record<string, unknown> }
  fn(() => ({}), mod, mod.exports, j$)
  return (mod.exports.main as () => any)()
}

type G = { previewOnly?: boolean, color?: number[], polygons?: { vertices: number[][] }[], volume?: () => number }
const ghosts = (r: G[]) => r.filter(g => g.previewOnly)
const solids = (r: G[]) => r.filter(g => !g.previewOnly)
const zRange = (g: G) => {
  const zs = g.polygons!.flatMap(p => p.vertices.map(v => v[2]))
  return [Math.min(...zs), Math.max(...zs)]
}

describe('% and # emission', () => {
  it('wraps % children in j$.background', () => {
    expect(code('%cube(1);')).toContain('j$.background(')
    expect(code('%if (true) cube(1);')).toContain('j$.background(')
    expect(code('%for (i = [0:1]) cube(1);')).toContain('j$.background(')
  })

  it('wraps # children in j$.highlight', () => {
    expect(code('#cube(1);')).toContain('j$.highlight(')
    expect(code('#if (true) cube(1);')).toContain('j$.highlight(')
  })

  it('leaves * disabled', () => {
    const c = code('*cube(1);')
    expect(c).not.toContain('j$.background(')
    expect(c).not.toContain('j$.highlight(')
  })

  it('routes main through j$.withOverlays', () => {
    expect(code('cube(1);')).toContain('j$.withOverlays(j$.safeUnion(')
  })
})

describe('% and # results', () => {
  beforeAll(async () => { await initScadRuntime() })

  it('a model without modifiers returns one geometry', () => {
    expect(Array.isArray(run('cube(10);'))).toBe(false)
  })

  it('# inside difference shows the cutter and still cuts', () => {
    const r = run('difference() { cube(10); #translate([5, 5, -1]) cylinder(h = 12, r = 2); }')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].color).toEqual([1, 0.32, 0.32, 0.5])
    expect(zRange(ghosts(r)[0])[0]).toBeCloseTo(-1, 4)
    expect(zRange(ghosts(r)[0])[1]).toBeCloseTo(11, 4)
    expect(solids(r)[0].volume!()).toBeLessThan(1000)
  })

  it('% stays out of the solid', () => {
    const r = run('%cube(50); cube(10);')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].color).toEqual([0.5, 0.5, 0.5, 0.3])
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
  })

  it('a %-only model returns only its ghost', () => {
    const r = run('%cube(5);')
    expect(r).toHaveLength(1)
    expect(r[0].previewOnly).toBe(true)
  })

  it('a % child of intersection is left out of it', () => {
    const r = run('intersection() { cube(10); %sphere(100); }')
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
  })

  it('% inside a module call follows the call\'s transform', () => {
    const r = run('module m() { %cube(1); cube(1); }\ntranslate([0, 0, 20]) m();')
    expect(zRange(ghosts(r)[0])).toEqual([20, 21])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/openscad && npx vitest run test/preview-modifiers.test.ts`
Expected: FAIL: no `j$.background(` / `j$.highlight(` / `j$.withOverlays(` in the output.

- [ ] **Step 3: Emit the wrappers for module instantiations**

In `packages/openscad/src/transpiler/statements.ts`, rename the existing `function transpileModuleInstantiation(stmt, ctx)` to `transpileModuleInstantiationBody`, delete its modifier block (the comment and `if (stmt.tagBackground || stmt.tagDisabled) { return 'undefined' }` at lines 544-551), and add above it:

```ts
/**
 * Transpile a module instantiation (e.g., cube(10), translate([1,2,3]) child)
 * with its modifier: * drops it, % draws it as a ghost only, # draws it and a ghost.
 */
function transpileModuleInstantiation(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  if (stmt.tagDisabled) return 'undefined'
  const code = transpileModuleInstantiationBody(stmt, ctx)
  if (stmt.tagBackground) return `j$.background(${code})`
  if (stmt.tagHighlight) return `j$.highlight(${code})`
  return code
}
```

If `tagHighlight` is not declared on `ModuleInstantiationStmt` (check `ast-types.ts` and the parser's node for `tagBackground`), add it next to `tagBackground` with the same type.

- [ ] **Step 4: Emit the wrappers for if/else**

Replace lines 174-185 (the `isIfElseStatement` branch) with:

```ts
  if (isIfElseStatement(stmt)) {
    if (stmt.tagDisabled) return 'undefined'
    const cond = transpileExpression(stmt.cond, ctx)
    const thenPart = transpileStatement(stmt.thenBranch, ctx) || 'undefined'
    const elsePart = stmt.elseBranch ? transpileStatement(stmt.elseBranch, ctx) : 'j$.NO_CHILD'
    ctx.codeGen.usedHelpers.add('isTruthy')
    let code = `(j$.isTruthy(${cond})) ? (${thenPart}) : (${elsePart})`
    if (stmt.tagBackground) code = `j$.background(${code})`
    else if (stmt.tagHighlight) code = `j$.highlight(${code})`
    return comment ? `${comment}${code}` : code
  }
```

Add `tagHighlight` to the if/else node type the same way if it is missing.

- [ ] **Step 5: Wrap main**

In `packages/openscad/src/transpiler/transpile.ts:577-581`, replace:

```ts
  // Always route through safeUnion, including for a single statement: it is
  // what strips j$.NO_CHILD, which main() must never hand back to a caller.
  const mainBody = allGeometry.length > 0
    ? `j$.safeUnion([\n${allGeometry.map(p => `    ${p}`).join(',\n')}\n  ])`
    : undefined
```

with:

```ts
  // Always route through safeUnion, including for a single statement: it is
  // what strips j$.NO_CHILD, which main() must never hand back to a caller.
  // withOverlays appends the % and # ghosts, if any, as previewOnly entries.
  const mainBody = allGeometry.length > 0
    ? `j$.withOverlays(j$.safeUnion([\n${allGeometry.map(p => `    ${p}`).join(',\n')}\n  ]))`
    : undefined
```

- [ ] **Step 6: Run the new test**

Run: `cd packages/openscad && npx vitest run test/preview-modifiers.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole unit suite and fix stale expectations**

Run: `cd packages/openscad && npx vitest run`
Expected: failures only in tests that assert the old emitted text (`'undefined'` for `%`, or `return j$.safeUnion(` for `main`). Update those expectations to the new text. Any other failure is a real regression: stop and report it with the output.

Run: `npm run build` in `packages/openscad` (the CLI `run-jscad.js` reads `esm/`), then:
`node bin/run-jscad.js ../../apps/jscad-web/examples/openscad/<path to rubber_duck_debugging.scad> --timeout 60 -o /tmp/claude-1000/duck.stl` (find the path with `git ls-files | grep rubber_duck_debugging`). Expected: writes an STL; report its vertex count or size.

- [ ] **Step 8: Stop without committing**

Report: files changed, unit test counts, the stale expectations you updated and why, and the `run-jscad.js` result. Do not commit.

---

### Task 5: Documentation

**Files:**
- Modify: `docs/backlog.md` ("Library bugs found by the sweep" section)
- Modify: `apps/jscad-web/docs/architecture.md`
- Modify: `packages/openscad/ARCHITECTURE.md`

**Model:** `sonnet` — prose that must match the implemented behavior.

- [ ] **Step 1: Backlog**

In `docs/backlog.md`, delete the `%` background bullet under "Library bugs found by the sweep" (it starts `**\`%\` background (and \`#\` highlight) modifiers draw nothing**`) and add two bullets in its place:

```markdown
- **`!` root modifier is ignored.** OpenSCAD renders only the `!` subtree;
  we render the whole model. Needs `main()` to return that subtree with its
  ancestors' transforms, which the `%`/`#` overlay channel does not provide.
- **Ghosts are not drawn in ALL.js grid cells.** Cells drop `previewOnly`
  items before `normalizeAndPlace`; drawing them needs placement and the
  streaming claims to carry them.
```

- [ ] **Step 2: Architecture docs**

In `apps/jscad-web/docs/architecture.md`, add a short subsection near the worker/frame description:

```markdown
### `%` and `#` ghosts

A transpiled OpenSCAD `main()` returns `[solid, ...ghosts]` when the model
uses `%` or `#`. Ghosts are plain geom3/geom2 objects with `previewOnly: true`
and a translucent color (background grey, highlight pink). The worker draws
them as entities but keeps them out of `workerState.solids`, so export never
sees them; `run-jscad.js` and grid cells drop them the same way.
```

In `packages/openscad/ARCHITECTURE.md`, add a section on the runtime side: `%`/`#` emit `j$.background(child)`/`j$.highlight(child)`; `overlay.js` keeps overlay records (`{ kind, mesh, matrix }`) in a `WeakMap` keyed by result geometry; affine ops compose their matrix onto overlays and the other ops gather their inputs' overlays; a `Ghosts` placeholder stands in for a child with only overlays and reads as `NO_CHILD`; `main()` ends in `j$.withOverlays`, which never reads `$preview`. Keep it to one or two short paragraphs, plain words.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md apps/jscad-web/docs/architecture.md packages/openscad/ARCHITECTURE.md
git commit -m "docs: % and # ghosts in the viewport"
```

---

### Controller steps after Task 4 (not dispatched)

1. Full GPU OpenSCAD comparison from `packages/openscad` (`npm test`, run in the background). Expected diffs only in models using `%`/`#`; nopscadlib 146/146 with `--preview`. Record the run in `packages/openscad/MODEL_COMPARISON_BASELINE.md`, then commit Task 4 with the baseline entry.
2. Task 5.
3. Render sweep via simple-ci per `apps/jscad-web/e2e/RENDER-TESTING.md`; `rubber_duck_debugging.scad`, `issue1005.scad` and other `%`/`#` empties should leave the failure list. Update `render-baseline.json` from that job and commit.
4. Look at a `#`-in-`difference` model and a `%` model in the browser.
5. Final commit before merge deletes this plan and the spec.
