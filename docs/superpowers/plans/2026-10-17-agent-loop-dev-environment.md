# Agent-loop dev environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the browser agent loop into an iterative dev environment where every code write runs the full test suite in a separate worker and returns build plus asserts-per-part coverage.

**Architecture:** Pure functions in `packages/agent-loop/src` for skill/note/test logic shared by app and eval; thin wiring in `apps/jscad-web/src/aiDeps.js` plus a new test worker beside the geometry frame worker; prompt assembled from `?raw` skill/note indexes under existing context budgets.

**Tech Stack:** ESM JS, no semicolons, existing `require` loader + `fileMap.js`, frame workers + `workerSlot.js` kill timers, vitest for repo tests.

**Spec:** `docs/superpowers/specs/2026-10-17-agent-loop-dev-environment-design.md`

## Global Constraints

- Everything runs in the browser. No Node child processes, no shell, no npm install, no filesystem outside project storage.
- Test code and test runner execute in a separate browser test worker, never the geometry worker; hangs return tool-error JSON, never freeze viewer.
- Full `test/` suite runs on every code write with no batching in v1; docs/notes writes skip tests.
- Coverage is passing asserts per geometry part with floor of one passing test per part; no judgement beyond that.
- Red past round cap errors with attempts attached; cap tunable via `DEFAULT_MAX_ROUNDS` / per-model `maxTurns`.
- `test/`, `notes/`, skill sources excluded from geometry build/transpiler input and viewer.
- Context budgets: `CONTEXT_BUDGET=24000`, `PROJECT_BUDGET=24000`, `TOTAL_BUDGET=55000`, `BUILD_BUDGET=4000`; skill/note indexes stay small, bodies load on demand.
- Style: ESM, no semicolons, single quotes, 2-space, JSDoc on exports.
- Eval baselines must not regress: `--regrade` moves no other fixture total.

## Review Focus

- Hanging test file does not freeze viewer and returns TimeoutError JSON within budget.
- Test file requiring model entry gets file/line/col failure, not generic crash.
- `notes/` with 50 files does not blow `TOTAL_BUDGET`; index truncates with names-only listing.
- Empty/missing `test/` skips gracefully with no-tests note, not failure.
- Skill ID collision resolves with later source winning and exact case-sensitive match.

---

### Task 1: Skill tool loader

**Files:**
- Create: `packages/agent-loop/src/skills.js`
- Modify: `packages/agent-loop/src/tools.js`
- Modify: `packages/agent-loop/src/dispatchTool.js`
- Test: `packages/agent-loop/test/skills.test.js`

**Model:** `sonnet` — multi-file coordination with exact schema and routing.

**Interfaces:**
- Consumes: `prompt/skills/*.md` via `?raw` from `prompt/index.js`
- Produces: `lookupSkill(index: Record<string,string>, name: string) -> string`, `skillTool(index, name) -> string`, `SKILL_BUDGET=2000`, `ROUTES.skill = (deps, args) => deps.skill(args)`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { lookupSkill } from '../src/skills.js'
describe('lookupSkill', () => {
  it('returns procedure text for known id and lists ids', () => {
    expect(lookupSkill({ 'plan-then-build': 'one file per part' }, 'plan-then-build')).toBe('one file per part')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/skills.test.js`
Expected: FAIL with lookupSkill not defined

- [ ] **Step 3: Implement `lookupSkill(index, name) -> string` and `skillTool` in `packages/agent-loop/src/skills.js`, add `skill` entry to `buildTools` in `src/tools.js`, add `skill: (deps, args) => deps.skill(args)` to `ROUTES` in `src/dispatchTool.js`**

Index maps kebab-case ID to raw markdown body; missing ID returns `toolError` JSON shape; description list helper `skillIndex(index) -> [{id, description}]` parses frontmatter `description:` first line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/skills.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/skills.js packages/agent-loop/src/tools.js packages/agent-loop/src/dispatchTool.js packages/agent-loop/test/skills.test.js
git commit -m "feat: add skill tool loader"
```

### Task 2: Starter skills content

**Files:**
- Create: `packages/agent-loop/prompt/skills/brainstorming.md`
- Create: `packages/agent-loop/prompt/skills/writing-plans.md`
- Create: `packages/agent-loop/prompt/skills/executing-plans.md`
- Create: `packages/agent-loop/prompt/skills/systematic-debugging.md`
- Modify: `packages/agent-loop/prompt/index.js`
- Test: `packages/agent-loop/test/skills-content.test.js`

**Model:** `haiku` — transcription of short procedures with exact paths.

**Interfaces:**
- Consumes: Task 1 `lookupSkill` index
- Produces: `SKILLS: Record<id, body>` exported from `prompt/index.js`, each under 250 words

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { SKILLS } from '../prompt/index.js'
describe('starter skills', () => {
  it('exposes four skills under 250 words each', () => {
    for (const id of ['brainstorming', 'writing-plans', 'executing-plans', 'systematic-debugging']) {
      expect(SKILLS[id].split(/\s+/).length).toBeLessThan(250)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/skills-content.test.js`
Expected: FAIL with SKILLS undefined

- [ ] **Step 3: Create four markdown files adapted to browser tools (`read/glob/grep/write/edit/delete/execute/measure/check/docs/question`), wire `?raw` imports in `prompt/index.js`**

Keep OpenCode frontmatter `description:` for discovery; body is procedure only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/skills-content.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/prompt/skills packages/agent-loop/prompt/index.js packages/agent-loop/test/skills-content.test.js
git commit -m "feat: add starter skills content"
```

### Task 3: Notes memory index

**Files:**
- Create: `packages/agent-loop/src/notes.js`
- Modify: `packages/agent-loop/src/context.js`
- Test: `packages/agent-loop/test/notes.test.js`

**Model:** `sonnet` — context budget interaction needs judgment.

**Interfaces:**
- Consumes: project `files: Record<string,string>`
- Produces: `notesIndex(files: Record<string,string>) -> string`, `NOTES_BUDGET=2000`, `parseNoteDescription(content: string) -> string`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { notesIndex } from '../src/notes.js'
describe('notesIndex', () => {
  it('lists notes/ headers and skips non-notes', () => {
    const out = notesIndex({ 'notes/plan.md': '---\ndescription: Lid plan\n---\nbody', 'main.js': 'x' })
    expect(out).toContain('plan.md')
    expect(out).toContain('Lid plan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/notes.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `parseNoteDescription` (frontmatter `description:` else first `#` line else first non-empty line, capped 120 chars) and `notesIndex` (only `notes/**/*.md`, sorted, capped to `NOTES_BUDGET` with names-only overflow like `filesSection`) in `src/notes.js`; append index to `projectMessage` output in `src/context.js`**

Create-on-demand stays via existing `write`; no new tool.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/notes.test.js`
Expected: PASS plus `npx vitest run --root packages/agent-loop test/context.test.js` still PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/notes.js packages/agent-loop/src/context.js packages/agent-loop/test/notes.test.js
git commit -m "feat: add notes memory index"
```

### Task 4: Browser test package

**Files:**
- Create: `packages/agent-loop/src/testPackage.js`
- Test: `packages/agent-loop/test/test-package.test.js`

**Model:** `sonnet` — API design for `require('test')` surface.

**Interfaces:**
- Consumes: none
- Produces: `TEST_API = { test(name:string, fn:Function): void, assert(cond:boolean, msg?:string): void, assertPart(index:number, checks:object): void }`, `runTestFile(source:string, api:object) -> {passed, failed, assertsByPart: Record<number,number>}`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { runTestFile } from '../src/testPackage.js'
describe('runTestFile', () => {
  it('counts asserts per part', async () => {
    const r = await runTestFile(`const {test, assertPart} = require('test'); test('a', () => assertPart(0, {volume: 1}))`, {})
    expect(r.assertsByPart['0']).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/test-package.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `runTestFile` in `src/testPackage.js` (CommonJS `require('test')` injection, sync assert collection, per-part attribution only on passing assert, file/line/col on throw via `reportError` shape)**

No line coverage here; geometry asserts only per spec floor.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/test-package.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/testPackage.js packages/agent-loop/test/test-package.test.js
git commit -m "feat: add browser test package"
```

### Task 5: Separate test worker runner

**Files:**
- Create: `apps/jscad-web/src/testWorker.js`
- Create: `apps/jscad-web/src_frame/testRun.js`
- Test: `apps/jscad-web/test/test-worker.test.js`

**Model:** `sonnet` — worker lifecycle plus timeout handling.

**Interfaces:**
- Consumes: Task 4 `runTestFile`, `createReadFile` from `src_frame/fileMap.js`, `createSlots` from `src_frame/workerSlot.js`
- Produces: `runProjectTests(files: Record<string,string|ArrayBuffer>, api: string) -> Promise<{ok, passed, failed, failures: [{file, error}], assertsByPart}>`, `TEST_WORKER_TIMEOUT_MS=15000`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { runProjectTests } from '../src/testWorker.js'
describe('runProjectTests', () => {
  it('runs test/ only and times out hangs', async () => {
    const r = await runProjectTests({ 'test/a.js': `test('x',()=>{})`, 'notes/n.md': 'hi' }, 'fluent')
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root apps/jscad-web test/test-worker.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `src_frame/testRun.js` (loads `test/**/*.js` via `createReadFile`, injects `test` package, captures console via `consoleCapture`, never loads `notes/` or skills into geometry; maps thrown errors to `{file, line, column}` via `reportError` shape) and `src/testWorker.js` (own Worker entry, `createSlots` kill timer `TEST_WORKER_TIMEOUT_MS=15000`, returns `{ok:false, error:{name:'TimeoutError'}}` JSON on hang; pins Review Focus: hang returns within budget, failure carries file/line)**

Reuse `sendScript`-style protocol; geometry worker untouched. Verify `build()` input excludes `test/**` and `notes/**` (entry closure only) or filter files before build.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root apps/jscad-web test/test-worker.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/testWorker.js apps/jscad-web/src_frame/testRun.js apps/jscad-web/test/test-worker.test.js
git commit -m "feat: add separate test worker"
```

### Task 6: Write integration with build plus test

**Files:**
- Modify: `apps/jscad-web/src/aiDeps.js`
- Modify: `packages/agent-loop/eval/backend.js`
- Test: `packages/agent-loop/test/write-with-tests.test.js`

**Model:** `sonnet` — app plus eval parity.

**Interfaces:**
- Consumes: Task 5 `runProjectTests`, existing `writeReport`/`build`
- Produces: `write`/`edit` result `{saved, ok, build, tests: {ok, passed, failed, assertsByPart, uncovered: number[]}, coverageNote}`; `isCodePath(path: string) -> boolean`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { isCodePath } from '../src/project.js'
describe('isCodePath', () => {
  it('skips notes and includes js', () => {
    expect(isCodePath('notes/a.md')).toBe(false)
    expect(isCodePath('main.js')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/write-with-tests.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `isCodePath` (`.js` outside `test/`/`notes/` plus entry; docs/notes skip tests) in `src/project.js`; wire `save()` in `aiDeps.js` to run `build()` then `runProjectTests()` for code paths and merge `{build, tests}` truncated to budget; mirror in `eval/backend.js` with same shape; red stays saved**

Full suite every code write, no batch flag in v1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/write-with-tests.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiDeps.js packages/agent-loop/eval/backend.js packages/agent-loop/src/project.js packages/agent-loop/test/write-with-tests.test.js
git commit -m "feat: run full tests on every code write"
```

### Task 7: System prompt iterative style plus indexes

**Files:**
- Modify: `packages/agent-loop/prompt.md`
- Modify: `packages/agent-loop/src/prompt.js`
- Test: `packages/agent-loop/test/prompt.test.js`

**Model:** `haiku` — prompt wording plus index wiring.

**Interfaces:**
- Consumes: Tasks 1-3 indexes
- Produces: updated Tool policy section with iterate-until-green, verify-before-reply, error-past-cap

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../src/prompt.js'
describe('system prompt', () => {
  it('requires tests green before reply', () => {
    expect(buildSystemPrompt('fluent')).toMatch(/tests.*green|iterate/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/prompt.test.js -t "tests green"`
Expected: FAIL

- [ ] **Step 3: Replace stop-early lines 86-87 in `prompt.md` with iterate loop (write small, read test output, fix, repeat; verify build plus tests before reply; past cap errors with attempts); inject skill-ID list and notes header index via `assemblePrompt` without exceeding budgets**

Keep under context caps; skills stay index-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/prompt.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/prompt.md packages/agent-loop/src/prompt.js packages/agent-loop/test/prompt.test.js
git commit -m "feat: iterative system prompt with skill and notes index"
```
