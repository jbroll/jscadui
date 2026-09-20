# Agent Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node eval harness in `packages/agent-loop/eval/` that scores the shipped `runTurn` + `SYSTEM_PROMPT` on three fluent modeling fixtures with real execution and a 24-point rubric.

**Architecture:** `backend.js` executes tool calls against real `@jbroll/jscad-fluent` geometry and `@jscadui/model-tools`; fixture files declare prompt plus checks; `grade.js` scores transcripts and geometry; `run-eval.js` wires the live provider and prints JSON plus a table. All unit tests run keyless; only the final live run spends API budget.

**Tech Stack:** Node 22, ES modules, vitest, `runTurn`/`TOOLS`/`SYSTEM_PROMPT`/`createProvider` from the agent-loop package, `@jbroll/jscad-fluent` (file: devDependency), `@jscadui/model-tools` (workspace devDependency).

**Spec:** `docs/superpowers/specs/2026-09-18-agent-eval-design.md`

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments: none unless they say why, one or two lines.
- The harness imports the shipped `runTurn`, `TOOLS`, `SYSTEM_PROMPT` directly — never copies.
- `eval/` stays out of the published package (`files` in `package.json` already excludes it).
- Never in CI or pre-commit hooks: only the live run spends API budget, and automation has no key.
- Checks assert on executed geometry and transcripts, never on prose.
- Geometry assertions use tolerances (faceted primitives differ from analytic volumes; e.g. a 20mm cube minus a 5r column measures ~6439, not 8000 − 24·25π ≈ 6115).
- Fixture models stay within plain `main()` plus fluent primitives, CJS `require` style per `llm.txt`.
- Branch: current working branch in `/home/john/src/jscadui`. Commit per task.

## Out of scope (tracked, not built here)

- Wiring the fluent bundle into the production worker so fluent-writing agents run in the app (spec prerequisite; separate slice).
- Browser/Playwright evals, record/replay cassettes, CI integration.

---

### Task 1: Real-execution tool backend

**Files:**
- Create: `packages/agent-loop/eval/backend.js`
- Create: `packages/agent-loop/eval/backend.test.js`
- Modify: `packages/agent-loop/package.json`
- Read for reference: `packages/agent-loop/src/tools.js:1-80` (tool names and schemas), `packages/model-tools/src/measure.js:115-125` (`measure(geometry, options)`), `packages/model-tools/src/check.js:107-112` (`check(geometry, options)`)

**Interfaces:**
- Consumes: `@jscadui/model-tools` (`measure`, `check`), `@jbroll/jscad-fluent` dist (CJS).
- Produces: `createEvalBackend() => { requestTool(name, input) => Promise<string>, reset() }`. `requestTool` answers every tool with a JSON string, never throws: `eval` runs CJS source through a require shim and returns `{ ok, params: [], entities }` or `{ ok: false, error }`; `measure`/`check` run model-tools on the last geometry (`{ ok:false }` JSON when none yet); `writeModel` stores `{ source, entry, message }` in a memory map; `params` returns `{ params: [] }`; `view`/`export` return `{ ok: false, error: { name: 'UnavailableError' } }`.

- [ ] **Step 1: Add dev dependencies**

In `packages/agent-loop/package.json` add:

```json
"devDependencies": {
  "@jbroll/jscad-fluent": "file:../../../jscad-fluent",
  "@jscadui/model-tools": "*",
  "vitest": "^4.0.18"
}
```

Run: `cd packages/agent-loop && npm install 2>&1 | tail -2`
Expected: install succeeds; `node -e "console.log(require('@jbroll/jscad-fluent').cube ? 'fluent-ok' : 'missing')"` prints `fluent-ok`.

- [ ] **Step 2: Write the failing backend test**

Create `packages/agent-loop/eval/backend.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

describe('eval backend', () => {
  it('evals fluent source and measures real volume', async () => {
    const backend = createEvalBackend()
    const evalRes = JSON.parse(await backend.requestTool('eval', { source: CUBE }))
    expect(evalRes.ok).toBe(true)
    expect(evalRes.entities).toBe(1)
    const measureRes = JSON.parse(await backend.requestTool('measure', {}))
    expect(measureRes.volume).toBeGreaterThan(7900)
    expect(measureRes.volume).toBeLessThan(8100)
  })

  it('answers measure with an error result when nothing was evaled', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('measure', {}))
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it('turns a throwing model into an error result, never a throw', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('eval', { source: 'throw new Error("boom")' }))
    expect(res.ok).toBe(false)
    expect(res.error.message).toBe('boom')
  })

  it('stubs view and export as unavailable without throwing', async () => {
    const backend = createEvalBackend()
    for (const name of ['view', 'export']) {
      const res = JSON.parse(await backend.requestTool(name, {}))
      expect(res.ok).toBe(false)
      expect(res.error.name).toBe('UnavailableError')
    }
  })

  it('writeModel persists to the memory project', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('writeModel', { source: CUBE, entry: 'main.js', message: 'first' }))
    expect(res.ok).toBe(true)
    expect(res.entry).toBe('main.js')
  })

  it('answers unknown tools with an error result', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('teleport', {}))
    expect(res.ok).toBe(false)
  })
})
```

Run: `cd packages/agent-loop && npx vitest run eval/backend.test.js`
Expected: FAIL with "Cannot find module './backend.js'".

- [ ] **Step 3: Implement the backend**

Create `packages/agent-loop/eval/backend.js`:

```js
import { createRequire } from 'node:module'
import { check } from '@jscadui/model-tools'
import { measure } from '@jscadui/model-tools'

const fluentRequire = createRequire('@jbroll/jscad-fluent/package.json')

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

const runSource = (source) => {
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-fluent') return fluentRequire('@jbroll/jscad-fluent')
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  const main = module.exports.main ?? module.exports
  if (typeof main !== 'function') throw new Error('model exports no main()')
  const out = main({})
  return Array.isArray(out) ? out : [out]
}

export function createEvalBackend() {
  let geometry = null
  const project = new Map()

  const requestTool = async (name, input) => {
    try {
      const args = input ?? {}
      if (name === 'eval') {
        geometry = runSource(args.source)
        return JSON.stringify({ ok: true, params: [], entities: geometry.length })
      }
      if (name === 'measure') {
        if (!geometry) return JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })
        return JSON.stringify({ ok: true, ...measure(geometry, args) })
      }
      if (name === 'check') {
        if (!geometry) return JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })
        return JSON.stringify({ ok: true, ...check(geometry, args) })
      }
      if (name === 'params') return JSON.stringify({ ok: true, params: [] })
      if (name === 'writeModel') {
        const entry = args.entry ?? 'main.js'
        project.set(entry, { source: args.source, message: args.message ?? '' })
        geometry = runSource(args.source)
        return JSON.stringify({ ok: true, entry })
      }
      if (name === 'view' || name === 'export') {
        return JSON.stringify({ ok: false, error: { name: 'UnavailableError', message: `${name} is unavailable in the eval harness` } })
      }
      return JSON.stringify(errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` }))
    } catch (error) {
      return JSON.stringify(errorResult(error))
    }
  }

  const reset = () => {
    geometry = null
    project.clear()
  }

  return { requestTool, reset, project }
}
```

`createRequire('@jbroll/jscad-fluent/package.json')` resolves from the installed package itself, so the shim works regardless of where the harness runs from. `writeModel` re-runs the source so later `measure` calls see persisted geometry.

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-loop && npx vitest run eval/backend.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/eval/backend.js packages/agent-loop/eval/backend.test.js packages/agent-loop/package.json packages/agent-loop/package-lock.json
git commit -m "feat(agent-loop): eval backend with real fluent execution"
```

Note: include `package-lock.json` only if the install creates one inside `packages/agent-loop`; omit it from the add command when absent.

---

### Task 2: Fixtures

**Files:**
- Create: `packages/agent-loop/eval/fixtures/cube-hole.js`
- Create: `packages/agent-loop/eval/fixtures/gear.js`
- Create: `packages/agent-loop/eval/fixtures/bracket.js`
- Create: `packages/agent-loop/eval/fixtures.test.js`
- Read for reference: `packages/agent-loop/src/tools.js` (tool names for `requires`)

**Interfaces:**
- Consumes: nothing (fixture files are data).
- Produces: each fixture exports `{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks }` where `checks(measureResult) => [{ name, pass }]` runs against the backend's final `measure({})` output. `requires` is a subset of `TOOLS` names; `verifyBeforeWrite` marks fixtures where `writeModel` must follow a `measure`/`check`.

- [ ] **Step 1: Write the failing shape test**

Create `packages/agent-loop/eval/fixtures.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/tools.js'
import { fixture as bracket } from './fixtures/bracket.js'
import { fixture as cubeHole } from './fixtures/cube-hole.js'
import { fixture as gear } from './fixtures/gear.js'

const names = new Set(TOOLS.map((t) => t.name))

describe('eval fixtures', () => {
  for (const fixture of [cubeHole, gear, bracket]) {
    it(`${fixture.name}: declares known tools, a prompt, and function checks`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(20)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      expect(typeof fixture.checks).toBe('function')
      expect(typeof fixture.maxTurns).toBe('number')
    })
  }
})
```

Run: `cd packages/agent-loop && npx vitest run eval/fixtures.test.js`
Expected: FAIL with "Cannot find module './fixtures/cube-hole.js'".

- [ ] **Step 2: Write the three fixtures**

Create `packages/agent-loop/eval/fixtures/cube-hole.js`:

```js
// 20mm cube with a centered through-hole: boolean correctness plus net volume.
export const fixture = {
  name: 'cube-hole',
  prompt: 'Model a 20mm cube centered on the origin with a 5mm-radius through-hole along Z, in jscad-fluent. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: (m) => [
    { name: 'volume near 6115', pass: m.volume > 5800 && m.volume < 6500 },
    { name: '20mm extents', pass: JSON.stringify(m.boundingBox) === JSON.stringify([[-10, -10, -10], [10, 10, 10]]) },
  ],
}
```

Create `packages/agent-loop/eval/fixtures/gear.js`:

```js
// 12-tooth gear, 40mm outer diameter, 5mm thick.
export const fixture = {
  name: 'gear',
  prompt: 'Model a 12-tooth spur gear, 40mm outer diameter and 5mm thick centered on the origin, in jscad-fluent. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m) => [
    { name: '40mm outer diameter', pass: m.boundingBox[1][0] - m.boundingBox[0][0] > 38 && m.boundingBox[1][0] - m.boundingBox[0][0] < 42 },
    { name: '5mm thick', pass: m.boundingBox[1][2] - m.boundingBox[0][2] > 4.5 && m.boundingBox[1][2] - m.boundingBox[0][2] < 5.5 },
    { name: 'positive volume', pass: m.volume > 1000 },
  ],
}
```

Create `packages/agent-loop/eval/fixtures/bracket.js`:

```js
// L-bracket fitting a 200x200 bed: constraint satisfaction, not just shape.
export const fixture = {
  name: 'bracket',
  prompt: 'Model an L-bracket, 60mm wide with 40mm tall arms 8mm thick, in jscad-fluent. Check it against the mk3 bed, then persist with writeModel.',
  requires: ['eval', 'check', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m) => [
    { name: 'fits mk3 bed', pass: m.fits === true },
  ],
}
```

The bracket check calls `check(geometry, { bed: 'mk3' })` semantics: the grader (Task 3) runs `measure({})` for geometry checks and reads the transcript's last `check` result for bed assertions. `m.fits` is whatever `check` returns for a fitting model — verify the field name against `packages/model-tools/src/check.js` output while writing this file; if the field differs, use the real one. Bounding-box numbers assume the model is centered on the origin; prompts say so explicitly.

- [ ] **Step 3: Run the tests**

Run: `cd packages/agent-loop && npx vitest run eval/fixtures.test.js`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/agent-loop/eval/fixtures packages/agent-loop/eval/fixtures.test.js
git commit -m "feat(agent-loop): three eval fixtures with geometry checks"
```

---

### Task 3: Grader

**Files:**
- Create: `packages/agent-loop/eval/grade.js`
- Create: `packages/agent-loop/eval/grade.test.js`
- Read for reference: `packages/agent-loop/test/loop.test.js:60-70` (transcript message shapes: `{ role: 'assistant', content, toolCalls }`, `{ role: 'tool', toolCallId, content }`)

**Interfaces:**
- Consumes: Task 2's fixture shape (`requires`, `verifyBeforeWrite`, `checks`).
- Produces: `gradeFixture(fixture, transcript, finalMeasure) => { dimensions: { discipline, recovery, geometry, conservation }, total }`, each dimension 0–2, total out of 8 per fixture (24 across the suite):
  - discipline (2): `eval` called at least once; when `verifyBeforeWrite`, a `measure`/`check` call precedes the first `writeModel`. 1 when eval ran but verification skipped; 0 when no `eval` at all.
  - recovery (2): a failed tool result followed later by a succeeding call; 1 when no tool failed (nothing to recover); 0 when a failure went unretried.
  - geometry (2): all `checks` pass; 1 when at least half pass; 0 otherwise (0 checks is 0).
  - conservation (2): `writeModel` called at most twice and total tool calls fit the transcript; 1 when within double the fixture's typical budget; 0 on runaway loops. Concretely: toolCalls.length <= 12 → 2; <= 24 → 1; else 0.

- [ ] **Step 1: Write the failing grader test**

Create `packages/agent-loop/eval/grade.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { gradeFixture } from './grade.js'

const fixture = {
  name: 'cube-hole',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: [
    (m) => ({ name: 'volume', pass: m.volume > 5800 }),
    (m) => ({ name: 'extents', pass: true }),
  ],
}

const toolMsg = (id, name, input = {}) => ({ role: 'assistant', content: null, toolCalls: [{ id, name, input }] })
const resultMsg = (id, content) => ({ role: 'tool', toolCallId: id, content })

describe('grader', () => {
  it('scores a clean verified run at full marks', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entities: 1 })),
      toolMsg('t2', 'measure', {}),
      resultMsg('t2', JSON.stringify({ ok: true, volume: 6400 })),
      toolMsg('t3', 'writeModel', { source: 'x' }),
      resultMsg('t3', JSON.stringify({ ok: true, entry: 'main.js' })),
    ]
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.dimensions).toEqual({ discipline: 2, recovery: 1, geometry: 2, conservation: 2 })
    expect(report.total).toBe(7)
  })

  it('penalizes writeModel before any verification', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entities: 1 })),
      toolMsg('t2', 'writeModel', { source: 'x' }),
      resultMsg('t2', JSON.stringify({ ok: true, entry: 'main.js' })),
    ]
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.dimensions.discipline).toBe(1)
  })

  it('rewards recovery and punishes abandonment', () => {
    const recovered = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: false, error: { message: 'boom' } })),
      toolMsg('t2', 'eval', { source: 'y' }),
      resultMsg('t2', JSON.stringify({ ok: true, entities: 1 })),
    ]
    expect(gradeFixture(fixture, recovered, { volume: 6400 }).dimensions.recovery).toBe(2)
    const abandoned = recovered.slice(0, 3)
    expect(gradeFixture(fixture, abandoned, null).dimensions.recovery).toBe(0)
  })

  it('scores geometry on check pass rate', () => {
    const transcript = [{ role: 'user', content: 'make it' }]
    expect(gradeFixture(fixture, transcript, { volume: 100 }).dimensions.geometry).toBe(0)
    expect(gradeFixture(fixture, transcript, null).dimensions.geometry).toBe(0)
  })
})
```

Note the fixture `checks` here are functions taking the measure result (the real fixtures use the same shape: `checks(m) => [{ name, pass }]`). The grader calls each with `finalMeasure` (null-safe: null measure fails every check).

Run: `cd packages/agent-loop && npx vitest run eval/grade.test.js`
Expected: FAIL with "Cannot find module './grade.js'".

- [ ] **Step 2: Implement the grader**

Create `packages/agent-loop/eval/grade.js`:

```js
const toolCallsOf = (transcript) =>
  transcript.filter((m) => m.role === 'assistant').flatMap((m) => m.toolCalls ?? [])

const resultsOf = (transcript) => transcript.filter((m) => m.role === 'tool')

const failed = (content) => {
  try {
    return JSON.parse(content)?.ok === false
  } catch {
    return false
  }
}

export function gradeFixture(fixture, transcript, finalMeasure) {
  const calls = toolCallsOf(transcript)
  const results = resultsOf(transcript)
  const names = calls.map((c) => c.name)

  let discipline = 0
  if (names.includes('eval')) {
    discipline = 1
    if (!fixture.verifyBeforeWrite) {
      discipline = 2
    } else {
      const firstWrite = names.indexOf('writeModel')
      const verified = names.slice(0, firstWrite).some((n) => n === 'measure' || n === 'check')
      if (firstWrite === -1 || verified) discipline = 2
    }
  }

  let recovery = 1
  const failures = results.filter((r) => failed(r.content))
  if (failures.length > 0) {
    const lastFailureAt = transcript.lastIndexOf(failures[failures.length - 1])
    const laterSuccess = results
      .filter((r) => transcript.indexOf(r) > lastFailureAt)
      .some((r) => !failed(r.content))
    recovery = laterSuccess ? 2 : 0
  }

  const outcomes = fixture.checks(finalMeasure).map((c) => (c.pass ? 1 : 0))
  const rate = outcomes.length === 0 ? 0 : outcomes.reduce((a, b) => a + b, 0) / outcomes.length
  const geometry = rate === 1 ? 2 : rate >= 0.5 ? 1 : 0

  const writes = names.filter((n) => n === 'writeModel').length
  const conservation = calls.length <= 12 && writes <= 2 ? 2 : calls.length <= 24 ? 1 : 0

  return { dimensions: { discipline, recovery, geometry, conservation }, total: discipline + recovery + geometry + conservation }
}
```

Wait: the test fixture `checks` is an ARRAY of functions, but Task 2 fixtures define `checks: (m) => [...]` (a function). Inconsistent. Align on the Task 2 shape: `checks(measureResult) => [{ name, pass }]`. The test above passes an array — fix the test to use the function shape:

```js
const fixture = {
  ...
  checks: (m) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 5800 },
    { name: 'extents', pass: true },
  ],
}
```

And the grader calls `fixture.checks(finalMeasure)` with null-safety inside each check (the `(m?.volume ?? 0)` pattern). Use that corrected fixture in Step 1 (replace the `checks: [...]` array with the function form).

- [ ] **Step 3: Run the tests**

Run: `cd packages/agent-loop && npx vitest run eval/grade.test.js`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/agent-loop/eval/grade.js packages/agent-loop/eval/grade.test.js
git commit -m "feat(agent-loop): rubric grader for eval transcripts"
```

---

### Task 4: Runner, report, and baseline

**Files:**
- Create: `packages/agent-loop/eval/run-eval.js`
- Create: `packages/agent-loop/eval/report.js`
- Create: `packages/agent-loop/eval/runner.test.js`
- Read for reference: `packages/agent-loop/src/loop.js:96-100` (`runTurn` options), `packages/agent-loop/src/providers.js:199-208` (`createProvider` config)

**Interfaces:**
- Consumes: Tasks 1–3 (`createEvalBackend`, fixtures, `gradeFixture`), shipped `runTurn`/`SYSTEM_PROMPT`/`createProvider`.
- Produces: `node eval/run-eval.js` (from `packages/agent-loop`) running the suite live and writing `eval/results/<date>-<model>.json` plus a console table; exported `runSuite(fixtures, { provider, maxTurnsDefault })` for keyless tests with scripted providers.

- [ ] **Step 1: Write the failing runner test (scripted provider, no key)**

Create `packages/agent-loop/eval/runner.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { runSuite } from './run-eval.js'

const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

describe('runSuite', () => {
  it('runs a fixture against a scripted provider and grades it', async () => {
    const backend = createEvalBackend()
    const provider = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.cube({ size: 20 })] }\nmodule.exports = { main }' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'tool_use', id: 't2', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'a 20mm cube' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const fixture = {
      name: 'smoke',
      prompt: 'make a cube',
      requires: ['eval', 'measure'],
      verifyBeforeWrite: false,
      maxTurns: 8,
      checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
    }
    const results = await runSuite([fixture], { provider, backend })
    expect(results).toHaveLength(1)
    expect(results[0].report.dimensions.discipline).toBe(2)
    expect(results[0].report.total).toBeGreaterThanOrEqual(6)
  })

  it('refuses without a provider', async () => {
    await expect(runSuite([], { provider: null, backend: createEvalBackend() })).rejects.toThrow(/provider/)
  })
})
```

Run: `cd packages/agent-loop && npx vitest run eval/runner.test.js`
Expected: FAIL with "Cannot find module './run-eval.js'".

- [ ] **Step 2: Implement runner and report**

Create `packages/agent-loop/eval/report.js`:

```js
export function formatTable(results) {
  const lines = ['fixture  total  disc  rec  geom  cons']
  for (const { fixture, report } of results) {
    const d = report.dimensions
    lines.push(`${fixture}  ${report.total}  ${d.discipline}  ${d.recovery}  ${d.geometry}  ${d.conservation}`)
  }
  const total = results.reduce((a, r) => a + r.report.total, 0)
  lines.push(`suite  ${total} / ${results.length * 8}`)
  return lines.join('\n')
}
```

Create `packages/agent-loop/eval/run-eval.js`:

```js
// Usage: EVAL_PROVIDER=openai EVAL_MODEL=gpt-4o EVAL_API_KEY=sk-... node eval/run-eval.js
// Runs the suite live. Never in CI: every run spends real API budget.
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYSTEM_PROMPT, createProvider, runTurn } from '../index.js'
import { createEvalBackend } from './backend.js'
import { fixture as bracket } from './fixtures/bracket.js'
import { fixture as cubeHole } from './fixtures/cube-hole.js'
import { fixture as gear } from './fixtures/gear.js'
import { gradeFixture } from './grade.js'
import { formatTable } from './report.js'

const withTurnCap = (provider, maxTurns) => {
  let rounds = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      if (rounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield* provider.send(messages, tools)
    },
  }
}

export async function runSuite(fixtures, { provider, backend }) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    backend.reset()
    const conversation = { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: fixture.prompt }] }
    const turn = await runTurn({
      conversation,
      provider: withTurnCap(provider, fixture.maxTurns),
      requestTool: (name, input) => backend.requestTool(name, input),
      onText: () => {},
    })
    const finalMeasure = JSON.parse(await backend.requestTool('measure', {}))
    const geometry = finalMeasure.ok ? finalMeasure : null
    const report = gradeFixture(fixture, turn.messages, geometry)
    results.push({ fixture: fixture.name, report, turns: turn.messages.length })
  }
  return results
}

const main = async () => {
  const { EVAL_PROVIDER, EVAL_MODEL, EVAL_API_KEY, EVAL_BASE_URL } = process.env
  if (!EVAL_PROVIDER || !EVAL_MODEL || !EVAL_API_KEY) {
    console.error('run-eval: set EVAL_PROVIDER, EVAL_MODEL, and EVAL_API_KEY')
    process.exit(1)
  }
  const provider = createProvider({ kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey: EVAL_API_KEY, baseUrl: EVAL_BASE_URL })
  const backend = createEvalBackend()
  const results = await runSuite([cubeHole, gear, bracket], { provider, backend })
  console.log(formatTable(results))
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(new URL(`./results/${stamp}-${EVAL_MODEL}.json`, import.meta.url), JSON.stringify({ model: EVAL_MODEL, results }, null, 2))
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
```

Check `packages/agent-loop/index.js` exports `createProvider` and `runTurn` — the plan assumes it (test/loop.test.js imports from `../src/loop.js`; aiChat imports `createProvider, runTurn` from `@jscadui/agent-loop`, so index.js re-exports both — verified by existing usage).

`finalMeasure` re-runs `measure({})` after the turn: if the turn never evaled, `{ ok: false }` → geometry null → checks fail honestly. If the turn ended mid-geometry, this measures the latest persisted state — the fair grounding for geometry checks.

- [ ] **Step 3: Run the keyless tests**

Run: `cd packages/agent-loop && npx vitest run eval/`
Expected: PASS (backend 6 + fixtures 3 + grade 4 + runner 2 = 15 tests). The live run is manual (needs a key) and is not part of this step.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-loop/eval/run-eval.js packages/agent-loop/eval/report.js packages/agent-loop/eval/runner.test.js
git commit -m "feat(agent-loop): eval runner with live provider and reports"
```

---

## Order and checkpoints

Tasks 1–3 are sequential only through shared shapes (backend API, fixture shape); Task 4 needs all of them.

- After Task 1, fluent source executes really in Node and every tool answers JSON. That is the moment to sanity-check a fluent model beyond the cube (gear-like subtraction) before fixtures lock tolerances in.
- After Task 4, `EVAL_PROVIDER=openai EVAL_MODEL=... EVAL_API_KEY=... node eval/run-eval.js` from `packages/agent-loop` produces the first scored baseline. That run is manual (key required) and its report is the reference every prompt edit diffs against.
