# Trial signal batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the model-design trial real interference signal: the agent can list overlapping part pairs, the eval probe reports truncation instead of silently stopping, the nema17 fixture checks centering, and the parts sweep varies a second axis.

**Architecture:** Bounding-box overlap listing in model-tools (cheap, no boolean engine needed) exposed as a measure tool option; non-breaking count fields on the eval probe; one new fixture check; one optional record field consumed by the sweep.

**Tech Stack:** ES2022, vitest, @jscad/modeling in tests, OpenSCAD fixture libs in parts tests.

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run package-scoped vitest files, not the full OpenSCAD suite locally.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0.
- YAGNI: bounding-box overlap only (no intersection volumes in the agent tool); no new eval fixture, no facade.
- Commit each task separately on the current branch (working in place per user choice).
- The pre-commit hook is red on a pre-existing unrelated failure (`apps/jscad-web/test/storage-rowboat.test.js`, tracked in `docs/backlog.md` Remaining issues). When scoped gates are green and the hook blocks only on that failure, commit with `--no-verify` and say so in the report.

---

### Task 1: List overlapping part pairs from the measure tool

**Files:**
- Modify: `packages/model-tools/src/measure.js`
- Modify: `packages/model-tools/test/measure.test.js`
- Modify: `packages/agent-loop/src/tools.js`
- Modify: `packages/agent-loop/test/tools.test.js`

**Interfaces:**
- Consumes: `measureBetween(geom, geomType, [a, b])` in `packages/model-tools/src/measure.js:108-125` (gap, boxesOverlap, distance per pair); `measure(geometry, options)` at `:181-198`.
- Produces: `measureOverlaps(geom, geomType)` exported from the same module; `measure(geometry, { overlaps: true })` returns `{ pairs, totalPairs, capped }`; tool schema gains an `overlaps` boolean the prompt renders automatically.

- [ ] **Step 1: Write the failing tests**

In `packages/model-tools/test/measure.test.js`, append:

```js
test('measureOverlaps lists every box-overlapping pair with its gap', () => {
  const scene = [cube(0), cube(3), cube(10)]
  const r = measureOverlaps(scene, 'array')
  expect(r.totalPairs).toBe(1)
  expect(r.capped).toBe(false)
  expect(r.pairs).toEqual([{ a: '0', b: '1', gap: [-2, -5, -5], distance: 0 }])
})

test('measure answers overlaps:true with the pair list', () => {
  const out = measure([cube(0), cube(3), cube(10)], { overlaps: true })
  expect(out.overlaps.totalPairs).toBe(1)
  expect(out.overlaps.pairs).toHaveLength(1)
})
```

In `packages/agent-loop/test/tools.test.js`, inside the top-level `describe`, add:

```js
it('offers an overlaps switch on measure for interference triage', () => {
  const { overlaps } = TOOLS.find((t) => t.name === 'measure').inputSchema.properties
  expect(overlaps.type).toBe('boolean')
  expect(overlaps.description).toMatch(/overlap/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/model-tools/test/measure.test.js packages/agent-loop/test/tools.test.js`
Expected: FAIL. `measureOverlaps` is not defined; schema has no `overlaps` property.

- [ ] **Step 3: Write minimal implementation**

In `packages/model-tools/src/measure.js`, after `measureBetween`, add:

```js
const OVERLAP_LIMIT = 50

// Every index pair whose bounding boxes overlap, with the same gap/distance
// shape as measureBetween. Bounding boxes only: cheap triage, not proof of
// shared volume; follow up with between or section for an exact answer.
export const measureOverlaps = (geom, geomType) => {
  const items = itemsOf(geom, geomType)
  const boxes = items.map((_, i) => measureSelection(items, String(i)).boundingBox)
  const pairs = []
  let totalPairs = 0
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const gap = [0, 1, 2].map((k) => roundMicron(Math.max(boxes[b][0][k] - boxes[a][1][k], boxes[a][0][k] - boxes[b][1][k])))
      if (!gap.every((g) => g < 0)) continue
      totalPairs++
      if (pairs.length === OVERLAP_LIMIT) continue
      const between = measureBetween(geom, geomType, [String(a), String(b)])
      pairs.push({ a: String(a), b: String(b), gap: between.gap, distance: between.distance })
    }
  }
  return { pairs, totalPairs, capped: totalPairs > pairs.length }
}
```

In `measure()`, destructure `overlaps` from options and add:

```js
if (overlaps === true) out.overlaps = measureOverlaps(wrapped, geomType)
else if (overlaps !== undefined && overlaps !== false) throw new Error('overlaps takes no value; pass overlaps: true to list box-overlapping part pairs')
```

In `packages/agent-loop/src/tools.js`, in the measure properties after `between`, add:

```js
overlaps: { type: 'boolean', description: 'List every pair of parts whose bounding boxes overlap, with per-axis gap and distance; pairs past 50 are counted but not listed' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/model-tools/test/measure.test.js packages/agent-loop/test/tools.test.js`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/model-tools/src/measure.js packages/model-tools/test/measure.test.js packages/agent-loop/src/tools.js packages/agent-loop/test/tools.test.js
git commit -m "feat(measure): list box-overlapping part pairs via overlaps:true"
```

### Task 2: Report eval probe overlap truncation instead of silently stopping

**Files:**
- Modify: `packages/agent-loop/eval/probe.js`
- Test: `packages/agent-loop/eval/probe.test.js`

**Interfaces:**
- Consumes: `overlapsOf(groups, boxes)` in `packages/agent-loop/eval/probe.js:295-306`, `MAX_OVERLAP_PAIRS = 45` at `:15`; `runProbe` at `:312-328` sets `out.overlaps`.
- Produces: same `out.overlaps` array shape (capped at 45 as today), plus `out.overlapCount` (total box-overlapping pairs) and `out.overlapsCapped` (true when the list was cut). Existing fixture consumers of the array keep working.

- [ ] **Step 1: Write the failing test**

In `packages/agent-loop/eval/probe.test.js`, after the existing overlaps test (`:51-56`), add:

```js
it('reports the overlap total and cap past 45 pairs', () => {
  const p = (await import('@jscad/modeling')).default
  const bodies = Array.from({ length: 11 }, () => p.primitives.cuboid({ size: [5, 5, 5] }))
  const { overlaps, overlapCount, overlapsCapped } = runProbe(bodies, { bodies: { overlaps: true } })
  expect(overlaps).toHaveLength(45)
  expect(overlapCount).toBe(55)
  expect(overlapsCapped).toBe(true)
})

it('reports an uncapped overlap count on a small model', () => {
  const { overlaps, overlapCount, overlapsCapped } = runProbe([a, b, far], { bodies: { overlaps: true } })
  expect(overlaps).toHaveLength(1)
  expect(overlapCount).toBe(1)
  expect(overlapsCapped).toBe(false)
})
```

Note: the test file already defines `a`, `b`, `far` and imports the probe helpers at the top; match the existing test's import style for `@jscad/modeling` (read the top of `probe.test.js` first — if it already imports modeling as `p` or similar, use that instead of the dynamic import).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-loop/eval/probe.test.js`
Expected: FAIL. `overlapCount` is undefined; `overlaps` stops at 45 with no signal.

- [ ] **Step 3: Write minimal implementation**

In `packages/agent-loop/eval/probe.js`, change `overlapsOf` to count box-overlapping pairs without boolean cost past the cap:

```js
const overlapsOf = (groups, boxes) => {
  const solids = groups.map((polygons) => geometries.geom3.fromPoints(polygons))
  const pairs = []
  let totalPairs = 0
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (!boxesOverlap(boxes[a], boxes[b])) continue
      totalPairs++
      if (pairs.length === MAX_OVERLAP_PAIRS) continue
      pairs.push({ a, b, volume: measurements.measureVolume(booleans.intersect(solids[a], solids[b])) })
    }
  }
  return { pairs, totalPairs, capped: totalPairs > pairs.length }
}
```

In `runProbe`, replace `if (spec.bodies.overlaps) out.overlaps = overlapsOf(groups, boxes)` with:

```js
if (spec.bodies.overlaps) {
  const { pairs, totalPairs, capped } = overlapsOf(groups, boxes)
  out.overlaps = pairs
  out.overlapCount = totalPairs
  out.overlapsCapped = capped
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/agent-loop/eval/probe.test.js packages/agent-loop/eval/fixtures.test.js`
Expected: PASS, including the 2 new tests and all existing overlaps/sliding-lid-box consumers.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/eval/probe.js packages/agent-loop/eval/probe.test.js
git commit -m "fix(eval): report overlap total and truncation past 45 pairs"
```

### Task 3: Check the nema17 centre hole sits centred among the screw holes

**Files:**
- Modify: `packages/agent-loop/eval/fixtures/nema17-mount.js`
- Test: `packages/agent-loop/eval/fixtures.test.js`

**Interfaces:**
- Consumes: `zHoles`, `isSquarePitch` in `nema17-mount.js:19-44`; `checks(m, { solid, probe, source })` at `:53-65` returning 6 named checks.
- Produces: a 7th check, `centre hole sits centred among the screw holes`, passing when the ≥22 mm hole's centre is within 1 mm of the four M3 corners' centroid. The existing 6 checks are unchanged.

- [ ] **Step 1: Write the failing test**

In `packages/agent-loop/eval/fixtures.test.js`, extend the `nemaPlate` helper with a centre offset (default `[0, 0]`):

```js
function nemaPlate({ pitch = 31, holes = true, size = 50, thickness = 4, centreAt = [0, 0] } = {}) {
  const plate = p.cuboid({ size: [size, size, thickness] })
  if (!holes) return plate
  const half = pitch / 2
  const corner = p.cylinder({ radius: 1.7, height: 10, segments: 64 })
  const corners = [[half, half], [half, -half], [-half, half], [-half, -half]].map(([x, y]) =>
    transforms.translate([x, y, 0], corner),
  )
  const centre = transforms.translate([centreAt[0], centreAt[1], 0], p.cylinder({ radius: 12, height: 10, segments: 64 }))
  return booleans.subtract(plate, booleans.union(...corners, centre))
}
```

Then add after the 31 mm-pitch test (`:323-329`):

```js
it('nema17-mount fails an off-centre boss hole', () => {
  const shape = nemaPlate({ centreAt: [5, 0] })
  const probe = runProbe(shape, byName['nema17-mount'].probe)
  const results = byName['nema17-mount'].checks(measure([shape], {}), ctx(shape, { source: STEPPER_AND_SCREW_REQUIRE, probe }))
  expect(results.find((c) => c.name === 'four M3 holes on a 31mm square').pass).toBe(true)
  expect(results.find((c) => c.name === 'a centre hole at least 22mm wide for the boss').pass).toBe(true)
  expect(results.find((c) => c.name === 'centre hole sits centred among the screw holes').pass).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-loop/eval/fixtures.test.js -t nema17`
Expected: FAIL. No check named `centre hole sits centred among the screw holes` exists, so `.pass` reads undefined.

- [ ] **Step 3: Write minimal implementation**

In `packages/agent-loop/eval/fixtures/nema17-mount.js`, in `checks`, after `centre` is found add:

```js
const centred = (() => {
  if (!centre || corners.length !== 4) return false
  const mx = corners.reduce((s, c) => s + c.cx, 0) / 4
  const my = corners.reduce((s, c) => s + c.cy, 0) / 4
  return Math.hypot(centre.cx - mx, centre.cy - my) <= 1
})()
```

and append to the returned array:

```js
{ name: 'centre hole sits centred among the screw holes', pass: centred },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/agent-loop/eval/fixtures.test.js -t nema17`
Expected: PASS, all 6 nema17 tests including the new off-centre one. Then run the full fixtures file once: `npx vitest run packages/agent-loop/eval/fixtures.test.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/eval/fixtures/nema17-mount.js packages/agent-loop/eval/fixtures.test.js
git commit -m "fix(eval): check the nema17 boss hole sits centred among the screw holes"
```

### Task 4: Sweep a second axis via record-level sweepArgs

**Files:**
- Modify: `packages/parts/src/records.js`
- Modify: `packages/parts/bin/check.js`
- Modify: `packages/parts/test/records.test.js`
- Modify: `packages/parts/test/check.test.js`
- Modify: `packages/parts/catalog/nopscadlib/screw.json` (first adopter)
- Modify: `packages/parts/docs/user-manual.md` (record format docs)
- Regenerate: `packages/parts/derived.json` screw entry via `node bin/check.js nopscadlib/screw --write`

**Interfaces:**
- Consumes: `validateRecord` in `packages/parts/src/records.js:22-29`; `checkRecord` sweep loop in `packages/parts/bin/check.js:33-46` building `[name, ...(record.insertArgs ?? [])]`.
- Produces: optional `sweepArgs` (array of arrays); the sweep builds each size once with `insertArgs` (unchanged default path) plus once per `sweepArgs` entry. Browser insert and `example` keep using `insertArgs`.

- [ ] **Step 1: Write the failing tests**

In `packages/parts/test/records.test.js`, beside the insertArgs test (`:22-23`), add:

```js
it('refuses sweepArgs that is not an array of arrays', () => {
  expect(() => validateRecord(rec({ sweepArgs: [10] }))).toThrow(/"sweepArgs" must be an array of arrays/)
})
```

In `packages/parts/test/check.test.js`, after the insertArgs sweep test (`:44-50`), add:

```js
it('sweeps each size once more per sweepArgs entry', async () => {
  const [record] = readRecords(catalogDir)
  const rod = { ...record, call: 'rod', sizes: { names: ['M2_block', 'M3_block'] }, insertArgs: [5], sweepArgs: [['not-a-number']] }
  const result = await checkRecord(rod, { libsDir })
  expect(result.ok).toBe(false)
  expect(result.failures.some((f) => f.includes('not-a-number'))).toBe(true)
})
```

(The `rod` fixture asserts its length is a number, so a non-number second axis fails the build and proves the axis ran. Read the top of `records.test.js` for its `rec()` helper before writing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/parts/test/records.test.js packages/parts/test/check.test.js`
Expected: FAIL. `sweepArgs` passes validation silently and the sweep never builds it.

- [ ] **Step 3: Write minimal implementation**

In `packages/parts/src/records.js`, in `validateRecord` after the insertArgs line, add:

```js
if ('sweepArgs' in record && !(Array.isArray(record.sweepArgs) && record.sweepArgs.every(Array.isArray))) {
  throw new Error(`${path}: "sweepArgs" must be an array of arrays`)
}
```

In `packages/parts/bin/check.js`, replace the sweep loop body (`:34-46`) argument construction with:

```js
const argSets = [record.insertArgs ?? [], ...(record.sweepArgs ?? [])]
for (const name of sizes) {
  if (record.sizes.names && !(name in loaded.exports.vars)) {
    failures.push(`${record.id} ${name}: not an exported variable`)
    continue
  }
  for (const extra of argSets) {
    const argTag = record.sweepArgs ? ` ${JSON.stringify(extra)}` : ''
    try {
      const { geometry, buildMs } = await buildPart(loaded, record, [name, ...extra])
      buildTimes.push(buildMs)
      if (isEmpty(geometry, loaded.ctx)) failures.push(`${record.id} ${name}${argTag}: empty geometry`)
    } catch (err) {
      failures.push(`${record.id} ${name}${argTag}: ${err.message}`)
    }
  }
}
```

In `packages/parts/docs/user-manual.md`, after the `insertArgs` bullet (`:67-70`), add:

```
- `sweepArgs`: extra trailing-argument lists the size sweep builds each size
  with, for catching bugs that only show at another setting (a second length,
  say). `nopscadlib/screw` sweeps its insert length 10 plus `sweepArgs`
  `[[25]]`. The parts browser still inserts `insertArgs`.
```

First adopter — read `packages/parts/catalog/nopscadlib/screw.json` first, then add `"sweepArgs": [[25]]` beside its `"insertArgs": [10]`.

- [ ] **Step 4: Run tests and re-check the adopter**

Run: `npx vitest run packages/parts/test/records.test.js packages/parts/test/check.test.js`
Expected: PASS including the 2 new tests.

Then: `node bin/check.js nopscadlib/screw` from `packages/parts` (expects PASS) and `node bin/check.js nopscadlib/screw --write` to refresh the screw entry's `buildMs` in `derived.json`. Confirm `git diff --stat` touches only the screw entry in `derived.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/parts/src/records.js packages/parts/bin/check.js packages/parts/test/records.test.js packages/parts/test/check.test.js packages/parts/catalog/nopscadlib/screw.json packages/parts/docs/user-manual.md packages/parts/derived.json
git commit -m "feat(parts): sweep a second axis via record-level sweepArgs"
```
