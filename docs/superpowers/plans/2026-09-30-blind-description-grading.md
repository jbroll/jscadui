# Blind-Description Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade a new `complex` eval fixture group by deterministic gates plus one overall verdict: renders of the result are described by Moondream 3.1 without seeing the request, and DeepSeek v4.1 flash judges that description against the user's messages.

**Architecture:** Stage A runs in each `run-eval` lane: the conversation (with follow-ups), the grade in a fresh executor, a new `mesh` request answered by that same executor, the gates, and three renders drawn in the parent's Playwright chromium. Stage B (`npm run describe`) runs one Python process (`eval/describer/describe.py`, kestrel 0.9.1 with runtime patches, outside connections refused) over every rendered run. Stage C (`npm run judge`) makes three DeepSeek calls per described run through `src/providers.js`, takes the majority, and settles geometry. Model code still runs only in crt executors; rendering, describing and judging never do.

**Tech Stack:** Node 22+ ES modules, vitest 4, `@playwright/test` 1.58 bundled chromium, three.js r147, Python venv with `moondream==2.6.1` and `kestrel==0.9.1`, opencode-go chat completions, bash CI scripts for simple-ci.

**Spec:** `docs/superpowers/specs/2026-09-30-blind-description-grading-design.md` (replaces Part 4 of `docs/superpowers/specs/2026-09-29-conversational-eval-and-skills-design.md`). Read both the spec and this plan before starting a task.

## Global Constraints

- Modern JS only: ES2022+, ES modules, no compat shims or polyfills (root `CLAUDE.md`).
- Comments: default to none; one or two lines, only the non-obvious why. No history narration.
- Docs: plain words, no filler, no marketing. Docs change in the same commit as the code they describe.
- Test-first: write the failing test, watch it fail, then implement. Unit tests need no GPU, network, provider key or crt; a test that needs chromium or python3 skips when it is missing (`describe.skipIf`, the pattern `eval/sandbox-crt.test.js` uses for crt).
- Commit after each task. The pre-commit hook runs the openscad build, ESLint on staged JS (`--max-warnings=0`), `npm run typecheck` and the unit tests; let it run (up to 10 minutes). Never `--no-verify`.
- Commit messages end with these two lines:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv`
- Never print, log or write an API key; never read `~/.config/jscad-chat/keys.json` contents in a shell.
- Shell: no `sleep`, no `while`/`until` poll loops, no `watch`, no `tail -f`. One purpose per Bash command; no `&&` chains of unrelated steps. Run commands from the repo root.
- Model code runs only in crt executors (`eval/sandbox.js`). Renders run in the `run-eval` parent's chromium; the describer runs in its own Python process; the judge runs in the Node process. None of them ever runs in an executor, and the executor never gets a key.
- Never open a pull request, never create or push to a fork, never read or touch GitHub issues.
- Pinned values from the spec, verbatim:
  - mesh: colours `[r, g, b]` in 0 to 1 or null; base64 Float32 positions; each reply under the 1 MB cap; up to 24 MB in all (about 700,000 triangles).
  - views: 768 x 768 PNG, orthographic, a 3% margin on each side (the trial renderer's half-extent x 1.06); `iso-front` (1, -1, 0.7), `iso-back` (-1, 1, 0.7), `side` (0, -1, 0.05), all +Z up; background `#ececec`; unset colour `#b0b0b0`; edges at 35% opacity where faces meet at more than 30°.
  - `connected`: bounding boxes grown by 0.5 mm on every side; passes with at most `pieces` groups.
  - describer: `moondream/moondream3.1-9B-A2B`, `moondream==2.6.1`, `kestrel==0.9.1`, `DESCRIBER_HOME` default `/data/moondream3` (`venv/`, `hf/`), tokenizer `moondream/starmie-v1`; runtime `decode_path="native"`, `kv_cache_pages=4096`, `max_batch_size=1`, prefix cache off; reasoning off, temperature 0, at most 300 output tokens; needs 11,800 MiB free.
  - judge: `opencode-go` / `deepseek-v4.1-flash`, `reasoning_effort: "none"`, `temperature: 0`, at most 150 output tokens, three calls, reason trimmed to 200 characters, up to two retries of a reply with neither word.
  - result files: `<time>-<model>-<api>-complex-<sha8>.json`, `suite: 'complex'`, renders in `<file stem>.renders/<fixture>-<run>/`.

## Spec rulings

Where the spec left a choice open, this plan decides as follows. Implementers follow these; the final report lists them.

1. The description line prefix `{view name}` is the view's label (`front three-quarter view`), as in the trial whose judge results the spec reports.
2. The mesh sends one entry per item `main()` returned (the part that carries a colour); the `N parts` in the describer prompt is the `bodies` probe count, as the spec says.
3. `maxTurns` caps each user message's turn, not the whole conversation, and grading reads it the same way: `hitCap` and `endedWithoutReply` count the assistant messages after the last user message. A follow-up is sent after any turn that ended without an error; an error (provider, empty reply, run time limit, sandbox) ends the conversation. Before each follow-up the backend is reset to the project as it stands and built, as the app's frame holds it.
4. A run with `verdictPending`, `renderError` or `graderError` stays out of the `total` and `checkPassRate` means (its `firstAttemptFailures` still counts). `verdictRate` is over runs that have a verdict.
5. The Regrading section's "rendering again happens with `--redescribe`" is `npm run describe -- --rerender`: `--regrade` marks a run whose mesh changed `renderStale`, and `--rerender` renders it again before describing.
6. Complex fixtures run only when named (`EVAL_FIXTURES=complex` or a fixture name); `EVAL_FIXTURES=all` leaves them out, and a selection mixing complex and other fixtures exits with an error.
7. When `blockedConnections` is not 0, or the describer died so the count is unknown, the descriptions are kept, the stage exits 2, and `ci/eval-complex` stops before the judge. The same exit 2 covers the GPU check stopping it and a describer that does not start.
8. A run with any failed view gets `describeError` and no description; the judge skips it and a later `npm run describe` retries it. Failed views alone make the stage exit 1, and the judge still runs on the other runs.
9. A vote is the first uppercase `SUCCESS` or `FAILURE` in the reply (the trial's replies were always uppercase). A provider error counts as an unanswered attempt and is retried like a reply with neither word.
10. Each complex run stores `userMessages` (the prompt and each follow-up) at stage A, so stages B and C and the validation file need no fixture lookup.
11. Validation cases live in `eval/grader-validation/cases.js` as source strings (the trial sources as files would fail ESLint on unused variables); `no-roof` and `exploded` are derived from the caboose by exact-text patches, checked by a test against the trial's sizes and part counts. Output goes to `GRADER_VALIDATION_DIR`, default `~/.local/state/jscad-chat/grader-validation/`.
12. `fetch-ci-results.js` copies a complex file's renders (checked against each view's `sha256`) and removes older `*.renders` directories from the results dir, so the user's next evals-repo commit drops them.
13. "At most 150 output tokens" becomes `max_tokens: 150` through new `temperature` and `maxTokens` fields on the openai provider config, sent only when set, so no tested model's request changes.
14. `ci/eval-complex` reuses `ci/eval` through a new `EVAL_CONF` variable, runs the describer and judge even when one lane failed, skips the judge only when the describe stage exits 2, and exits non-zero when any stage failed.
15. The spec's `docs/install.md` does not exist; the describer's host setup goes in `ci/README.md`.
16. The older spec `2026-09-29-conversational-eval-and-skills-design.md` still covers unimplemented Parts 1-3 and 5, so the last task does not delete it; it replaces Part 4's existing superseded note with one that points at the permanent docs. The last task deletes the new spec and this plan.

A pre-flight review (`.superpowers/sdd/2026-09-30-blind-description-grading/preflight.md`, rulings P1-P16 in its `progress.md`) amended this plan before any task ran:

- P1 (Task 1): mesh pages pack consecutive parts and split a part across pages; the page cap, 127, follows from the 24 MiB byte cap, so the 62-part caboose fits in one page.
- P2 (Task 2): `render.js` reads `three.min.js` beside `require.resolve('three')`, since three 0.147 exports no `./build/*`.
- P3 (Task 12): the old spec's Part 4 note is replaced, not added to.
- P4 (Tasks 5, 11): `cases.test.js` builds only the five trial cases; approved answers are model-written code and build only in the sandbox.
- P5, P12 (Tasks 7, 11): `npm run describe` exits 2 on a stop (GPU short, a describer that did not start or died, a refused connection) and 1 when only views failed; `ci/eval-complex` skips the judge only after a 2. A dead describer is reported as a crash, and its stdin gets an `'error'` handler.
- P6, P7 (Tasks 10, 11): two tests that asserted nothing now assert.
- P8 (Tasks 1, 3, 4, 5, 6, 7, 9): one `renderRecord`, one exported `isRecord`, one `weights` function in `describer-setup.sh`, one `describeStop` message.
- P9: plan code comments cut to one or two lines; what they said moved to `architecture.md` (Eval conversations, the describer protocol) or the user manual.
- P10: the `--regrade` check joins the gates after Tasks 7 and 11 as well.
- P11 (Task 4): `hitCap` and `endedWithoutReply` count from the last user message.
- P13 (Task 7): `grader-validate` fails when a view fails to describe, and does not judge after a stop.
- P14 (Global Constraints, Task 2, spec): the margin is 3% on each side, the trial renderer's half-extent x 1.06.
- P15: `development.md` notes the python3 skip (Task 6), the trial reference in `cases.test.js` is marked optional, `--rerender` counts only runs it rendered and recomputes the summary (Task 9), and the executor client's comment names `mesh` (Task 1).
- P16 (Task 7): the uncapped `bodies` probe goes in the backlog.

## File map

| file | responsibility |
|---|---|
| `packages/agent-loop/eval/mesh.js` (new) | executor side: a model's parts as pages of base64 triangles; parent side: collect and check pages; `meshSha256` |
| `packages/agent-loop/eval/views.js` (new) | the three views: name, label, camera direction, up |
| `packages/agent-loop/eval/render/page.html` (new) | the three.js page: `drawModel(parts)`, `renderView(dir, up)` |
| `packages/agent-loop/eval/render.js` (new) | chromium renderer (one browser, one page, one model at a time); `createRunRenderer` for a result file |
| `packages/agent-loop/eval/complex.js` (new) | harness gates, `connectedGroups`, complex report and settling, `scoreComplex` |
| `packages/agent-loop/eval/grader-validation/cases.js` (new) | known cases: sources, messages, expected result |
| `packages/agent-loop/eval/grader-validate.js` (new) | `npm run grader-validate` |
| `packages/agent-loop/eval/describer/describe.py` (new) | Moondream 3.1 over Photon, JSON lines on stdin/stdout, kestrel patches, connection guard |
| `packages/agent-loop/eval/fake-describer.js` (new) | test stand-in for `describe.py` |
| `packages/agent-loop/eval/describe.js` (new) | `npm run describe`: GPU check, describer process client, descriptions into result files |
| `packages/agent-loop/eval/judge.js` (new) | `npm run judge`: prompt, votes, verdicts |
| `packages/agent-loop/eval/rerender.js` (new) | `npm run describe -- --rerender` |
| `packages/agent-loop/eval/fixtures/{toy-caboose,birdhouse,desk-organizer,dump-truck,lamp-shade,planter,chess-pieces,cable-clip,toothbrush-holder,rocket-revised}.js` (new) | the complex fixtures |
| `scripts/describer-setup.sh` (new) | describer venv and weights install, `--check` |
| `ci/eval-complex`, `ci/eval-complex.conf`, `ci/grader-validate` (new) | CI jobs |
| `packages/agent-loop/eval/{backend,executor-protocol,sandboxed-backend,grade,report,parallel,run-eval,fetch-ci-results}.js` | modified as each task says |
| `packages/agent-loop/src/providers.js` | `temperature` and `maxTokens` on the openai provider |
| `ci/eval`, `ci/README.md`, `docs/backlog.md`, `packages/agent-loop/docs/*.md`, `packages/agent-loop/package.json` | modified as each task says |

## Rollout gates

The spec gates each rollout step on the CI host. These need the GPU host and, for reading renders and descriptions, the user. The executor stops at each gate, runs what it can (`sci push`), and asks the user for the read.

- After Task 5 (spec step 1): `sci push jscadui/grader-validate` with `UNTIL=render`; the user reads the five validation cases' renders against the trial's. Also `--regrade` a copy of the current baseline result files on the CI host and check that only `regradedAt` changed.
- After Task 7 (spec step 2): `ci/grader-validate` with `UNTIL=describe`; descriptions match the trial's texts (Task 7 lists them). Also the `--regrade` check on the baseline files.
- After Task 9 (spec step 3): `ci/grader-validate` with `UNTIL=judge`; every scored case matches. Also the `--regrade` check on the baseline files.
- After Task 11 (spec step 4): one `sci push jscadui/eval-complex`; the user reads ten descriptions beside their renders; approved answers join the validation set (Task 11, step 9). Also the `--regrade` check on the baseline files.

The `--regrade` check is the spec's "each step's gate includes a `--regrade` of the current baseline files changing nothing": copy the current baseline result files to a scratch directory on the CI host, `npm run eval -w @jscadui/agent-loop -- --regrade <copies>`, and `git diff --no-index` against the originals shows only `regradedAt` changed.

---

### Task 1: The `mesh` request

**Files:**
- Create: `packages/agent-loop/eval/mesh.js`
- Create: `packages/agent-loop/eval/mesh.test.js`
- Create: `packages/agent-loop/eval/mesh-executor.test.js`
- Modify: `packages/agent-loop/eval/backend.js`
- Modify: `packages/agent-loop/eval/executor-protocol.js`
- Modify: `packages/agent-loop/eval/executor-protocol.test.js` (append one test)
- Modify: `packages/agent-loop/eval/sandboxed-backend.js`
- Modify: `packages/agent-loop/docs/architecture.md` (Sandbox section)

**Model:** `sonnet` — the code is given, but it crosses the executor trust boundary and touches four files.

**Interfaces:**
- Consumes: `wrapOne` from `@jscadui/model-tools/src/array-geom.js`; `ExecutorExited`, `createExecutorClient`, `serveExecutor` in `eval/executor-protocol.js`.
- Produces:
  - `eval/mesh.js`: `MAX_MESH_BYTES = 25_165_824`, `MESH_PAGE_CHARS = 983_040`, `MAX_MESH_PAGES = 127` (derived from `MAX_MESH_BYTES`), `meshPages(geometry) → { bytes, pages: [[{ part, color, data }]] }` (each page a list of pieces: consecutive parts share a page, a part that does not fit goes on over the next), `meshPage(mesh, index) → { pages, bytes, pieces? }`, `collectMesh(fetchPage: (index) => Promise<unknown>) → Promise<{ parts: [{ color: [r,g,b]|null, positions: Float32Array }] } | { error: string }>`, `meshSha256(parts) → string` (64 hex).
  - `eval/executor-protocol.js`: `isRecord` exported (Tasks 1 and 3 import it instead of defining their own).
  - backend (`createEvalBackend()`): new method `mesh(index) → page`; `gradeProject(model, { timeoutMs, probe, mesh: true })` adds `mesh: { parts } | { error }` when the model built.
  - executor client: `mesh(index, { timeoutMs }) → Promise<object|null>`.
  - `gradeInFreshExecutor(start, model, { timeoutMs, readyTimeoutMs, probe, mesh })` adds `mesh` to a grade that built; `createSandboxedBackend().gradeProject(model, { ..., mesh: true })` passes it through. `MESH_PAGE_TIMEOUT_MS = 30_000`.

- [ ] **Step 1: Write the failing mesh tests**

Create `packages/agent-loop/eval/mesh.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createEvalBackend } from './backend.js'
import { collectMesh, MAX_MESH_BYTES, MAX_MESH_PAGES, meshPage, meshPages, meshSha256 } from './mesh.js'

const { colors, primitives } = createRequire(import.meta.url)('@jscad/modeling')
const served = (mesh) => async (index) => meshPage(mesh, index)
const floats = (values) => Buffer.from(new Float32Array(values).buffer).toString('base64')
const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const page = (piece = {}, extra = {}) => ({ pages: 1, bytes: 36, pieces: [{ part: 0, color: null, data: floats(TRIANGLE), ...piece }], ...extra })
const BIG = () => primitives.sphere({ radius: 10, segments: 256 })

describe('meshPages and collectMesh', () => {
  it('sends each part with its colour and whole triangles', async () => {
    const red = colors.colorize([1, 0, 0], primitives.cuboid({ size: [20, 10, 5] }))
    const plain = primitives.sphere({ radius: 3, segments: 8 })
    const { parts } = await collectMesh(served(meshPages([red, plain])))
    expect(parts).toHaveLength(2)
    expect(parts[0].color).toEqual([1, 0, 0])
    expect(parts[1].color).toBeNull()
    expect(parts[0].positions.length).toBe(12 * 9)
    expect(parts[1].positions.length % 9).toBe(0)
  })

  it('packs many small parts into one page, each with its own colour', async () => {
    const cubes = Array.from({ length: 62 }, (_, i) => colors.colorize([i / 62, 0, 0], primitives.cuboid({ size: [1, 1, 1], center: [i * 2, 0, 0] })))
    const mesh = meshPages(cubes)
    expect(mesh.pages).toHaveLength(1)
    const { parts } = await collectMesh(served(mesh))
    expect(parts.map((p) => p.color)).toEqual(cubes.map((_, i) => [i / 62, 0, 0]))
    expect(parts.every((p) => p.positions.length === 12 * 9)).toBe(true)
  })

  it('splits a large part across pages and joins it back in order', async () => {
    const mesh = meshPages(BIG())
    expect(mesh.pages.length).toBeGreaterThan(1)
    const { parts } = await collectMesh(served(mesh))
    expect(parts).toHaveLength(1)
    expect(parts[0].positions.length).toBe(mesh.bytes / 4)
  })

  it('splits a part that crosses a page and keeps the parts either side of it', async () => {
    const mesh = meshPages([primitives.cuboid({ size: [1, 1, 1] }), BIG(), primitives.cuboid({ size: [2, 2, 2] })])
    expect(mesh.pages[0].map((p) => p.part)).toEqual([0, 1])
    expect(mesh.pages.at(-1).map((p) => p.part)).toEqual([1, 2])
    const { parts } = await collectMesh(served(mesh))
    expect(parts.map((p) => p.positions.length)).toEqual([12 * 9, mesh.bytes / 4 - 24 * 9, 12 * 9])
  })

  it('keeps every page of one-triangle parts under the reply cap', () => {
    const color = [0.1234567890123456, 0.7803921568627451, 1e-7]
    const tiny = Array.from({ length: 30_000 }, (_, i) => ({ color, toPolygons: () => [{ vertices: [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]] }] }))
    const mesh = meshPages(tiny)
    expect(mesh.pages.length).toBeGreaterThan(1)
    for (let index = 0; index < mesh.pages.length; index += 1) expect(JSON.stringify(meshPage(mesh, index)).length).toBeLessThan(1024 * 1024)
  })

  it('hashes the same model the same way and a moved one differently', async () => {
    const at = async (x) => meshSha256((await collectMesh(served(meshPages(primitives.cuboid({ size: [10, 10, 10], center: [x, 0, 0] }))))).parts)
    expect(await at(0)).toBe(await at(0))
    expect(await at(0)).not.toBe(await at(1))
    expect(await at(0)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sends no pages for a model over the size limit', () => {
    const polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }
    const huge = { measureBoundingBox: () => [[0, 0, 0], [1, 1, 0]], toPolygons: () => new Array(Math.floor(MAX_MESH_BYTES / 36) + 1).fill(polygon) }
    const mesh = meshPages(huge)
    expect(mesh.pages).toEqual([])
    expect(mesh.bytes).toBeGreaterThan(MAX_MESH_BYTES)
  })

  it.each([
    ['a malformed first reply', [null], /malformed/],
    ['a size over the limit', [{ pages: 0, bytes: MAX_MESH_BYTES + 1 }], /over the/],
    ['too many pages', [{ pages: MAX_MESH_PAGES + 1, bytes: 36 }], /page limit/],
    ['no triangles', [{ pages: 0, bytes: 0 }], /no triangles/],
    ['a page with no pieces', [page({}, { pieces: [] })], /malformed/],
    ['a count that is not whole triangles', [page({ data: floats([0, 0, 0, 1, 0, 0, 0, 1]) })], /whole triangles/],
    ['a NaN', [page({ data: floats([NaN, 0, 0, 1, 0, 0, 0, 1, 0]) })], /finite/],
    ['text that is not base64', [page({ data: 'not base64!' })], /whole triangles/],
    ['a colour out of range', [page({ color: [2, 0, 0] })], /malformed/],
    ['a page count that changes', [page({}, { pages: 2, bytes: 72 }), page({}, { pages: 3 })], /malformed/],
    ['a part out of order', [page({ part: 1 }, { pages: 2, bytes: 72 }), page({ part: 0 }, { pages: 2 })], /malformed/],
    ['a part whose colour changes between pages', [page({}, { pages: 2, bytes: 72 }), page({ color: [1, 0, 0] }, { pages: 2 })], /malformed/],
  ])('refuses %s', async (_name, replies, error) => {
    expect((await collectMesh(async (index) => replies[index])).error).toMatch(error)
  })

  it('joins a part carried over from one page to the next', async () => {
    const replies = [page({}, { pages: 2, bytes: 72 }), page({}, { pages: 2 })]
    const { parts } = await collectMesh(async (index) => replies[index])
    expect(parts).toHaveLength(1)
    expect(parts[0].positions.length).toBe(18)
  })
})

describe('the eval backend', () => {
  const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 }).colorize([0, 0, 1])] }'

  it('answers mesh with no pages before anything built', async () => {
    expect(await createEvalBackend().mesh(0)).toEqual({ pages: 0, bytes: 0 })
  })

  it('adds the graded model mesh to a grade that asks for it', async () => {
    const graded = await createEvalBackend().gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' }, { mesh: true })
    expect(graded.mesh.parts).toHaveLength(1)
    expect(graded.mesh.parts[0].color).toEqual([0, 0, 1])
    expect(graded.mesh.parts[0].positions.length).toBe(12 * 9)
  })

  it('leaves the mesh out of a grade that does not ask for it', async () => {
    const graded = await createEvalBackend().gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' })
    expect(graded).not.toHaveProperty('mesh')
  })
})
```

Create `packages/agent-loop/eval/mesh-executor.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { ExecutorExited } from './executor-protocol.js'
import { gradeInFreshExecutor } from './sandboxed-backend.js'
import { startExecutor } from './sandbox.js'

const CHILD = { kind: 'child' }
const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 }).colorize([0, 0, 1])] }'
const model = { files: { 'main.js': CUBE }, entry: 'main.js' }

const fakeExecutor = (mesh) => () => ({
  ready: Promise.resolve('fluent'),
  gradeProject: async () => ({ measure: { volume: 1 }, solid: null, params: [] }),
  mesh,
  close: () => {},
})

describe('gradeInFreshExecutor with mesh', () => {
  it('sends the graded model as a mesh from the same executor child', async () => {
    const graded = await gradeInFreshExecutor(() => startExecutor({ api: 'fluent', sandbox: CHILD }), model, { mesh: true })
    expect(graded.measure.volume).toBeCloseTo(8000, 0)
    expect(graded.mesh.parts).toHaveLength(1)
    expect(graded.mesh.parts[0].color).toEqual([0, 0, 1])
    expect(graded.mesh.parts[0].positions.length).toBe(12 * 9)
  }, 30_000)

  it('records an executor that ends mid-mesh as the mesh error', async () => {
    const graded = await gradeInFreshExecutor(
      fakeExecutor(async () => {
        throw new ExecutorExited('code 3')
      }),
      model,
      { mesh: true },
    )
    expect(graded.measure).toEqual({ volume: 1 })
    expect(graded.mesh.error).toMatch(/ended while sending the mesh \(code 3\)/)
  })

  it('asks for no mesh unless told to', async () => {
    let asked = false
    const graded = await gradeInFreshExecutor(
      fakeExecutor(async () => {
        asked = true
        return null
      }),
      model,
    )
    expect(asked).toBe(false)
    expect(graded).not.toHaveProperty('mesh')
  })
})
```

Append to the end of `packages/agent-loop/eval/executor-protocol.test.js` (it already has `transportPair`, `fakeBackend`, `createExecutorClient` and `serveExecutor` in scope):

```js
describe('the mesh request', () => {
  it('passes a mesh page through and answers a reply that is not a page with null', async () => {
    const { client, server } = transportPair()
    let reply = { pages: 1, bytes: 36, pieces: [{ part: 0, color: null, data: 'AAAA' }] }
    serveExecutor(server, () => fakeBackend({ mesh: async () => reply }))
    const executor = createExecutorClient(client, { api: 'fluent' })
    expect(await executor.mesh(0)).toEqual(reply)
    reply = 'not a page'
    expect(await executor.mesh(0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/mesh.test.js eval/mesh-executor.test.js eval/executor-protocol.test.js`
Expected: FAIL, `mesh.js` cannot be resolved and `executor.mesh is not a function`.

- [ ] **Step 3: Write `eval/mesh.js`**

```js
// The grade executor's `mesh` request: each part's colour and triangles in pages under the reply cap.
import { createHash } from 'node:crypto'
import { wrapOne } from '@jscadui/model-tools/src/array-geom.js'
import { isRecord } from './executor-protocol.js'

export const MAX_MESH_BYTES = 24 * 1024 * 1024
const TRIANGLE_BYTES = 9 * 4
const TRIANGLE_CHARS = (TRIANGLE_BYTES / 3) * 4
// A page's pieces in JSON characters, under the 1 MiB reply cap; a piece's JSON besides its data stays under PIECE_CHARS.
export const MESH_PAGE_CHARS = 960 * 1024
const PIECE_CHARS = 128
// Every page but the last is full to within one piece and every part has a triangle, so the byte cap bounds the pages.
const MAX_TRIANGLES = Math.floor(MAX_MESH_BYTES / TRIANGLE_BYTES)
export const MAX_MESH_PAGES = Math.ceil((MAX_TRIANGLES * (TRIANGLE_CHARS + PIECE_CHARS)) / (MESH_PAGE_CHARS - 2 * PIECE_CHARS - TRIANGLE_CHARS)) + 1
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const colorOf = (color) =>
  Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every((c) => typeof c === 'number' && Number.isFinite(c))
    ? color.slice(0, 3).map((c) => Math.min(1, Math.max(0, c)))
    : null

const triangleCount = (polygons) => polygons.reduce((n, { vertices }) => n + Math.max(0, vertices.length - 2), 0)

const partsOf = (geometry) =>
  [geometry]
    .flat(Infinity)
    .map(wrapOne)
    .filter((g) => typeof g?.toPolygons === 'function')
    .map((g) => ({ color: colorOf(g.color), polygons: g.toPolygons() }))
    .filter((p) => triangleCount(p.polygons) > 0)

// Each polygon fanned from its first vertex.
const positionsOf = (polygons) => {
  const positions = new Float32Array(triangleCount(polygons) * 9)
  let at = 0
  for (const { vertices } of polygons) {
    for (let i = 1; i + 1 < vertices.length; i += 1) {
      positions.set(vertices[0], at)
      positions.set(vertices[i], at + 3)
      positions.set(vertices[i + 1], at + 6)
      at += 9
    }
  }
  return positions
}

const toBase64 = (chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64')

// Consecutive parts share a page; a part that does not fit in what is left of one goes on over the next.
const pack = (parts) => {
  const pages = []
  let page = []
  let room = MESH_PAGE_CHARS
  parts.forEach(({ color, polygons }, part) => {
    const positions = positionsOf(polygons)
    for (let at = 0; at < positions.length; ) {
      const fits = Math.floor((room - PIECE_CHARS) / TRIANGLE_CHARS) * 9
      if (fits <= 0) {
        pages.push(page)
        page = []
        room = MESH_PAGE_CHARS
        continue
      }
      const chunk = positions.subarray(at, at + fits)
      page.push({ part, color, data: toBase64(chunk) })
      room -= PIECE_CHARS + (chunk.length / 9) * TRIANGLE_CHARS
      at += chunk.length
    }
  })
  return page.length ? [...pages, page] : pages
}

// Executor side. The size is counted before any array is allocated, so a huge model cannot run the executor out of memory here.
export const meshPages = (geometry) => {
  const parts = partsOf(geometry)
  const bytes = parts.reduce((n, p) => n + triangleCount(p.polygons) * TRIANGLE_BYTES, 0)
  return bytes > MAX_MESH_BYTES ? { bytes, pages: [] } : { bytes, pages: pack(parts) }
}

export const meshPage = ({ bytes, pages }, index) => ({ pages: pages.length, bytes, ...(pages[index] ? { pieces: pages[index] } : {}) })

const isColor = (color) => color === null || (Array.isArray(color) && color.length === 3 && color.every((c) => typeof c === 'number' && c >= 0 && c <= 1))

const sameColor = (a, b) => (a === null ? b === null : b !== null && a.every((c, i) => c === b[i]))

// Whole triangles of finite Float32 numbers from a piece's base64, or null.
const decodeTriangles = (data) => {
  if (typeof data !== 'string' || data.length % 4 !== 0 || !BASE64.test(data)) return null
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length % TRIANGLE_BYTES !== 0) return null
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
  return values.every((v) => Number.isFinite(v)) ? values : null
}

const concat = (chunks) => {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

// A piece that goes on the part before it must keep its colour; any other must start a later part.
const pieceFits = (piece, last) =>
  isRecord(piece) &&
  Number.isInteger(piece.part) &&
  piece.part >= (last?.part ?? 0) &&
  isColor(piece.color) &&
  (piece.part !== last?.part || sameColor(last.color, piece.color))

// Parent side: every page through `fetchPage(index)`, each piece checked, parts joined in order.
export const collectMesh = async (fetchPage) => {
  const first = await fetchPage(0)
  if (!isRecord(first) || !Number.isInteger(first.pages) || !Number.isInteger(first.bytes)) return { error: 'the mesh reply was malformed' }
  if (first.bytes > MAX_MESH_BYTES) return { error: `the mesh is ${first.bytes} bytes, over the ${MAX_MESH_BYTES}-byte limit` }
  if (first.pages > MAX_MESH_PAGES) return { error: `the mesh came in ${first.pages} pages, over the ${MAX_MESH_PAGES}-page limit` }
  if (first.pages < 1) return { error: 'the model has no triangles' }
  const parts = []
  let bytes = 0
  for (let index = 0; index < first.pages; index += 1) {
    const page = index === 0 ? first : await fetchPage(index)
    if (!isRecord(page) || page.pages !== first.pages || !Array.isArray(page.pieces) || page.pieces.length === 0) {
      return { error: `mesh page ${index} was malformed` }
    }
    for (const piece of page.pieces) {
      const last = parts.at(-1)
      if (!pieceFits(piece, last)) return { error: `mesh page ${index} was malformed` }
      const triangles = decodeTriangles(piece.data)
      if (!triangles) return { error: `mesh page ${index} is not whole triangles of finite numbers` }
      bytes += triangles.byteLength
      if (bytes > MAX_MESH_BYTES) return { error: `the mesh passed the ${MAX_MESH_BYTES}-byte limit` }
      if (piece.part === last?.part) last.chunks.push(triangles)
      else parts.push({ part: piece.part, color: piece.color, chunks: [triangles] })
    }
  }
  return { parts: parts.map(({ color, chunks }) => ({ color, positions: concat(chunks) })) }
}

export const meshSha256 = (parts) => {
  const hash = createHash('sha256')
  for (const { color, positions } of parts) {
    hash.update(JSON.stringify(color))
    hash.update(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength))
  }
  return hash.digest('hex')
}
```

- [ ] **Step 4: Add `mesh` to the eval backend**

In `packages/agent-loop/eval/backend.js`:

After `import { runProbe } from './probe.js'` add:

```js
import { collectMesh, meshPage, meshPages } from './mesh.js'
```

Replace

```js
  // A build that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0

  const build = async (entry = resolveEntry(files)) => {
    const started = generation
```

with

```js
  // A build that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0
  // The last build's mesh pages, made on the first `mesh` request after it.
  let meshed = null

  const build = async (entry = resolveEntry(files)) => {
    const started = generation
    meshed = null
```

Replace

```js
  const seed = (seeded = {}) => {
    generation += 1
    current = null
```

with

```js
  const seed = (seeded = {}) => {
    generation += 1
    current = null
    meshed = null
```

Replace

```js
  // Builds `{ files, entry }` (grade.js gradedModel) in a fresh state and
  // measures it, plus the fixture's `probe` when it has one.
  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS, probe } = {}) => {
```

with

```js
  // The last build's triangles, a page at a time (eval/mesh.js).
  const mesh = async (index = 0) => {
    if (!current?.geometry) return { pages: 0, bytes: 0 }
    meshed ??= meshPages(current.geometry)
    return meshPage(meshed, index)
  }

  // Builds `{ files, entry }` (grade.js gradedModel) in a fresh state and
  // measures it, plus the fixture's `probe` when it has one.
  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS, probe, mesh: wantsMesh = false } = {}) => {
```

Replace

```js
    const graded = { measure: measured.ok ? measured : null, solid: checked.ok ? checked : null, params: current.params }
    return probe ? { ...graded, probe: await probed(probe, model, deadline, buildMs) } : graded
  }

  return { requestTool, reset, gradeProject, files: () => ({ ...files }), lastBuild: () => current?.report ?? null }
```

with

```js
    const graded = { measure: measured.ok ? measured : null, solid: checked.ok ? checked : null, params: current.params }
    const withProbe = probe ? { ...graded, probe: await probed(probe, model, deadline, buildMs) } : graded
    return wantsMesh ? { ...withProbe, mesh: await collectMesh(mesh) } : withProbe
  }

  return { requestTool, reset, gradeProject, mesh, files: () => ({ ...files }), lastBuild: () => current?.report ?? null }
```

- [ ] **Step 5: Add `mesh` to the executor protocol**

In `packages/agent-loop/eval/executor-protocol.js`, replace

```js
const METHODS = new Set(['reset', 'requestTool', 'gradeProject'])
```

with

```js
const METHODS = new Set(['reset', 'requestTool', 'gradeProject', 'mesh'])
```

Replace `const isRecord = (value) =>` with `export const isRecord = (value) =>` (`eval/mesh.js` and, in Task 3, `eval/complex.js` import it).

Replace

```js
// The eval backend's interface (reset, requestTool, gradeProject), every method
// async. reset resolves with a build report or null, requestTool always with a
// string and gradeProject with a grade; a call rejects only with ExecutorExited. A grade gets `graceMs` past
```

with

```js
// The eval backend's interface (reset, requestTool, gradeProject, mesh), every method
// async: a build report or null, a string, a grade, a mesh page or null; a call rejects
// only with ExecutorExited. A grade gets `graceMs` past
```

Replace

```js
const REPLIES = { reset: resetReply, requestTool: toolReply, gradeProject: gradeReply }
```

with

```js
// A mesh page of plain JSON data, or null; eval/mesh.js checks its shape.
const meshReply = (message) => {
  const data = message.ok ? jsonData(message.value, MAX_GRADE_BYTES) : undefined
  return isRecord(data) ? data : null
}

const REPLIES = { reset: resetReply, requestTool: toolReply, gradeProject: gradeReply, mesh: meshReply }
```

Replace

```js
    gradeProject,
    alive: () => !exited,
```

with

```js
    gradeProject,
    mesh: (index, { timeoutMs } = {}) => call('mesh', [index], { timeoutMs }),
    alive: () => !exited,
```

- [ ] **Step 6: Ask the grade executor for the mesh**

In `packages/agent-loop/eval/sandboxed-backend.js`, after `import { GRADE_TIMEOUT_MS } from './grade.js'` add:

```js
import { collectMesh } from './mesh.js'
```

After `export const READY_TIMEOUT_MS = 60_000` add:

```js
export const MESH_PAGE_TIMEOUT_MS = 30_000
```

Replace

```js
// A death during the grade grades nothing: the model's code caused it.
export const gradeInFreshExecutor = async (start, model, { timeoutMs = GRADE_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS, probe } = {}) => {
  if (!model) return NO_GRADE()
  const executor = start()
  try {
    await whenReady(executor, readyTimeoutMs)
    return await executor.gradeProject(model, probe ? { timeoutMs, probe } : { timeoutMs })
  } catch (error) {
```

with

```js
const meshFrom = async (executor) => {
  try {
    return await collectMesh((index) => executor.mesh(index, { timeoutMs: MESH_PAGE_TIMEOUT_MS }))
  } catch (error) {
    if (error instanceof ExecutorExited) return { error: `the evaluator ended while sending the mesh (${error.reason})` }
    throw error
  }
}

// A death during the grade grades nothing: the model's code caused it. With
// `mesh`, the same executor then sends the triangles of a model that built.
export const gradeInFreshExecutor = async (start, model, { timeoutMs = GRADE_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS, probe, mesh = false } = {}) => {
  if (!model) return NO_GRADE()
  const executor = start()
  try {
    await whenReady(executor, readyTimeoutMs)
    const graded = await executor.gradeProject(model, probe ? { timeoutMs, probe } : { timeoutMs })
    if (!mesh || !graded.measure) return graded
    return { ...graded, mesh: await meshFrom(executor) }
  } catch (error) {
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/mesh.test.js eval/mesh-executor.test.js eval/executor-protocol.test.js eval/executor.test.js eval/sandboxed-backend.test.js`
Expected: PASS.

- [ ] **Step 8: Document the request**

In `packages/agent-loop/docs/architecture.md`, Sandbox section, insert after the paragraph that ends `a fresh executor per grade stops it carrying anything over from the conversation or another run.`:

```markdown
A `complex` fixture's grade executor then answers `mesh` requests
(`eval/mesh.js`): each part `main()` returned, with its colour (`[r, g, b]` in
0 to 1, or null) and its triangles as base64 Float32 positions. The parts go
out in order as pieces packed into pages: consecutive parts share a page, and
a part that does not fit in what is left of one goes on over the next. A page
holds at most 960 KiB of JSON, each piece charged 128 characters on top of its
data, so every reply stays under the 1 MiB cap however many parts there are.
A model over 24 MiB of triangles (about 700,000) gets no pages, only its size,
counted before anything is allocated. Every page but the last is full to
within one piece and every part has at least one triangle, so 24 MiB fits in
127 pages whatever the part count; a 62-part caboose fits in one. The parent
checks every page: a page count of at most 127 that never changes, parts in
order, a part carried over to the next page keeping its colour, colours in
range, whole triangles of finite numbers, and a running total under 24 MiB.
Anything else, or an executor that ends mid-mesh, becomes the run's
`renderError`. Model code shares that executor and can send a different mesh,
as it can forge its grade; that only changes how its own model looks. In an
executor the client asks for the pages itself after the grade; the backend's
`gradeProject` option `mesh: true` collects them for an in-process grade.
```

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/eval/mesh.js packages/agent-loop/eval/mesh.test.js packages/agent-loop/eval/mesh-executor.test.js packages/agent-loop/eval/backend.js packages/agent-loop/eval/executor-protocol.js packages/agent-loop/eval/executor-protocol.test.js packages/agent-loop/eval/sandboxed-backend.js packages/agent-loop/docs/architecture.md
```

```bash
git commit -m "feat(eval): the grade executor sends the model's mesh in checked pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 2: The renderer

**Files:**
- Create: `packages/agent-loop/eval/views.js`
- Create: `packages/agent-loop/eval/render/page.html`
- Create: `packages/agent-loop/eval/render.js`
- Create: `packages/agent-loop/eval/render.test.js`
- Modify: `packages/agent-loop/package.json` (devDependencies), `package-lock.json` (by `npm install`)
- Modify: `packages/agent-loop/docs/architecture.md` (new section), `packages/agent-loop/docs/development.md` (Tests)

**Model:** `sonnet` — three.js and Playwright wiring from the proven trial renderer.

**Interfaces:**
- Consumes: `collectMesh`, `meshPage`, `meshPages` (Task 1) in the test.
- Produces:
  - `eval/views.js`: `VIEWS = [{ name: 'iso-front', label: 'front three-quarter view', dir, up }, { name: 'iso-back', ... }, { name: 'side', ... }]`, `VIEW_LABELS: { [name]: label }`.
  - `eval/render.js`: `RENDER_SIZE = 768`, `LAUNCH_ARGS`, `createRenderer({ launch }) → Promise<{ render(parts, dir) → Promise<[{ name, path (absolute), sha256 }]>, refused() → number, close() }>`, `createRunRenderer(filePath, { start }) → { start() → Promise<renderer>, render(parts, { fixture, run }) → Promise<[{ name, path (relative to the file's dir), sha256 }]>, close() }`.

- [ ] **Step 1: Add the dependencies**

In `packages/agent-loop/package.json` `devDependencies`, add (keeping alphabetical order: `@playwright/test` after `@jscadui/worker`, `three` before `vitest`):

```json
    "@playwright/test": "^1.58.2",
```

```json
    "three": "^0.147.0",
```

Run: `npm install`
Expected: exits 0; `package-lock.json` gains the two entries for `packages/agent-loop` (both packages are already hoisted in the root `node_modules`).

Run: `node -e "const { dirname, join } = require('node:path'); const r = require('node:module').createRequire(process.cwd() + '/packages/agent-loop/'); console.log(join(dirname(r.resolve('three')), 'three.min.js'))"`
Expected: a path ending `node_modules/three/build/three.min.js`. three 0.147's `exports` has no `./build/*` (`resolve('three/build/three.min.js')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`), so `render.js` resolves the package's main entry, `build/three.cjs`, and reads the file beside it.

- [ ] **Step 2: Write the failing renderer tests**

Create `packages/agent-loop/eval/render.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'
import { collectMesh, meshPage, meshPages } from './mesh.js'
import { createRenderer, createRunRenderer, RENDER_SIZE } from './render.js'
import { VIEW_LABELS, VIEWS } from './views.js'

const { colors, primitives } = createRequire(import.meta.url)('@jscad/modeling')

// Playwright's bundled chromium, as apps/jscad-web/e2e/render-all.mjs uses; skips without it.
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
})()

const partsOf = async (geometry) => {
  const mesh = meshPages(geometry)
  return (await collectMesh(async (index) => meshPage(mesh, index))).parts
}

describe('views', () => {
  it('are the three views the describer reads, top view left out', () => {
    expect(VIEWS.map((v) => [v.name, v.dir, v.up])).toEqual([
      ['iso-front', [1, -1, 0.7], [0, 0, 1]],
      ['iso-back', [-1, 1, 0.7], [0, 0, 1]],
      ['side', [0, -1, 0.05], [0, 0, 1]],
    ])
    expect(VIEW_LABELS).toEqual({ 'iso-front': 'front three-quarter view', 'iso-back': 'back three-quarter view', side: 'side view' })
  })
})

describe('createRunRenderer', () => {
  it('renders into <file stem>.renders/<fixture>-<run>/ and gives paths relative to the result file', async () => {
    const dirs = []
    const fake = {
      render: async (_parts, dir) => {
        dirs.push(dir)
        return VIEWS.map((v) => ({ name: v.name, path: join(dir, `${v.name}.png`), sha256: 'a'.repeat(64) }))
      },
      close: async () => {},
    }
    const renderer = createRunRenderer('/data/results/2026-10-01T120000Z-m-fluent-complex-abcd1234.json', { start: async () => fake })
    const views = await renderer.render([], { fixture: 'toy-caboose', run: 2 })
    expect(dirs).toEqual(['/data/results/2026-10-01T120000Z-m-fluent-complex-abcd1234.renders/toy-caboose-2'])
    expect(views.map((v) => v.path)).toEqual(VIEWS.map((v) => `2026-10-01T120000Z-m-fluent-complex-abcd1234.renders/toy-caboose-2/${v.name}.png`))
    await renderer.close()
  })
})

describe.skipIf(!hasChromium)('createRenderer', () => {
  it('draws three 768 px views of a coloured model and refuses no request it never made', async () => {
    const renderer = await createRenderer()
    try {
      const parts = await partsOf([
        colors.colorize([0.78, 0.14, 0.13], primitives.cuboid({ size: [80, 30, 28] })),
        primitives.cylinder({ radius: 9, height: 6, center: [26, 17, -10] }),
      ])
      const dir = mkdtempSync(join(tmpdir(), 'render-test-'))
      const views = await renderer.render(parts, dir)
      expect(views.map((v) => v.name)).toEqual(VIEWS.map((v) => v.name))
      for (const view of views) {
        const png = readFileSync(view.path)
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([RENDER_SIZE, RENDER_SIZE])
        expect(view.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
      expect(new Set(views.map((v) => v.sha256)).size).toBe(3)
      expect(renderer.refused()).toBe(0)
    } finally {
      await renderer.close()
    }
  }, 60_000)
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/render.test.js`
Expected: FAIL, `render.js` and `views.js` cannot be resolved.

- [ ] **Step 4: Write `eval/views.js`**

```js
// The three views the describer reads. No top view: in the trial Moondream
// read the caboose's top view as "an electronic module" and it flipped the judge.
export const VIEWS = [
  { name: 'iso-front', label: 'front three-quarter view', dir: [1, -1, 0.7], up: [0, 0, 1] },
  { name: 'iso-back', label: 'back three-quarter view', dir: [-1, 1, 0.7], up: [0, 0, 1] },
  { name: 'side', label: 'side view', dir: [0, -1, 0.05], up: [0, 0, 1] },
]

export const VIEW_LABELS = Object.fromEntries(VIEWS.map((v) => [v.name, v.label]))
```

- [ ] **Step 5: Write `eval/render/page.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>eval render</title>
    <style>
      html,
      body {
        margin: 0;
        background: #ececec;
      }
      canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <canvas id="c" width="768" height="768"></canvas>
    <script>
      // eval/render.js adds three.js, then passes triangles and colours, never model code.
      const NEUTRAL = 0xb0b0b0
      let renderer = null
      let scene = null
      let box = null
      let key = null

      const decode = (data) => {
        const binary = atob(data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        return new Float32Array(bytes.buffer)
      }

      const dispose = (old) => {
        old?.traverse((node) => {
          node.geometry?.dispose()
          node.material?.dispose()
        })
      }

      window.drawModel = (parts) => {
        const T = window.THREE
        renderer ??= new T.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true })
        renderer.setSize(768, 768, false)
        renderer.setClearColor(0xececec, 1)
        renderer.outputEncoding = T.sRGBEncoding
        dispose(scene)
        scene = new T.Scene()
        box = new T.Box3()
        for (const { color, data } of parts) {
          const geometry = new T.BufferGeometry()
          geometry.setAttribute('position', new T.Float32BufferAttribute(decode(data), 3))
          geometry.computeVertexNormals()
          const tint = color ? new T.Color().setRGB(color[0], color[1], color[2]) : new T.Color(NEUTRAL)
          tint.convertSRGBToLinear()
          const surface = new T.MeshStandardMaterial({
            color: tint,
            roughness: 0.75,
            metalness: 0,
            flatShading: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          })
          scene.add(new T.Mesh(geometry, surface))
          scene.add(new T.LineSegments(new T.EdgesGeometry(geometry, 30), new T.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35 })))
          geometry.computeBoundingBox()
          box.union(geometry.boundingBox)
        }
        scene.add(new T.HemisphereLight(0xffffff, 0x9a9a9a, 1.6))
        key = new T.DirectionalLight(0xffffff, 1.4)
        scene.add(key)
        scene.add(key.target)
      }

      // Orthographic, framed to the bounding box's corners in view space with a 3% margin on each side.
      window.renderView = (dir, up) => {
        const T = window.THREE
        const center = box.getCenter(new T.Vector3())
        const d = new T.Vector3(...dir).normalize()
        const radius = box.getSize(new T.Vector3()).length()
        const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, radius * 10)
        camera.up.set(...up)
        camera.position.copy(center).addScaledVector(d, radius * 3)
        camera.lookAt(center)
        camera.updateMatrixWorld()
        const inverse = camera.matrixWorldInverse
        let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const p = new T.Vector3(x, y, z).applyMatrix4(inverse)
              x0 = Math.min(x0, p.x)
              x1 = Math.max(x1, p.x)
              y0 = Math.min(y0, p.y)
              y1 = Math.max(y1, p.y)
            }
          }
        }
        const half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.06
        const cx = (x0 + x1) / 2
        const cy = (y0 + y1) / 2
        Object.assign(camera, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half })
        camera.updateProjectionMatrix()
        const right = new T.Vector3().crossVectors(d, camera.up).normalize()
        key.position.copy(center).addScaledVector(d, radius).addScaledVector(right, radius * 0.6).addScaledVector(camera.up, radius)
        key.target.position.copy(center)
        renderer.render(scene, camera)
      }
    </script>
  </body>
</html>
```

- [ ] **Step 6: Write `eval/render.js`**

```js
// Draws a model's triangles in the run-eval process, never in an executor: the crt sandbox has no WebGL.
// Playwright's bundled chromium is launched as apps/jscad-web/e2e/render-all.mjs launches it.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { chromium } from '@playwright/test'
import { VIEWS } from './views.js'

export const RENDER_SIZE = 768
export const LAUNCH_ARGS = ['--use-gl=angle', '--ignore-gpu-blocklist']

const nodeRequire = createRequire(import.meta.url)
// three 0.147's `exports` has no ./build/*; its main entry sits beside three.min.js.
const THREE = readFileSync(join(dirname(nodeRequire.resolve('three')), 'three.min.js'), 'utf8')
const PAGE = readFileSync(new URL('./render/page.html', import.meta.url), 'utf8')

const toBase64 = (positions) => Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).toString('base64')

// One browser and one page per process, one model at a time. The page is set
// as content and three.js added inline, so it needs no request; any it makes is refused.
export const createRenderer = async ({ launch = (options) => chromium.launch(options) } = {}) => {
  const browser = await launch({ headless: true, args: LAUNCH_ARGS })
  let refused = 0
  try {
    const page = await browser.newPage({ viewport: { width: RENDER_SIZE, height: RENDER_SIZE } })
    await page.route('**/*', (route) => {
      refused += 1
      return route.abort()
    })
    await page.setContent(PAGE)
    await page.addScriptTag({ content: THREE })
    const renderNow = async (parts, dir) => {
      await page.evaluate((payload) => window.drawModel(payload), parts.map(({ color, positions }) => ({ color, data: toBase64(positions) })))
      mkdirSync(dir, { recursive: true })
      const views = []
      for (const view of VIEWS) {
        await page.evaluate(({ dir: from, up }) => window.renderView(from, up), view)
        const png = await page.locator('#c').screenshot()
        const path = join(dir, `${view.name}.png`)
        writeFileSync(path, png)
        views.push({ name: view.name, path, sha256: createHash('sha256').update(png).digest('hex') })
      }
      return views
    }
    let queue = Promise.resolve()
    return {
      render: (parts, dir) => {
        const next = queue.then(() => renderNow(parts, dir))
        queue = next.catch(() => {})
        return next
      },
      refused: () => refused,
      close: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// A result file's renders: <file stem>.renders/<fixture>-<run>/<view>.png beside
// it, paths relative to its directory. Chromium starts on the first render or `start()`.
export const createRunRenderer = (filePath, { start = () => createRenderer() } = {}) => {
  const dir = dirname(filePath)
  const stem = basename(filePath, '.json')
  let renderer = null
  const started = () => (renderer ??= start())
  return {
    start: started,
    render: async (parts, { fixture, run }) => {
      const views = await (await started()).render(parts, join(dir, `${stem}.renders`, `${fixture}-${run}`))
      return views.map((view) => ({ ...view, path: relative(dir, view.path) }))
    },
    close: async () => {
      if (renderer) await (await renderer).close()
    },
  }
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/render.test.js`
Expected: PASS (the `createRenderer` block is skipped only when Playwright's chromium is not installed; install it with `npx playwright install chromium` from `apps/jscad-web` if you want it to run).

- [ ] **Step 8: Document rendering**

In `packages/agent-loop/docs/architecture.md`, insert a new section before `## Sandbox`:

```markdown
## Complex grading

A `complex` fixture's geometry grade comes from a verdict on renders of the
result ([user-manual.md](user-manual.md#complex-fixtures)).

### Rendering

Rendering needs WebGL, which the crt sandbox does not have and should not get,
so `eval/render.js` draws in the `run-eval` process, in Playwright's bundled
chromium launched as `apps/jscad-web/e2e/render-all.mjs` launches it
(`--use-gl=angle --ignore-gpu-blocklist`). The page, `eval/render/page.html`,
is set as content with the workspace's three.js added inline; it gets only
triangles and colours from the `mesh` request (Sandbox below), loads no model
code, and every request it makes is refused. Each process starts one chromium
and one page and draws one model at a time.

The three orthographic 768 x 768 views (`eval/views.js`) are framed to the
model's bounding box with a 3% margin on each side (half the larger extent
times 1.06, as the trial renderer framed them): `iso-front` from (1, -1, 0.7),
`iso-back` from (-1, 1, 0.7) and `side` from (0, -1, 0.05), +Z up. There is no
top view: in the trial Moondream read the caboose's top view as "an electronic
module" and it flipped the judge. The background is `#ececec`, lit by a
hemisphere light and a key light above-left of the camera; each part has its
own colour (an unset one is neutral grey `#b0b0b0`), flat shading, and dark
lines at 35% opacity on edges where faces meet at more than 30°.
```

In `packages/agent-loop/docs/development.md`, Tests section, append to the paragraph that ends `fails on any warning from the repo's fluent examples.`:

```markdown
`eval/render.test.js` draws in Playwright's bundled chromium and skips when
it is not installed (`npx playwright install chromium` in `apps/jscad-web`).
```

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/eval/views.js packages/agent-loop/eval/render packages/agent-loop/eval/render.js packages/agent-loop/eval/render.test.js packages/agent-loop/package.json package-lock.json packages/agent-loop/docs/architecture.md packages/agent-loop/docs/development.md
```

```bash
git commit -m "feat(eval): render three views of a mesh in the parent's chromium

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 3: Complex grading core

**Files:**
- Create: `packages/agent-loop/eval/complex.js`
- Create: `packages/agent-loop/eval/complex.test.js`
- Modify: `packages/agent-loop/eval/grade.js` (export `requiresWrite`)
- Modify: `packages/agent-loop/eval/report.js`
- Modify: `packages/agent-loop/eval/report.test.js` (append)
- Modify: `packages/agent-loop/eval/parallel.js`
- Modify: `packages/agent-loop/docs/user-manual.md` (new Complex fixtures subsection)

**Model:** `sonnet` — pure functions with full code; scoring rules must match the spec exactly.

**Interfaces:**
- Consumes: `isRecord` (Task 1), `NO_GRADE` (executor-protocol.js), `geometryError`, `gradedModel`, `gradeTranscript` (grade.js), `meshSha256` (Task 1).
- Produces (`eval/complex.js`):
  - `isComplex(fixture) → boolean` (true when `fixture.gates` is a function)
  - `GROW_MM = 0.5`
  - `complexProbe(fixture) → probe spec` (`fixture.probe` plus `bodies`)
  - `userMessagesOf(fixture) → string[]` (prompt, then each follow-up's `message`)
  - `connectedGroups(bodies: [{ boundingBox: [lo, hi] }], grow = GROW_MM) → number`
  - `harnessGates({ measure, solid, probe }, pieces = 1) → [{ name: 'builds', pass }, { name: 'watertight', pass }, { name: 'connected', pass, groups }]`
  - `complexGates(fixture, graded) → gates` (harness, then the fixture's own; never throws on a grade model code shaped)
  - `complexGeometry(gates, verdict) → 0 | 1 | 2`
  - `settledReport(report, gates, verdict) → report`
  - `complexReport(fixture, transcript, gates, { maxTurns, providerError }) → report` (geometry 0)
  - `settleRun(run) → run` (sets or clears `verdictPending`, recomputes `report` when present)
  - `renderFacts(graded) → { dimensions: number[3] (rounded), bodies }`
  - `renderRecord(graded, views) → { meshSha256, facts, views }`: a run's `render` field, from a grade that has `mesh.parts`; the one place Tasks 4, 5 and 9 build it
  - `scoreComplex(fixture, run, transcript, graded, { maxTurns, providerError, render }) → Promise<{ report, fields, geometryError }>`; `render(parts, { fixture, run }) → Promise<views>`; `fields` holds `userMessages`, `gates`, `description: null`, `verdict: null`, and `render`/`verdictPending` or `renderError`.
  - `grade.js`: `requiresWrite(fixture)` exported.
  - `summarize` adds `pending` and `verdictRate` to a fixture whose runs have `gates`.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-loop/eval/complex.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { NO_GRADE } from './executor-protocol.js'
import {
  complexGates,
  complexGeometry,
  complexProbe,
  complexReport,
  connectedGroups,
  harnessGates,
  isComplex,
  renderFacts,
  renderRecord,
  scoreComplex,
  settledReport,
  settleRun,
  userMessagesOf,
} from './complex.js'
import { runSuiteParallel } from './parallel.js'

const box = (lo, hi) => ({ boundingBox: [lo, hi] })
const unit = box([0, 0, 0], [1, 1, 1])
const fixture = {
  name: 'thing',
  group: 'complex',
  prompt: 'a thing',
  followUps: [{ message: 'bigger' }],
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  probe: { sections: [{ axis: 'z', at: [0.5] }] },
  gates: () => [{ name: 'own', pass: true }],
}
const built = (bodies = [unit], watertight = true) => ({ measure: { dimensions: [10.4, 20.6, 30] }, solid: { watertight }, params: [], probe: { bodies } })
const wrote = [
  { role: 'user', content: 'a thing' },
  { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: 'x' } }] },
  { role: 'tool', toolCallId: 't1', content: JSON.stringify({ ok: true, geometry: {} }) },
  { role: 'assistant', content: 'done', toolCalls: [] },
]
const report = (geometry = 0) => ({ dimensions: { discipline: 2, recovery: 2, geometry, conservation: 2 }, total: 6 + geometry, firstAttemptFailures: 0, checkRate: 0 })
const passing = [{ name: 'builds', pass: true }, { name: 'watertight', pass: true }]
const SUCCESS = { success: true, votes: [3, 0] }
const FAILURE = { success: false, votes: [1, 2] }

describe('fixture shape', () => {
  it('marks a fixture with gates as complex', () => {
    expect(isComplex(fixture)).toBe(true)
    expect(isComplex({ checks: () => [] })).toBe(false)
  })

  it('adds the bodies probe to the fixture own probe', () => {
    expect(complexProbe(fixture)).toEqual({ sections: [{ axis: 'z', at: [0.5] }], bodies: {} })
    expect(complexProbe({ probe: { bodies: { overlaps: true } } })).toEqual({ bodies: { overlaps: true } })
  })

  it('lists the prompt and each follow-up as the user messages', () => {
    expect(userMessagesOf(fixture)).toEqual(['a thing', 'bigger'])
    expect(userMessagesOf({ prompt: 'only' })).toEqual(['only'])
  })
})

describe('connectedGroups', () => {
  it('joins bodies within 0.5 mm of each other on every side', () => {
    expect(connectedGroups([box([0, 0, 0], [10, 10, 10]), box([10.9, 0, 0], [20, 10, 10])])).toBe(1)
  })

  it('keeps bodies more than 1 mm apart separate', () => {
    expect(connectedGroups([box([0, 0, 0], [10, 10, 10]), box([11.1, 0, 0], [20, 10, 10])])).toBe(2)
  })

  it('chains bodies through the ones between them', () => {
    expect(connectedGroups([box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [2, 1, 1]), box([2, 0, 0], [3, 1, 1]), box([9, 9, 9], [10, 10, 10])])).toBe(2)
  })

  it('counts no groups for no bodies', () => {
    expect(connectedGroups([])).toBe(0)
  })
})

describe('harnessGates', () => {
  it('passes a watertight model in one piece', () => {
    expect(harnessGates(built())).toEqual([
      { name: 'builds', pass: true },
      { name: 'watertight', pass: true },
      { name: 'connected', pass: true, groups: 1 },
    ])
  })

  it('fails connected past the pieces the request calls for', () => {
    const two = [unit, box([5, 5, 5], [6, 6, 6])]
    expect(harnessGates(built(two)).at(-1)).toEqual({ name: 'connected', pass: false, groups: 2 })
    expect(harnessGates(built(two), 2).at(-1)).toEqual({ name: 'connected', pass: true, groups: 2 })
  })

  it('fails every gate for a project that did not build', () => {
    expect(harnessGates(NO_GRADE()).map((g) => g.pass)).toEqual([false, false, false])
  })
})

describe('complexGates', () => {
  it('puts the fixture own gates after the harness ones', () => {
    expect(complexGates(fixture, built()).map((g) => g.name)).toEqual(['builds', 'watertight', 'connected', 'own'])
  })

  it('grades nothing when the fixture gates cannot read a grade model code shaped', () => {
    const picky = { ...fixture, gates: (m) => [{ name: 'wide', pass: m ? m.dimensions[0].toFixed(0) === '10' : false }] }
    const forged = { measure: { dimensions: 'x' }, solid: { watertight: true }, params: [], probe: null }
    expect(complexGates(picky, forged)).toEqual([
      { name: 'builds', pass: false },
      { name: 'watertight', pass: false },
      { name: 'connected', pass: false, groups: 0 },
      { name: 'wide', pass: false },
    ])
  })
})

describe('scoring', () => {
  it('gives 2 for success with every gate, 1 for success with a failed gate, 0 otherwise', () => {
    expect(complexGeometry(passing, SUCCESS)).toBe(2)
    expect(complexGeometry([...passing, { name: 'x', pass: false }], SUCCESS)).toBe(1)
    expect(complexGeometry(passing, FAILURE)).toBe(0)
    expect(complexGeometry(passing, null)).toBe(0)
  })

  it('counts the gates plus the verdict as one entry in checkRate', () => {
    const settled = settledReport(report(), [...passing, { name: 'x', pass: false }], SUCCESS)
    expect(settled.checkRate).toBe(3 / 4)
    expect(settled.dimensions.geometry).toBe(1)
    expect(settled.total).toBe(7)
  })

  it('starts geometry at 0 and marks a run that wrote nothing', () => {
    const r = complexReport(fixture, [{ role: 'user', content: 'a thing' }, { role: 'assistant', content: 'no', toolCalls: [] }], passing)
    expect(r.dimensions.geometry).toBe(0)
    expect(r.checkRate).toBe(0)
    expect(r.wrote).toBe(false)
    expect(complexReport(fixture, wrote, passing).wrote).toBeUndefined()
  })

  it('keeps a rendered run pending until it has a verdict or a graderError', () => {
    const rendered = { report: report(), gates: passing, render: { views: [] }, description: null, verdict: null }
    expect(settleRun(rendered).verdictPending).toBe(true)
    const judged = settleRun({ ...rendered, verdictPending: true, verdict: SUCCESS })
    expect(judged.verdictPending).toBeUndefined()
    expect(judged.report.dimensions.geometry).toBe(2)
    expect(settleRun({ ...rendered, graderError: true }).verdictPending).toBeUndefined()
    expect(settleRun({ ...rendered, renderError: 'boom' }).verdictPending).toBeUndefined()
    expect(settleRun({ gates: passing, verdict: null })).toEqual({ gates: passing, verdict: null })
  })

  it('rounds the render facts', () => {
    expect(renderFacts(built([unit, unit]))).toEqual({ dimensions: [10, 21, 30], bodies: 2 })
  })

  it('records the mesh hash, the facts and the views as the run render', () => {
    const graded = { ...built(), mesh: { parts: [{ color: null, positions: new Float32Array(9) }] } }
    const record = renderRecord(graded, ['v'])
    expect(record).toEqual({ meshSha256: expect.stringMatching(/^[0-9a-f]{64}$/), facts: { dimensions: [10, 21, 30], bodies: 1 }, views: ['v'] })
  })
})

describe('scoreComplex', () => {
  const mesh = { parts: [{ color: null, positions: new Float32Array(9) }] }

  it('renders a model that built and leaves its verdict pending', async () => {
    const calls = []
    const render = async (parts, where) => {
      calls.push(where)
      return [{ name: 'iso-front', path: 'x.png', sha256: 'f'.repeat(64) }]
    }
    const { report: r, fields, geometryError } = await scoreComplex(fixture, 2, wrote, { ...built(), mesh }, { maxTurns: 8, render })
    expect(calls).toEqual([{ fixture: 'thing', run: 2 }])
    expect(fields.userMessages).toEqual(['a thing', 'bigger'])
    expect(fields.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fields.render.facts).toEqual({ dimensions: [10, 21, 30], bodies: 1 })
    expect(fields.verdictPending).toBe(true)
    expect(fields.description).toBeNull()
    expect(fields.verdict).toBeNull()
    expect(r.dimensions.geometry).toBe(0)
    expect(geometryError).toBeNull()
  })

  it('records a mesh error or a failed render as renderError, not pending', async () => {
    const bad = await scoreComplex(fixture, 1, wrote, { ...built(), mesh: { error: 'the mesh reply was malformed' } }, { render: async () => [] })
    expect(bad.fields.renderError).toBe('the mesh reply was malformed')
    expect(bad.fields.verdictPending).toBeUndefined()
    const thrown = await scoreComplex(fixture, 1, wrote, { ...built(), mesh }, {
      render: async () => {
        throw new Error('no chromium')
      },
    })
    expect(thrown.fields.renderError).toBe('render failed: no chromium')
  })

  it('renders nothing for a project that did not build', async () => {
    const { fields } = await scoreComplex(fixture, 1, wrote, NO_GRADE(), {
      render: async () => {
        throw new Error('should not render')
      },
    })
    expect(fields.gates[0]).toEqual({ name: 'builds', pass: false })
    expect(fields).not.toHaveProperty('render')
    expect(fields).not.toHaveProperty('renderError')
    expect(fields.verdictPending).toBeUndefined()
  })
})

describe('a crashed complex run', () => {
  it('gets empty gates and geometry 0', async () => {
    const [result] = await runSuiteParallel([fixture], {
      runs: 1,
      concurrency: 1,
      runJob: async () => {
        throw new Error('boom')
      },
    })
    expect(result.error).toBe('run crashed: boom')
    expect(result.gates).toEqual([])
    expect(result.report.dimensions.geometry).toBe(0)
  })
})
```

Append to the end of `packages/agent-loop/eval/report.test.js` (it already imports `formatComparison`, `formatSummary` and `summarize` and defines `run`):

```js
describe('complex runs in the summary', () => {
  const scored = (total, checkRate, firstAttemptFailures) => ({ firstAttemptFailures, checkRate, total, dimensions: {} })
  const complexRun = (overrides) => ({ fixture: 'caboose', run: 1, gates: [], report: scored(8, 1, 0), ...overrides })
  const runs = [
    complexRun({ verdict: { success: true, votes: [3, 0] } }),
    complexRun({ verdict: { success: false, votes: [0, 3] }, report: scored(6, 0.75, 2) }),
    complexRun({ verdictPending: true, report: scored(4, 0.5, 4) }),
    complexRun({ renderError: 'no mesh', report: scored(4, 0.5, 4) }),
    complexRun({ graderError: true, report: scored(4, 0.5, 4) }),
  ]

  it('leaves pending, unrendered and split-judge runs out of the score means and counts the pending', () => {
    const [s] = summarize(runs)
    expect(s.total).toBe(7)
    expect(s.checkPassRate).toBe(0.875)
    expect(s.firstAttemptFailures).toBe(14 / 5)
    expect(s.pending).toBe(1)
    expect(s.verdictRate).toBe(0.5)
  })

  it('adds no complex fields to a single-shot fixture', () => {
    const [s] = summarize([run('cube', 0, 1, 8)])
    expect(s).not.toHaveProperty('verdictRate')
    expect(s).not.toHaveProperty('pending')
  })

  it('prints and compares verdictRate and pending', () => {
    expect(formatSummary(summarize(runs))).toContain('fixture  verdictRate  pending\ncaboose  0.50  1')
    const file = { model: 'm', promptSha256: 'abcdef12', summary: summarize(runs) }
    expect(formatComparison(file, file)).toContain('caboose  0.50 → 0.50  1 → 1')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/complex.test.js eval/report.test.js`
Expected: FAIL, `complex.js` cannot be resolved and the summary lacks `pending`.

- [ ] **Step 3: Export `requiresWrite`**

In `packages/agent-loop/eval/grade.js`, replace

```js
const requiresWrite = (fixture) => fixture.requires?.some((name) => name === 'write' || name === 'writeModel') === true
```

with

```js
export const requiresWrite = (fixture) => fixture.requires?.some((name) => name === 'write' || name === 'writeModel') === true
```

- [ ] **Step 4: Write `eval/complex.js`**

```js
// Grading for `complex` fixtures, which declare `gates` in place of `checks`: the gates,
// then geometry from a verdict on a blind description of the renders (eval/describe.js, eval/judge.js).
import { isRecord, NO_GRADE } from './executor-protocol.js'
import { geometryError, gradedModel, gradeTranscript, requiresWrite } from './grade.js'
import { meshSha256 } from './mesh.js'

export const isComplex = (fixture) => typeof fixture?.gates === 'function'

// Each body's bounding box grows this much on every side before the overlap test.
export const GROW_MM = 0.5

export const complexProbe = (fixture) => ({ ...fixture.probe, bodies: fixture.probe?.bodies ?? {} })

export const userMessagesOf = (fixture) => [fixture.prompt, ...(fixture.followUps ?? []).map((f) => f.message)]

const overlap = ([aLo, aHi], [bLo, bHi], grow) => [0, 1, 2].every((k) => aLo[k] - grow < bHi[k] + grow && bLo[k] - grow < aHi[k] + grow)

// A test for parts that float clear, not for contact: a part inside another's box joins it.
export const connectedGroups = (bodies, grow = GROW_MM) => {
  const parent = bodies.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let a = 0; a < bodies.length; a += 1) {
    for (let b = a + 1; b < bodies.length; b += 1) {
      if (overlap(bodies[a].boundingBox, bodies[b].boundingBox, grow)) parent[find(a)] = find(b)
    }
  }
  return new Set(bodies.map((_, i) => find(i))).size
}

export const harnessGates = ({ measure, solid, probe }, pieces = 1) => {
  const builds = isRecord(measure)
  const groups = builds && Array.isArray(probe?.bodies) ? connectedGroups(probe.bodies) : 0
  return [
    { name: 'builds', pass: builds },
    { name: 'watertight', pass: builds && solid?.watertight === true },
    { name: 'connected', pass: groups >= 1 && groups <= pieces, groups },
  ]
}

const gatesOf = (fixture, graded) => [
  ...harnessGates(graded, fixture.pieces ?? 1),
  ...fixture.gates(graded.measure, { solid: graded.solid, probe: graded.probe ?? null, params: graded.params ?? [] }),
]

// A grade the gates cannot read (model code can shape the one it is measured in) grades nothing.
export const complexGates = (fixture, graded) => {
  try {
    return gatesOf(fixture, graded)
  } catch {
    return gatesOf(fixture, { ...NO_GRADE(), probe: null })
  }
}

export const complexGeometry = (gates, verdict) => (verdict?.success !== true ? 0 : gates.every((g) => g.pass) ? 2 : 1)

export const settledReport = (report, gates, verdict) => {
  const unwritten = report.wrote === false
  const geometry = unwritten ? 0 : complexGeometry(gates, verdict)
  const passed = gates.filter((g) => g.pass).length + (verdict?.success === true ? 1 : 0)
  const dimensions = { ...report.dimensions, geometry }
  return {
    ...report,
    dimensions,
    total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
    checkRate: unwritten ? 0 : passed / (gates.length + 1),
  }
}

export const complexReport = (fixture, transcript, gates, { maxTurns, providerError = false } = {}) => {
  const { dimensions, firstAttemptFailures } = gradeTranscript(fixture, transcript, { maxTurns })
  const unwritten = requiresWrite(fixture) && !gradedModel(fixture, transcript)
  const report = { dimensions: { ...dimensions, geometry: 0 }, total: 0, firstAttemptFailures, checkRate: 0, ...(unwritten && !providerError ? { wrote: false } : {}) }
  return settledReport(report, gates, null)
}

// Pending while the run has renders and neither a verdict nor a graderError.
export const settleRun = (run) => {
  const { verdictPending: _was, ...rest } = run
  const pending = Boolean(rest.render) && !rest.renderError && rest.verdict == null && !rest.graderError
  return {
    ...rest,
    ...(pending ? { verdictPending: true } : {}),
    ...(rest.report ? { report: settledReport(rest.report, rest.gates ?? [], pending ? null : rest.verdict) } : {}),
  }
}

export const renderFacts = (graded) => ({
  dimensions: graded.measure.dimensions.map((d) => Math.round(d)),
  bodies: graded.probe?.bodies?.length ?? 0,
})

export const renderRecord = (graded, views) => ({ meshSha256: meshSha256(graded.mesh.parts), facts: renderFacts(graded), views })

// Gates, then three renders of a model that built, drawn by `render(parts, { fixture, run })`.
export async function scoreComplex(fixture, run, transcript, graded, { maxTurns, providerError = false, render } = {}) {
  const gates = complexGates(fixture, graded)
  const fields = { userMessages: userMessagesOf(fixture), gates, description: null, verdict: null }
  if (gates[0].pass) {
    const mesh = graded.mesh
    if (!mesh) fields.renderError = 'no mesh came back with the grade'
    else if (mesh.error) fields.renderError = mesh.error
    else if (!render) fields.renderError = 'no renderer'
    else {
      try {
        fields.render = renderRecord(graded, await render(mesh.parts, { fixture: fixture.name, run }))
      } catch (error) {
        fields.renderError = `render failed: ${error.message}`
      }
    }
  }
  const { report, ...settled } = settleRun({ report: complexReport(fixture, transcript, gates, { maxTurns, providerError }), ...fields })
  return { report, fields: settled, geometryError: geometryError(fixture.target, graded.measure) }
}
```

- [ ] **Step 5: Summarize complex runs**

In `packages/agent-loop/eval/report.js`, replace

```js
export function summarize(results) {
```

with

```js
// Runs whose geometry is not settled (no verdict yet) or cannot be (no renders, a split judge).
const unsettled = (r) => r.verdictPending === true || typeof r.renderError === 'string' || r.graderError === true

export function summarize(results) {
```

Replace

```js
    const scored = runs.filter((r) => !r.providerError && !r.infraError)
    return {
      fixture,
      runs: runs.length,
      firstAttemptFailures: meanOf(scored, (r) => r.report.firstAttemptFailures),
      checkPassRate: meanOf(scored, (r) => r.report.checkRate),
      total: meanOf(scored, (r) => r.report.total),
```

with

```js
    const scored = runs.filter((r) => !r.providerError && !r.infraError)
    const settled = scored.filter((r) => !unsettled(r))
    const complex = runs.some((r) => Array.isArray(r.gates))
    return {
      fixture,
      runs: runs.length,
      firstAttemptFailures: meanOf(scored, (r) => r.report.firstAttemptFailures),
      checkPassRate: meanOf(settled, (r) => r.report.checkRate),
      total: meanOf(settled, (r) => r.report.total),
      ...(complex
        ? { pending: runs.filter((r) => r.verdictPending === true).length, verdictRate: meanOf(settled.filter((r) => r.verdict), (r) => (r.verdict.success ? 1 : 0)) }
        : {}),
```

In `formatSummary`, replace

```js
  if (speed) lines.push('', formatSpeedLine(speed, speed.model, speed.provider))
  return lines.join('\n')
}
```

with

```js
  const complex = summary.filter((s) => 'verdictRate' in s)
  if (complex.length) {
    lines.push('', 'fixture  verdictRate  pending')
    for (const s of complex) lines.push(`${s.fixture}  ${n2or(s.verdictRate)}  ${s.pending}`)
  }
  if (speed) lines.push('', formatSpeedLine(speed, speed.model, speed.provider))
  return lines.join('\n')
}
```

In `formatComparison`, replace

```js
  // Summed over the fixtures both files scored, so an added or dropped fixture does not move it.
```

with

```js
  const judged = names.filter((name) => [a, b].some((f) => 'verdictRate' in (f.summary.find((s) => s.fixture === name) ?? {})))
  if (judged.length) {
    lines.push('', 'fixture  verdictRate a → b  pending a → b')
    for (const name of judged) {
      const sa = a.summary.find((s) => s.fixture === name)
      const sb = b.summary.find((s) => s.fixture === name)
      lines.push(`${name}  ${cell(sa, 'verdictRate')} → ${cell(sb, 'verdictRate')}  ${sa?.pending ?? '-'} → ${sb?.pending ?? '-'}`)
    }
  }
  // Summed over the fixtures both files scored, so an added or dropped fixture does not move it.
```

- [ ] **Step 6: Give a crashed complex run its gates**

In `packages/agent-loop/eval/parallel.js`, replace

```js
import { gradeFixture } from './grade.js'
```

with

```js
import { complexReport, isComplex } from './complex.js'
import { gradeFixture } from './grade.js'
```

Replace

```js
  report: gradeFixture(fixture, [], null, { params: [], solid: null }),
```

with

```js
  report: isComplex(fixture) ? complexReport(fixture, [], []) : gradeFixture(fixture, [], null, { params: [], solid: null }),
  ...(isComplex(fixture) ? { gates: [] } : {}),
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/complex.test.js eval/report.test.js eval/parallel.test.js eval/grade.test.js`
Expected: PASS.

- [ ] **Step 8: Document complex fixtures**

In `packages/agent-loop/docs/user-manual.md`, insert before `### Sandbox setup`:

````markdown
### Complex fixtures

A `complex` fixture asks for a whole object ("we need a model of a toy
caboose"), which no set of checks can grade. It declares `gates` in place of
`checks`, and its geometry grade comes from a verdict: a vision model
describes renders of the result without seeing the request, and a text model
judges that description against the user's messages
([architecture.md](architecture.md#complex-grading)).

```js
export const fixture = {
  name: 'toy-caboose',
  group: 'complex',
  prompt: 'we need a model of a toy caboose',
  requires: ['write'],
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m, { solid, probe, params }) => [],
}
```

`gates` lists only what the user's messages state, a size ("my desk is 20mm
thick") or a count of separate parts, tested with a tolerance through the
probes, never something the user left open. `pieces` (default 1) is how many
separate pieces the request calls for. `followUps: [{ message }]` holds later
user messages; they have no checks of their own, and the judge reads them
all. A complex fixture is graded with the `bodies` probe added to its own
`probe`, and gets three harness gates before its own:

- `builds`: the project builds to geometry.
- `watertight`: from `solid`.
- `connected`: the probe's bodies, grouped so two bodies share a group when
  their bounding boxes, each grown by 0.5 mm on every side, overlap. It passes
  with at most `pieces` groups and reports `groups`. A roof lifted off its
  walls or wheels hanging below their axles make a second group. It tests for
  parts that float clear, not for contact: a part inside another's box joins
  it without touching it.

Geometry is 2 when the verdict is success and every gate passes, 1 when the
verdict is success and a gate fails, and 0 when the verdict is failure or the
project does not build. `checkRate` counts the gates plus the verdict as one
entry. Until the judge has run, geometry is 0 and the run carries
`verdictPending: true`. A run with `verdictPending`, a `renderError` or a
`graderError` stays out of the `total` and `checkPassRate` means; its
`firstAttemptFailures` still counts. The summary adds, per complex fixture,
`pending` (runs waiting for a verdict) and `verdictRate` (the fraction of runs
with a verdict that succeeded); `formatSummary` prints them in a
`fixture  verdictRate  pending` table and `formatComparison` compares them. A
project that does not build is not rendered, described or judged, and scores
geometry 0.
````

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/eval/complex.js packages/agent-loop/eval/complex.test.js packages/agent-loop/eval/grade.js packages/agent-loop/eval/report.js packages/agent-loop/eval/report.test.js packages/agent-loop/eval/parallel.js packages/agent-loop/docs/user-manual.md
```

```bash
git commit -m "feat(eval): gates and verdict scoring for complex fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 4: Complex runs in `run-eval`: follow-ups, renders, result files, regrading

**Files:**
- Modify: `packages/agent-loop/eval/run-eval.js`
- Modify: `packages/agent-loop/eval/grade.js` (`hitCap`, `endedWithoutReply`), `packages/agent-loop/eval/grade.test.js` (append)
- Create: `packages/agent-loop/eval/followups.test.js`
- Create: `packages/agent-loop/eval/complex-run.test.js`
- Modify: `packages/agent-loop/docs/user-manual.md`, `packages/agent-loop/docs/architecture.md` (new Eval conversations section)

**Model:** `opus` — rewrites `runConversation` and `regradeRun`, where single-shot behaviour, result files and prompt hashes must stay exactly as they are.

**Interfaces:**
- Consumes: Task 1 (`gradeProject` option `mesh`), Task 2 (`createRunRenderer`), Task 3 (everything in `eval/complex.js`, `renderRecord` for the render field).
- Produces (`eval/grade.js`): `hitCap` and `endedWithoutReply` count the assistant messages after the last user message, so a follow-up's turn reads capped or empty on its own rounds. A single-shot run's last user message is its prompt, so its grade is unchanged; a fixture that seeds a `transcript` stops counting that transcript's assistant message, which changes a grade only for a run that ended on a tool result one round short of the cap.
- Produces (`eval/run-eval.js`):
  - `fileStamp(now = new Date()) → 'YYYY-MM-DDTHHMMSSZ'`
  - `resultFileName(model, api, promptSha256, now = new Date(), suite)`; `suite === 'complex'` adds `-complex` before the hash
  - `selectFixtures(fixtures, ['all'], api)` leaves out `group: 'complex'`
  - `compareSuites(a, b) → {} | { error }`
  - `runConversation(fixture, run, { ..., render })` sends `fixture.followUps`, grades complex fixtures with `scoreComplex`
  - `runJob(job, { ..., render }, onLog)` passes `render` through
  - `saveResults(writeFile, path, { ..., suite })` writes `suite` when set
  - `export const GRADE_LIFETIME_S`, `export const requireSandbox(env)` (used by Tasks 5 and 9)
  - `--regrade` of a complex run: gates again; verdict kept while `meshSha256` matches, else `renderStale: true`, `verdictPending: true`, `regradeNote`

- [ ] **Step 1: Write the failing follow-up tests**

Create `packages/agent-loop/eval/followups.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { runSuite } from './run-eval.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const TALL = CUBE.replace('jf.cube({ size: 20 })', 'jf.cuboid({ size: [20, 20, 40] })')
const write = (id, content) => ({ type: 'tool_use', id, name: 'write', input: { path: 'main.js', content } })
const done = (stopReason) => ({ type: 'done', stopReason })

// Records a copy of what each call sent: runTurn keeps appending to the array it passes.
const recording = (rounds) => {
  const seen = []
  return {
    seen,
    async *send(messages) {
      seen.push([...messages])
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

const fixture = {
  name: 'two-turns',
  prompt: 'a cube',
  followUps: [{ message: 'make it taller' }],
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => [{ name: 'tall', pass: (m?.dimensions?.[2] ?? 0) >= 40 }],
}

describe('follow-ups', () => {
  it('sends each follow-up after the turn before it, with the earlier turns as text', async () => {
    const provider = recording([
      [{ type: 'text', text: 'Here is a cube.' }, write('t1', CUBE), done('tool_use')],
      [{ type: 'text', text: ' Saved.' }, done('end_turn')],
      [write('t2', TALL), done('tool_use')],
      [{ type: 'text', text: 'Taller now.' }, done('end_turn')],
    ])
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    const second = provider.seen[2]
    expect(second.slice(1, 3)).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Here is a cube. Saved.' },
    ])
    expect(second.at(-2).content).toContain('jf.cube({ size: 20 })')
    expect(second.at(-2).content).toContain('Last build of the project')
    expect(second.at(-1)).toEqual({ role: 'user', content: 'make it taller' })
    expect(result.error).toBeUndefined()
    expect(result.report.checkRate).toBe(1)
    expect(result.metrics.rounds).toBe(4)
    expect(result.transcript.filter((m) => m.role === 'user' && ['a cube', 'make it taller'].includes(m.content))).toHaveLength(2)
  })

  it('gives each user message its own turn cap', async () => {
    const provider = recording([[write('t1', CUBE), done('tool_use')], [write('t2', TALL), done('tool_use')]])
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend(), maxTurns: 1 })
    expect(provider.seen).toHaveLength(2)
    expect(provider.seen[1].at(-1)).toEqual({ role: 'user', content: 'make it taller' })
    expect(result.error).toBeUndefined()
    expect(result.report.checkRate).toBe(1)
  })

  it('sends no follow-up after a turn that failed', async () => {
    const seen = []
    const provider = {
      async *send(messages) {
        seen.push([...messages])
        if (seen.length > 0) throw new Error('status 500')
        yield done('end_turn')
      },
    }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(seen).toHaveLength(1)
    expect(result.error).toBe('status 500')
    expect(result.providerError).toBe(true)
  })
})
```

Append to the end of `packages/agent-loop/eval/grade.test.js` (`toolMsg`, `resultMsg`, `fixture`, `endedWithoutReply` and `gradeFixture` are in scope):

```js
describe('the turn cap with a follow-up', () => {
  const boom = JSON.stringify({ ok: false, error: { message: 'boom' } })
  const firstTurn = [
    { role: 'user', content: 'make it' },
    toolMsg('t1', 'writeModel', { source: 'x' }),
    resultMsg('t1', JSON.stringify({ ok: true, entry: 'main.js' })),
    { role: 'assistant', content: 'done', toolCalls: [] },
    { role: 'user', content: 'make it taller' },
  ]

  it('counts only the rounds after the last user message', () => {
    const stopped = [...firstTurn, toolMsg('t2', 'eval', { source: 'y' }), resultMsg('t2', boom)]
    expect(endedWithoutReply(stopped, 2)).toBe(true)
    expect(gradeFixture(fixture, stopped, { volume: 6400 }, {}, { maxTurns: 2 }).dimensions.recovery).toBe(0)
    const capped = [...firstTurn, toolMsg('t2', 'eval', { source: 'y' }), resultMsg('t2', JSON.stringify({ ok: true })), toolMsg('t3', 'eval', { source: 'z' }), resultMsg('t3', boom)]
    expect(endedWithoutReply(capped, 2)).toBe(false)
    expect(gradeFixture(fixture, capped, { volume: 6400 }, {}, { maxTurns: 2 }).dimensions.recovery).toBe(2)
  })
})
```

- [ ] **Step 2: Write the failing complex-run tests**

Create `packages/agent-loop/eval/complex-run.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { settleRun } from './complex.js'
import { compareSuites, regradeResults, resultFileName, runSuite, saveResults, selectFixtures } from './run-eval.js'
import { VIEWS } from './views.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const BROKEN = 'module.exports = { main: () => { throw new Error("nope") } }'

const fixture = {
  name: 'cube',
  group: 'complex',
  prompt: 'a cube please',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m) => [{ name: 'about 20 mm', pass: Math.abs((m?.dimensions?.[0] ?? 0) - 20) < 1 }],
}

const writes = (content) => {
  const rounds = [
    [{ type: 'tool_use', id: 't1', name: 'write', input: { path: 'main.js', content } }, { type: 'done', stopReason: 'tool_use' }],
    [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
  ]
  return {
    async *send() {
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

const fakeRender = () => {
  const calls = []
  return {
    calls,
    render: async (parts, where) => {
      calls.push({ parts, where })
      return VIEWS.map((v) => ({ name: v.name, path: `r.renders/${where.fixture}-${where.run}/${v.name}.png`, sha256: 'f'.repeat(64) }))
    },
  }
}

const judged = (run, meshSha256 = run.render.meshSha256) =>
  settleRun({
    ...run,
    render: { ...run.render, meshSha256 },
    description: { text: 'side view: a grey cube', views: [] },
    votes: [{ success: true, reason: 'a cube', ms: 1 }],
    verdict: { success: true, votes: [3, 0] },
  })

describe('a complex run', () => {
  it('stores gates, renders and a pending verdict', async () => {
    const renders = fakeRender()
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend: createEvalBackend(), render: renders.render })
    expect(result.gates).toEqual([
      { name: 'builds', pass: true },
      { name: 'watertight', pass: true },
      { name: 'connected', pass: true, groups: 1 },
      { name: 'about 20 mm', pass: true },
    ])
    expect(result.userMessages).toEqual(['a cube please'])
    expect(result.render.facts).toEqual({ dimensions: [20, 20, 20], bodies: 1 })
    expect(result.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.render.views.map((v) => v.name)).toEqual(['iso-front', 'iso-back', 'side'])
    expect(renders.calls[0].where).toEqual({ fixture: 'cube', run: 1 })
    expect(renders.calls[0].parts[0].positions.length).toBe(12 * 9)
    expect(result.verdictPending).toBe(true)
    expect(result.description).toBeNull()
    expect(result.verdict).toBeNull()
    expect(result.report.dimensions.geometry).toBe(0)
    expect(result.report.checkRate).toBeCloseTo(4 / 5)
  })

  it('renders nothing and settles at geometry 0 when the project does not build', async () => {
    const renders = fakeRender()
    const [result] = await runSuite([fixture], { provider: writes(BROKEN), backend: createEvalBackend(), render: renders.render })
    expect(result.gates[0]).toEqual({ name: 'builds', pass: false })
    expect(renders.calls).toEqual([])
    expect(result.verdictPending).toBeUndefined()
    expect(result.report.dimensions.geometry).toBe(0)
  })

  it('records a failed render as renderError', async () => {
    const render = async () => {
      throw new Error('no chromium')
    }
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend: createEvalBackend(), render })
    expect(result.renderError).toBe('render failed: no chromium')
    expect(result.verdictPending).toBeUndefined()
  })
})

describe('--regrade of a complex run', () => {
  const regrade = (run, backend) => regradeResults({ model: 'm', api: 'fluent', suite: 'complex', results: [run] }, new Map([[fixture.name, fixture]]), { grader: backend })

  it('keeps the verdict while the rebuilt mesh is the one that was judged', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const run = judged(stored)
    expect(run.report.dimensions.geometry).toBe(2)
    const {
      results: [out],
    } = await regrade(run, backend)
    expect(out.verdict).toEqual({ success: true, votes: [3, 0] })
    expect(out.votes).toHaveLength(1)
    expect(out.report.dimensions.geometry).toBe(2)
    expect(out.verdictPending).toBeUndefined()
    expect(out.regradeNote).toBeUndefined()
  })

  it('clears the verdict and marks the renders stale when the mesh changed', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const {
      results: [out],
    } = await regrade(judged(stored, '0'.repeat(64)), backend)
    expect(out.verdict).toBeNull()
    expect(out.description).toBeNull()
    expect(out).not.toHaveProperty('votes')
    expect(out.renderStale).toBe(true)
    expect(out.verdictPending).toBe(true)
    expect(out.regradeNote).toMatch(/mesh changed/)
    expect(out.render.meshSha256).toBe(stored.render.meshSha256)
    expect(out.render.views).toEqual(stored.render.views)
    expect(out.report.dimensions.geometry).toBe(0)
  })
})

describe('complex result files', () => {
  it('runs the complex group only when named', () => {
    const fixtures = [{ name: 'a' }, { name: 'c', group: 'complex', gates: () => [] }]
    expect(selectFixtures(fixtures, null).map((f) => f.name)).toEqual(['a'])
    expect(selectFixtures(fixtures, ['all']).map((f) => f.name)).toEqual(['a'])
    expect(selectFixtures(fixtures, ['complex']).map((f) => f.name)).toEqual(['c'])
  })

  it('names a complex pass apart from a single-shot one', () => {
    const now = new Date('2026-10-01T12:00:00.123Z')
    expect(resultFileName('m', 'fluent', 'abcdef1234', now)).toBe('2026-10-01T120000Z-m-fluent-abcdef12.json')
    expect(resultFileName('m', 'fluent', 'abcdef1234', now, 'complex')).toBe('2026-10-01T120000Z-m-fluent-complex-abcdef12.json')
  })

  it('writes suite only for a complex pass', () => {
    const written = []
    const write = (_path, text) => written.push(JSON.parse(text))
    const base = { model: 'm', provider: 'p', api: 'fluent', runs: 1, promptSha256: 'x', results: [] }
    saveResults(write, 'a.json', { ...base, suite: 'complex' })
    saveResults(write, 'b.json', base)
    expect(written[0].suite).toBe('complex')
    expect(written[1]).not.toHaveProperty('suite')
  })

  it('compares complex files only with the same describer and judge', () => {
    const file = { suite: 'complex', describer: { model: 'md', promptSha256: 'a' }, judge: { model: 'ds', promptSha256: 'b' } }
    expect(compareSuites({}, {})).toEqual({})
    expect(compareSuites(file, file)).toEqual({})
    expect(compareSuites(file, {}).error).toMatch(/complex result with a single-shot/)
    expect(compareSuites(file, { ...file, judge: { model: 'ds', promptSha256: 'c' } }).error).toMatch(/judge/)
    expect(compareSuites(file, { ...file, describer: { model: 'other', promptSha256: 'a' } }).error).toMatch(/describer/)
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/followups.test.js eval/complex-run.test.js eval/grade.test.js`
Expected: FAIL: the follow-up is never sent, `result.gates` is undefined, `compareSuites` is not exported, and the follow-up transcript reads as capped (`endedWithoutReply` false, recovery 2).

- [ ] **Step 4: Imports, file names, fixture selection and comparison**

In `packages/agent-loop/eval/run-eval.js`, after `import { resolveCredentials } from './credentials.js'` add:

```js
import { complexGates, complexProbe, complexReport, isComplex, renderRecord, scoreComplex, settleRun, userMessagesOf } from './complex.js'
```

Replace

```js
// Sortable UTC timestamp so two runs on the same day and prompt don't collide:
// <YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>-<sha8>.json
export const resultFileName = (model, api, promptSha256, now = new Date()) => {
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')
  return `${timestamp}-${model}-${api}-${promptSha256.slice(0, 8)}.json`
}
```

with

```js
export const fileStamp = (now = new Date()) => now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')

// Sortable UTC timestamp so two runs on the same day and prompt don't collide:
// <YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>[-complex]-<sha8>.json
export const resultFileName = (model, api, promptSha256, now = new Date(), suite) =>
  `${fileStamp(now)}-${model}-${api}${suite === 'complex' ? '-complex' : ''}-${promptSha256.slice(0, 8)}.json`
```

Replace

```js
// `only`: null runs the default suite, every ungrouped fixture and every
// fixture in DEFAULT_GROUPS; a list of fixture and/or group names runs their
// union; ['all'] runs everything. A fixture that declares an `api` runs only
// under that api.
export function selectFixtures(fixtures, only, api = DEFAULT_API) {
  const forApi = fixtures.filter((f) => !f.api || f.api === api).map((f) => fixtureForApi(f, api))
  if (!only) return forApi.filter((f) => !f.group || DEFAULT_GROUPS.has(f.group))
  if (only.includes('all')) return forApi
```

with

```js
// `only`: null runs the default suite, every ungrouped fixture and every
// fixture in DEFAULT_GROUPS; a list of fixture and/or group names runs their
// union; ['all'] runs everything but the complex group, which runs only when
// named. A fixture that declares an `api` runs only under that api.
export function selectFixtures(fixtures, only, api = DEFAULT_API) {
  const forApi = fixtures.filter((f) => !f.api || f.api === api).map((f) => fixtureForApi(f, api))
  if (!only) return forApi.filter((f) => !f.group || DEFAULT_GROUPS.has(f.group))
  if (only.includes('all')) return forApi.filter((f) => f.group !== 'complex')
```

After the `compareApis` function add:

```js
// Verdicts compare only between files that used the same describer and judge.
export const compareSuites = (a, b) => {
  const [aComplex, bComplex] = [a, b].map((f) => f.suite === 'complex')
  if (aComplex !== bComplex) return { error: 'run-eval: cannot compare a complex result with a single-shot one' }
  if (!aComplex) return {}
  for (const stage of ['describer', 'judge']) {
    if (a[stage]?.model !== b[stage]?.model || a[stage]?.promptSha256 !== b[stage]?.promptSha256) {
      return { error: `run-eval: the two complex results used a different ${stage} model or prompt; run that stage with --all on one of them first` }
    }
  }
  return {}
}
```

- [ ] **Step 5: A turn cap per user message**

In `packages/agent-loop/eval/grade.js`, replace

```js
// A run that stopped without a final reply before its turn cap: the provider
// sent nothing back. A capped run ends on a tool result after maxTurns replies.
export function endedWithoutReply(transcript, maxTurns) {
  if (transcript.length === 0 || transcript.at(-1).role === 'assistant') return false
  return transcript.filter((m) => m.role === 'assistant').length < maxTurns
}

// A run the turn cap ended: its last round's tool results got no reply.
const hitCap = (transcript, maxTurns) =>
  maxTurns !== undefined && transcript.at(-1)?.role === 'tool' && transcript.filter((m) => m.role === 'assistant').length >= maxTurns
```

with

```js
// The cap is per user message, so only the rounds after the last one count.
const lastTurnReplies = (transcript) => transcript.slice(transcript.findLastIndex((m) => m.role === 'user') + 1).filter((m) => m.role === 'assistant').length

// A run that stopped without a final reply before its turn cap: the provider
// sent nothing back. A capped run ends on a tool result after maxTurns replies.
export function endedWithoutReply(transcript, maxTurns) {
  if (transcript.length === 0 || transcript.at(-1).role === 'assistant') return false
  return lastTurnReplies(transcript) < maxTurns
}

// A run the turn cap ended: its last round's tool results got no reply.
const hitCap = (transcript, maxTurns) => maxTurns !== undefined && transcript.at(-1)?.role === 'tool' && lastTurnReplies(transcript) >= maxTurns
```

In `packages/agent-loop/eval/run-eval.js`, replace the whole `withTurnCap` definition (from the comment `// Wraps the provider for one run: caps the number of send() calls (rounds),` down to its closing `}` before `export const EMPTY_REPLY`) with:

```js
// Caps the rounds in each user turn (`startTurn()` begins the next) and keeps the run's
// rounds, usage, empty replies, stop reasons, provider failure and timing (docs/architecture.md).
const withTurnCap = (provider, maxTurns, now = () => performance.now(), onRetry) => {
  let rounds = 0
  let turnRounds = 0
  let emptyReplies = 0
  const stopReasons = []
  let providerFailed = false
  let inputTokens = null
  let outputTokens = null
  let reasoningTokens = null
  let providerSeconds = 0
  const firstTokenSeconds = []
  let providerRetries = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      turnRounds += 1
      if (turnRounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      const startedAt = now()
      let firstContentAt = null
      let replied = false
      // The caller (runTurn) calls iterator.return() right after 'done' instead of exhausting
      // the generator, without awaiting it, so bookkeeping can't wait for a trailing finally to
      // run; it finalizes on 'done' itself, before that event is yielded.
      try {
        for await (const event of provider.send(messages, tools)) {
          if (firstContentAt === null && isContentEvent(event)) firstContentAt = now()
          if (isContentEvent(event)) replied = true
          if (event.type === 'usage') {
            if (typeof event.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + event.inputTokens
            if (typeof event.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + event.outputTokens
            if (typeof event.reasoningTokens === 'number') reasoningTokens = (reasoningTokens ?? 0) + event.reasoningTokens
          }
          if (event.type === 'retry') {
            providerRetries += 1
            onRetry?.(event)
          }
          if (event.type === 'done') {
            if (!replied) emptyReplies += 1
            stopReasons.push(event.stopReason ?? null)
            const endedAt = now()
            providerSeconds += (endedAt - startedAt) / 1000
            if (firstContentAt !== null) firstTokenSeconds.push((firstContentAt - startedAt) / 1000)
          }
          yield event
        }
      } catch (error) {
        providerFailed = true
        throw error
      }
    },
    startTurn: () => {
      turnRounds = 0
    },
    rounds: () => rounds,
    capped: () => turnRounds > maxTurns,
    emptyReplies: () => emptyReplies,
    stopReasons: () => [...stopReasons],
    providerFailed: () => providerFailed,
    usage: () => ({ inputTokens, outputTokens, reasoningTokens }),
    retries: () => providerRetries,
    speed: () => ({
      providerSeconds,
      firstTokenSeconds: firstTokenSeconds.length
        ? firstTokenSeconds.reduce((a, b) => a + b, 0) / firstTokenSeconds.length
        : null,
    }),
  }
}
```

- [ ] **Step 6: Follow-ups and complex grading in `runConversation`**

Replace the whole `runConversation` function and the comment above it (from `// One conversation: a fresh backend state seeded with the fixture's files, whose` to the function's closing `}` before `export const RUN_TIMEOUT_MS`) with:

```js
// The text a turn's replies showed the user, as the app keeps it for later turns.
const replyText = (messages) =>
  messages
    .filter((m) => m.role === 'assistant' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('')

// One run: the prompt and each follow-up, then a grade of the final project in a fresh state.
// Errors land on the result, never thrown (docs/architecture.md, Eval conversations).
export async function runConversation(
  fixture,
  run,
  {
    provider,
    backend,
    api = DEFAULT_API,
    systemPrompt = buildSystemPrompt(api),
    now,
    maxTurns = fixture.maxTurns,
    toolTimeoutMs,
    gradeTimeoutMs,
    signal,
    render,
    onToolCall,
    onToolResult,
    onText,
    onProviderRetry,
  },
) {
  let error
  let infraError = false
  const noteInfra = (err) => {
    if (!err?.infrastructure) throw err
    infraError = true
    error ??= err.message
  }
  const cappedProvider = withTurnCap(provider, maxTurns, now, onProviderRetry)
  const startedAt = Date.now()
  let transcript = []
  let prior = fixture.transcript ?? []
  let files = fixture.files ?? {}
  for (const [turn, message] of userMessagesOf(fixture).entries()) {
    let build = null
    try {
      build = await backend.reset(files, { build: true })
    } catch (err) {
      noteInfra(err)
    }
    const messages = buildMessages({ systemPrompt, transcript: prior, files, build, message })
    let turnMessages = messages
    if (!infraError) {
      cappedProvider.startTurn()
      try {
        const finished = await runTurn({
          conversation: { messages },
          provider: cappedProvider,
          api,
          requestTool: async (name, input) => {
            onToolCall?.(name, input)
            const result = await backend.requestTool(name, input)
            onToolResult?.(name, result)
            return result
          },
          onText: (text) => onText?.(text),
          toolTimeoutMs,
          signal,
        })
        turnMessages = finished.messages
      } catch (err) {
        if (Array.isArray(err?.messages)) turnMessages = err.messages
        // The cap's own closing round sends nothing back, which runTurn reads as an empty reply.
        if (err?.name === 'EmptyReplyError') {
          if (!cappedProvider.capped()) error = EMPTY_REPLY
        } else {
          error = signal?.aborted && signal.reason instanceof Error ? signal.reason.message : err.message
          if (err?.infrastructure) infraError = true
        }
      }
    }
    // A later turn keeps what it added: its project note, its message and the reply.
    transcript = turn === 0 ? turnMessages : [...transcript, ...turnMessages.slice(messages.length - 2)]
    if (error || infraError) break
    const reply = replyText(turnMessages.slice(messages.length))
    prior = [...prior, { role: 'user', content: message }, ...(reply ? [{ role: 'assistant', content: reply }] : [])]
    files = gradedModel(fixture, transcript)?.files ?? files
  }
  if (!error && cappedProvider.emptyReplies() > 0) error = EMPTY_REPLY
  const providerError = cappedProvider.providerFailed() || cappedProvider.emptyReplies() > 0
  const seconds = (Date.now() - startedAt) / 1000
  const complex = isComplex(fixture)
  let graded = NO_GRADE()
  if (!infraError) {
    try {
      const options = complex ? { timeoutMs: gradeTimeoutMs, probe: complexProbe(fixture), mesh: true } : { timeoutMs: gradeTimeoutMs, probe: fixture.probe }
      graded = await backend.gradeProject(gradedModel(fixture, transcript), options)
    } catch (err) {
      noteInfra(err)
    }
  }
  const {
    report,
    fields = {},
    geometryError: geometry,
  } = complex ? await scoreComplex(fixture, run, transcript, graded, { maxTurns, providerError, render }) : scoreGrade(fixture, transcript, graded, maxTurns, providerError)
  const { toolCalls, failedCalls, warnings, docsCalls } = transcriptMetrics(transcript)
  const { inputTokens, outputTokens, reasoningTokens } = cappedProvider.usage()
  const { providerSeconds, firstTokenSeconds } = cappedProvider.speed()
  const outputTokensPerSecond =
    outputTokens != null && providerSeconds > 0 ? outputTokens / providerSeconds : null
  return {
    fixture: fixture.name,
    run,
    api,
    maxTurns,
    report,
    turns: transcript.length,
    stopReasons: cappedProvider.stopReasons(),
    transcript: transcript.filter((m) => m.role !== 'system'),
    metrics: {
      rounds: cappedProvider.rounds(),
      toolCalls,
      failedCalls,
      warnings,
      docsCalls,
      inputTokens,
      outputTokens,
      reasoningTokens,
      seconds,
      providerRetries: cappedProvider.retries(),
      providerSeconds,
      firstTokenSeconds,
      outputTokensPerSecond,
      geometryError: geometry,
    },
    ...fields,
    ...(error ? { error } : {}),
    ...(providerError ? { providerError: true } : {}),
    ...(infraError ? { infraError: true } : {}),
  }
}
```

- [ ] **Step 7: Pass `render` through `runJob`**

Replace

```js
  { provider, api, startExecutor: start, runTimeoutMs = RUN_TIMEOUT_MS, maxRestarts, callTimeoutMs, runToolTimeoutMs },
```

with

```js
  { provider, api, startExecutor: start, runTimeoutMs = RUN_TIMEOUT_MS, maxRestarts, callTimeoutMs, runToolTimeoutMs, render },
```

and in the `runConversation(fixture, run, {` call inside `runJob`, replace

```js
      toolTimeoutMs,
      signal: controller.signal,
```

with

```js
      toolTimeoutMs,
      signal: controller.signal,
      render,
```

- [ ] **Step 8: Regrade complex runs**

Replace

```js
async function regradeRun(stored, fixture, grader) {
```

with

```js
// A complex run's gates again, and its verdict kept only while its mesh is the one that was judged.
async function regradeComplex(run, fixture, grader, { transcript, maxTurns, providerError, metrics }) {
  const graded = await grader.gradeProject(gradedModel(fixture, transcript), { probe: complexProbe(fixture), mesh: true })
  const gates = complexGates(fixture, graded)
  const report = complexReport(fixture, transcript, gates, { maxTurns, providerError })
  const { description, votes, verdict, graderError, describeError, render, renderError: _error, renderStale: _stale, ...kept } = run
  const base = { ...kept, gates, report, metrics: { ...metrics, geometryError: geometryError(fixture.target, graded.measure) } }
  const cleared = { ...base, description: null, verdict: null }
  if (!gates[0].pass) return settleRun(render ? { ...cleared, regradeNote: 'the project no longer builds' } : cleared)
  if (!graded.mesh || graded.mesh.error) return settleRun({ ...cleared, renderError: graded.mesh?.error ?? 'no mesh came back with the grade' })
  let fresh
  try {
    fresh = renderRecord(graded, render?.views ?? [])
  } catch {
    return settleRun({ ...cleared, renderError: 'the grade could not be read' })
  }
  if (render && fresh.meshSha256 === render.meshSha256) {
    return settleRun({
      ...base,
      render,
      description: description ?? null,
      ...(votes ? { votes } : {}),
      verdict: verdict ?? null,
      ...(graderError ? { graderError } : {}),
      ...(describeError ? { describeError } : {}),
    })
  }
  return settleRun({
    ...cleared,
    render: fresh,
    renderStale: true,
    regradeNote: 'the mesh changed; its renders and verdict are stale',
  })
}

async function regradeRun(stored, fixture, grader) {
```

Inside `regradeRun`, replace

```js
  const samePrompt = promptOf(fixture, transcript)
  let report
```

with

```js
  const samePrompt = promptOf(fixture, transcript)
  if (isComplex(fixture) && (samePrompt || !model)) {
    const regraded = await regradeComplex(rest, fixture, grader, { transcript, maxTurns, providerError, metrics })
    const empty = !result.error && endedWithoutReply(transcript, maxTurns)
    return {
      ...regraded,
      ...(samePrompt ? {} : { regradeNote: 'prompt differs from the current fixture; graded as unsaved' }),
      ...(empty ? { error: EMPTY_REPLY } : {}),
      ...(empty || result.error === EMPTY_REPLY ? { providerError: true } : {}),
    }
  }
  let report
```

- [ ] **Step 9: Result files, exports and the CLI**

Replace

```js
export function saveResults(writeFile, filePath, { model, provider, api, runs, maxTurns = null, promptSha256, results, wallSeconds }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  if (typeof wallSeconds === 'number') speed.wallSeconds = wallSeconds
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, api, runs, maxTurns, promptSha256, date: new Date().toISOString(), summary, speed, results },
```

with

```js
export function saveResults(writeFile, filePath, { model, provider, api, runs, maxTurns = null, promptSha256, suite, results, wallSeconds }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  if (typeof wallSeconds === 'number') speed.wallSeconds = wallSeconds
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, api, runs, maxTurns, promptSha256, ...(suite ? { suite } : {}), date: new Date().toISOString(), summary, speed, results },
```

Replace `const GRADE_LIFETIME_S = GRADE_TIMEOUT_MS / 1000 + 60` with `export const GRADE_LIFETIME_S = GRADE_TIMEOUT_MS / 1000 + 60`.

Replace `const requireSandbox = async (env) => {` with `export const requireSandbox = async (env) => {`.

After the `requireSandbox` function add:

```js
// Chromium starts before any provider call, so a host without it fails first.
const startRenders = async (filePath) => {
  const { createRunRenderer } = await import('./render.js')
  const renders = createRunRenderer(filePath)
  try {
    await renders.start()
  } catch (error) {
    console.error(`run-eval: chromium did not start for the renders (npx playwright install chromium): ${error.message}`)
    process.exit(1)
  }
  return renders
}
```

In `main`, replace

```js
    const { error, warning } = compareApis(a, b)
    if (error) {
      console.error(error)
      process.exit(1)
    }
```

with

```js
    const { error, warning } = compareApis(a, b)
    const suites = compareSuites(a, b)
    if (error || suites.error) {
      console.error(error ?? suites.error)
      process.exit(1)
    }
```

Replace

```js
  const fixtures = selectFixtures(await loadFixtures(), only, api)
```

with

```js
  const fixtures = selectFixtures(await loadFixtures(), only, api)
  const complexPass = fixtures.some(isComplex)
  if (complexPass && !fixtures.every(isComplex)) {
    console.error('run-eval: complex fixtures run in a pass of their own; set EVAL_FIXTURES=complex')
    process.exit(1)
  }
```

Replace

```js
  mkdirSync(resultsDir, { recursive: true })
  const filePath = join(resultsDir, resultFileName(EVAL_MODEL, api, promptSha256))
```

with

```js
  mkdirSync(resultsDir, { recursive: true })
  const suite = complexPass ? 'complex' : undefined
  const filePath = join(resultsDir, resultFileName(EVAL_MODEL, api, promptSha256, new Date(), suite))
  const renders = complexPass ? await startRenders(filePath) : null
```

In the `save` closure, replace

```js
      promptSha256,
      results,
      wallSeconds: (Date.now() - startedAt) / 1000,
```

with

```js
      promptSha256,
      suite,
      results,
      wallSeconds: (Date.now() - startedAt) / 1000,
```

Replace

```js
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}`
```

with

```js
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}${result.verdictPending ? '  verdict pending' : ''}`
```

Replace

```js
      { provider: createProvider(providerConfig), api, runTimeoutMs, startExecutor: () => startExecutor({ api, sandbox, lifetimeS: conversationLifetimeS(runTimeoutMs) }) },
```

with

```js
      { provider: createProvider(providerConfig), api, runTimeoutMs, startExecutor: () => startExecutor({ api, sandbox, lifetimeS: conversationLifetimeS(runTimeoutMs) }), render: renders?.render },
```

Replace

```js
  const results = await runSuiteParallel(fixtures, { runs, concurrency, maxTurns, api, runJob: runSandboxedJob, onLog, onRun })
```

with

```js
  const results = await runSuiteParallel(fixtures, { runs, concurrency, maxTurns, api, runJob: runSandboxedJob, onLog, onRun })
  await renders?.close()
```

- [ ] **Step 10: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/followups.test.js eval/complex-run.test.js eval/grade.test.js`
Expected: PASS.

Run: `npx vitest run --root packages/agent-loop`
Expected: PASS, every existing test unchanged (single-shot runs, result files, prompt hashes and the existing `endedWithoutReply` and capped-recovery tests behave as before).

- [ ] **Step 11: Document follow-ups, the complex pass and complex regrading**

In `packages/agent-loop/docs/user-manual.md`:

In `### Choosing fixtures and API style`, replace

```markdown
fixture plus one grouped fixture, and `EVAL_FIXTURES=all` runs every fixture
regardless of group.
```

with

```markdown
fixture plus one grouped fixture, and `EVAL_FIXTURES=all` runs every fixture
regardless of group except `complex`, which runs only when named, in a pass of
its own ([Complex fixtures](#complex-fixtures)).
```

In `### Regrading`, after the paragraph ending `without spending API budget.`, add:

```markdown
A complex run is rebuilt with the `bodies` probe and its mesh: the gates are
recomputed and the mesh hashed. When the hash matches `render.meshSha256`, the
stored verdict stands and geometry is recomputed from it and the new gates.
When it differs, the description, votes and verdict are cleared and the run
gets `renderStale: true`, `verdictPending: true` and a `regradeNote`; a project
that no longer builds loses them too and scores geometry 0. `--regrade` makes
no provider call, starts no describer and renders nothing.
```

In `### Result files`, after the paragraph ending `The key is never printed or written.`, add:

```markdown
A complex pass's file is `<YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>-complex-<sha8>.json`
and records `suite: 'complex'`. `--compare` refuses a complex file against a
single-shot one, and two complex files whose describer or judge model or
prompt hash differ.
```

In `### Fixtures`, replace

```markdown
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid, probe }), api?, transcript?, files?, apiFiles?, target?, probe? }`.
```

with

```markdown
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid, probe }), api?, transcript?, files?, apiFiles?, target?, probe?, followUps? }`.
```

and insert before the paragraph starting ``probe` asks the grader for facts `measure` does not give (`eval/probe.js`),``:

```markdown
`followUps: [{ message }]` sends later user messages in order, each after the
turn before it ends, whatever that turn built, through `buildMessages` as the
app sends a later message: the earlier messages and the text of each reply
(tool calls left out), then the project's files and its build, after the
backend is reset to the project as it stands and built. The turn cap applies
to each message, and grading reads it that way: whether a run was capped or
ended without a reply counts only the rounds after the last user message. An
error (provider, empty reply, run time limit, sandbox)
ends the conversation, and no later follow-up is sent. The stored `transcript`
keeps the first turn whole and, for each later turn, its project note, its
message and its reply, so the grade replays every write and edit in order.
```

In `### Complex fixtures`, after its last paragraph (ending `described or judged, and scores\ngeometry 0.`), add:

```markdown
A complex pass runs with `EVAL_FIXTURES=complex` (or complex fixture names)
and nothing else: a selection that mixes complex and other fixtures exits
with an error. It starts Playwright's chromium before any provider call
(`npx playwright install chromium` in `apps/jscad-web` installs it). After
each run's grade, the grade executor sends the model's mesh and `run-eval`
renders three views into `<file stem>.renders/<fixture>-<run>/` beside the
result file. Each complex run adds:

- `userMessages`: the prompt and each follow-up, what the judge reads.
- `gates`: `[{ name, pass }]`, with `groups` on `connected`.
- `render`: `{ meshSha256, facts: { dimensions, bodies }, views: [{ name, path, sha256 }] }`,
  each `path` relative to the result file's directory; or `renderError` when
  the mesh was refused or the render failed.
- `description: null` and `verdict: null`, filled in by the describe and
  judge stages.
```

In `packages/agent-loop/docs/architecture.md`, insert before `## Complex grading`:

```markdown
## Eval conversations

`runConversation` (`eval/run-eval.js`) runs one fixture run: a fresh backend
state seeded with the fixture's files, whose build report joins the files in
the first message, the prompt, then each of the fixture's `followUps` in
order, then a grade of the project's final state, built again in a fresh state
so no scratch `run` leaks into the grade. A follow-up goes through
`buildMessages` as the app sends one: the earlier turns as text, then the
project as it stands, built. An error lands on the result, never thrown, and
ends the conversation. `providerError` marks one the provider caused, judged
only by the provider wrapper, never by what a tool returned; `infraError` one
the sandbox caused (a backend error with `infrastructure`). Both leave the run
out of the means. A complex fixture is graded by its gates, and a model that
builds is drawn by the lane's renderer ([Complex grading](#complex-grading)).

The provider wrapper (`withTurnCap`) caps the rounds in each user turn,
tallies usage events, counts calls that sent neither text nor a tool call
(reasoning and usage alone are no reply), records each call's stop reason,
notes whether the provider itself threw, and times each call against an
injected clock, so the run's rounds, usage and speed are read once it ends.
`hitCap` and `endedWithoutReply` in `eval/grade.js` count only the assistant
messages after the last user message, so a follow-up's turn reads as capped
or empty on its own rounds.
```

- [ ] **Step 12: Commit**

```bash
git add packages/agent-loop/eval/run-eval.js packages/agent-loop/eval/grade.js packages/agent-loop/eval/grade.test.js packages/agent-loop/eval/followups.test.js packages/agent-loop/eval/complex-run.test.js packages/agent-loop/docs/user-manual.md packages/agent-loop/docs/architecture.md
```

```bash
git commit -m "feat(eval): follow-ups, complex runs with renders, and complex regrading

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 5: Grader-validation cases and `grader-validate` (render stage)

**Files:**
- Create: `packages/agent-loop/eval/grader-validation/cases.js`
- Create: `packages/agent-loop/eval/grader-validation/cases.test.js`
- Create: `packages/agent-loop/eval/grader-validate.js`
- Create: `packages/agent-loop/eval/grader-validate.test.js`
- Create: `ci/grader-validate` (mode 755)
- Modify: `packages/agent-loop/package.json` (scripts)
- Modify: `packages/agent-loop/docs/user-manual.md`, `ci/README.md`

**Model:** `sonnet` — transcription of the trial sources plus a small CLI.

**Interfaces:**
- Consumes: `gradeInFreshExecutor` (Task 1), `createRunRenderer` (Task 2), `harnessGates`, `renderRecord`, `settleRun` (Task 3), `fileStamp`, `GRADE_LIFETIME_S`, `requireSandbox` (Task 4), `startExecutor` (`eval/sandbox.js`).
- Produces:
  - `cases.js`: `CASES: [{ name, messages: string[], expected: 'pass'|'fail'|'gate'|'known-miss', source?: string, files?: object, entry?: string, api?: string, pieces?: number }]`, `patched(source, [[from, to], ...]) → string`, `CABOOSE_MESSAGE`. The five trial cases come first; approved answers (Task 11) are model-written code, so `cases.test.js` builds only the trial cases in-process and `grader-validate` builds every case in the crt sandbox.
  - `grader-validate.js`: `validationRun(case, graded, render) → Promise<run>`, `expectedMatch(run) → boolean|null`, `formatValidation(runs, { judged }) → string`, `STAGES` (this task: `['render']`; Task 7 adds `'describe'`, Task 8 `'judge'`). A validation file is `{ suite: 'complex', validation: true, date, results }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-loop/eval/grader-validation/cases.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from '../backend.js'
import { harnessGates, renderFacts } from '../complex.js'
import { CABOOSE_MESSAGE, CASES, patched } from './cases.js'

const backend = createEvalBackend({ api: 'fluent' })
const grade = (c) => backend.gradeProject({ files: { 'main.js': c.source }, entry: 'main.js' }, { probe: { bodies: {} } })

// The trial's sizes and part counts, so a patch that drifts shows (optional reference: the trial's run_nearmiss.py, not in the repo).
const TRIAL = {
  caboose: { dimensions: [111, 41, 67], bodies: 62, connected: true },
  'delivery-truck': { dimensions: [116, 46, 50], bodies: 18, connected: true },
  'plain-box': { dimensions: [84, 41, 46], bodies: 12, connected: true },
  exploded: { dimensions: [111, 71, 117], bodies: 62, connected: false },
  'no-roof': { dimensions: [111, 41, 62], bodies: 58, connected: true },
}
// Approved answers (Task 11) are model-written code: only grader-validate builds them, in the sandbox.
const TRIAL_CASES = CASES.filter((c) => c.name in TRIAL)

describe('grader-validation cases', () => {
  it('scores four trial cases and records the known miss', () => {
    expect(TRIAL_CASES.map((c) => [c.name, c.expected])).toEqual([
      ['caboose', 'pass'],
      ['delivery-truck', 'fail'],
      ['plain-box', 'fail'],
      ['exploded', 'gate'],
      ['no-roof', 'known-miss'],
    ])
    for (const c of TRIAL_CASES) expect(c.messages).toEqual([CABOOSE_MESSAGE])
  })

  for (const c of TRIAL_CASES) {
    it(`${c.name} builds as the trial's model did`, async () => {
      const graded = await grade(c)
      const gates = harnessGates(graded)
      expect(gates[0].pass).toBe(true)
      expect(renderFacts(graded)).toEqual({ dimensions: TRIAL[c.name].dimensions, bodies: TRIAL[c.name].bodies })
      expect(gates[2].pass).toBe(TRIAL[c.name].connected)
    }, 30_000)
  }

  it('refuses a patch whose text is missing', () => {
    expect(() => patched('abc', [['xyz', 'q']])).toThrow(/no "xyz"/)
  })
})
```

Create `packages/agent-loop/eval/grader-validate.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { NO_GRADE } from './executor-protocol.js'
import { expectedMatch, formatValidation, validationRun } from './grader-validate.js'
import { VIEWS } from './views.js'

const unit = { boundingBox: [[0, 0, 0], [1, 1, 1]] }
const graded = (bodies = [unit]) => ({
  measure: { dimensions: [111, 41, 67] },
  solid: { watertight: true },
  params: [],
  probe: { bodies },
  mesh: { parts: [{ color: null, positions: new Float32Array(9) }] },
})
const render = async (_parts, { fixture, run }) => VIEWS.map((v) => ({ name: v.name, path: `v.renders/${fixture}-${run}/${v.name}.png`, sha256: 'a'.repeat(64) }))
const kase = (name, expected) => ({ name, messages: ['we need a model of a toy caboose'], expected })

describe('validationRun', () => {
  it('holds gates, renders and a pending verdict', async () => {
    const run = await validationRun(kase('caboose', 'pass'), graded(), render)
    expect(run).toMatchObject({ fixture: 'caboose', run: 1, expected: 'pass', userMessages: ['we need a model of a toy caboose'], description: null, verdict: null, verdictPending: true })
    expect(run.gates.map((g) => g.pass)).toEqual([true, true, true])
    expect(run.render.facts).toEqual({ dimensions: [111, 41, 67], bodies: 1 })
    expect(run.render.views).toHaveLength(3)
  })

  it('records a case that did not build', async () => {
    const run = await validationRun(kase('broken', 'fail'), NO_GRADE(), render)
    expect(run.renderError).toBe('the case did not build')
    expect(run.verdictPending).toBeUndefined()
  })
})

describe('expectedMatch', () => {
  const connected = (pass) => [{ name: 'connected', pass }]
  it('reads pass and fail from the verdict, gate from connected, and scores no known miss', () => {
    expect(expectedMatch({ expected: 'pass', gates: connected(true), verdict: { success: true } })).toBe(true)
    expect(expectedMatch({ expected: 'pass', gates: connected(true), verdict: null })).toBe(false)
    expect(expectedMatch({ expected: 'fail', gates: connected(true), verdict: { success: false } })).toBe(true)
    expect(expectedMatch({ expected: 'fail', gates: connected(true), verdict: { success: true } })).toBe(false)
    expect(expectedMatch({ expected: 'gate', gates: connected(false), verdict: { success: true } })).toBe(true)
    expect(expectedMatch({ expected: 'gate', gates: connected(true), verdict: null })).toBe(false)
    expect(expectedMatch({ expected: 'known-miss', gates: connected(true), verdict: { success: true } })).toBeNull()
  })
})

describe('formatValidation', () => {
  it('prints one line per case, and the render directory until there is a description', async () => {
    const runs = [await validationRun(kase('caboose', 'pass'), graded(), render), await validationRun(kase('exploded', 'gate'), graded([unit, { boundingBox: [[9, 9, 9], [10, 10, 10]] }]), render)]
    const text = formatValidation(runs, { judged: false })
    expect(text).toContain('caboose  pass  -  -  -  -')
    expect(text).toContain('exploded  gate  connected  -  -  yes')
    expect(text).toContain('caboose: v.renders/caboose-1')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/grader-validation/cases.test.js eval/grader-validate.test.js`
Expected: FAIL, `cases.js` and `grader-validate.js` cannot be resolved.

- [ ] **Step 3: Write `eval/grader-validation/cases.js`**

The caboose is the chat-built one from chat 554c84a4, verbatim; `no-roof` and `exploded` are the trial's edits of it, applied as exact-text patches.

````js
// Known answers for the describer and judge (npm run grader-validate; `expected` is
// explained in docs/user-manual.md, Grader validation).

export const CABOOSE_MESSAGE = 'we need a model of a toy caboose'

// The toy caboose a chat built (chat 554c84a4): 111 x 41 x 67 mm, 62 parts.
const CABOOSE = `// Toy caboose model in millimetres.
const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params._type = 'Toy Caboose'
  params.length = { type: 'slider', default: 80, min: 60, max: 120, step: 5, label: 'Body length' }
  params.width = { type: 'slider', default: 30, min: 24, max: 40, step: 1, label: 'Body width' }
  params.wheelRadius = { type: 'slider', default: 9, min: 6, max: 12, step: 0.5, label: 'Wheel radius' }

  const num = (v, fb) => (typeof v === 'number' ? v : fb)
  const L = num(params.length, 80)
  const W = num(params.width, 30)
  const WR = num(params.wheelRadius, 9)

  const bodyH = 28
  const chassisH = 5
  const chassisBottom = WR * 2 - 5 // tuck chassis just above wheel centers
  const chassisTop = chassisBottom + chassisH
  const bodyBottom = chassisTop
  const bodyTop = bodyBottom + bodyH
  const bodyCenterZ = bodyBottom + bodyH / 2

  const wheelThick = 6
  const wheelY = W / 2 + 1.5
  const wheelX = L * 0.325
  const wheelZ = WR

  // Colors
  const red = [0.78, 0.14, 0.13]
  const darkRed = [0.6, 0.1, 0.1]
  const roofGrey = [0.28, 0.28, 0.32]
  const chassisBlack = [0.16, 0.16, 0.17]
  const wheelBlack = [0.1, 0.1, 0.11]
  const hubRed = [0.78, 0.14, 0.13]
  const windowBlue = [0.55, 0.82, 0.92]
  const windowFrame = [0.95, 0.92, 0.82]
  const woodBrown = [0.45, 0.3, 0.18]

  // Chassis / frame
  const chassis = jf.cuboid({ size: [L + 4, W + 2, chassisH], center: [0, 0, chassisBottom + chassisH / 2] })
    .colorize(chassisBlack)

  // End beams (buffer beams)
  const beamT = 4
  const beamL = jf.cuboid({ size: [beamT, W + 2, 8], center: [0, 0, 0] })
  const beamFront = beamL.translate([L / 2 + 1, 0, chassisBottom + 3]).colorize(darkRed)
  const beamBack = beamL.translate([-L / 2 - 1, 0, chassisBottom + 3]).colorize(darkRed)

  // Main cabin body
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)

  // Side skirts below body (short apron)
  const skirt = jf.cuboid({ size: [L - 10, W - 4, 4], center: [0, 0, bodyBottom - 1] })
    .colorize(darkRed)

  // Roof - slightly overhanging slab with rounded edge feel (two stacked slabs)
  const roofLower = jf.cuboid({ size: [L + 8, W + 6, 3], center: [0, 0, bodyTop + 1.5] })
    .colorize(roofGrey)
  const roofUpper = jf.cuboid({ size: [L + 4, W + 2, 2.5], center: [0, 0, bodyTop + 3 + 1.25] })
    .colorize(roofGrey)

  // Cupola (lookout cabin on top, centered)
  const cupLen = 30
  const cupWid = W * 0.72
  const cupH = 13
  const cupBottom = bodyTop + 3 // sits into roof
  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupH], center: [0, 0, cupBottom + cupH / 2] })
    .colorize(red)
  const cupRoof = jf.cuboid({ size: [cupLen + 6, cupWid + 6, 3], center: [0, 0, cupBottom + cupH + 1.5] })
    .colorize(roofGrey)
  const cupRoofTop = jf.cuboid({ size: [cupLen, cupWid, 2], center: [0, 0, cupBottom + cupH + 3 + 1] })
    .colorize(roofGrey)

  // Stove pipe chimney near one end of roof
  const chimR = 2.8
  const chimH = 10
  const chimX = -L / 2 + 14
  const chimney = jf.cylinder({ radius: chimR, height: chimH, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH / 2 - 1])
    .colorize(chassisBlack)
  const chimneyCap = jf.cylinder({ radius: chimR + 1.4, height: 2, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH])
    .colorize(chassisBlack)

  // Wheels + axles + hubs
  const wheelProto = jf.cylinder({ radius: WR, height: wheelThick, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 2.6, height: wheelThick + 2, segments: 16 }).rotateX(Math.PI / 2)
  const axleProto = jf.cylinder({ radius: 2.2, height: W + 4, segments: 16 }).rotateX(Math.PI / 2)

  const wheelPos = [
    [wheelX, wheelY], [wheelX, -wheelY],
    [-wheelX, wheelY], [-wheelX, -wheelY]
  ]
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, wheelZ]).colorize(wheelBlack))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, wheelZ]).colorize(hubRed))
  const axles = [wheelX, -wheelX].map((x) => axleProto.translate([x, 0, wheelZ]).colorize(chassisBlack))

  // Side windows: cream frames + blue glass, applied on both flanks
  const winW = 11
  const winH = 10
  const winZ = bodyCenterZ + 4
  const winXpos = [-L / 2 + 13, -L / 2 + 28, L / 2 - 28, L / 2 - 13]
  const sideWindows = []
  winXpos.forEach((x) => {
    [1, -1].forEach((s) => {
      const y = s * (W / 2)
      const frame = jf.cuboid({ size: [winW + 2, 1.2, winH + 2], center: [0, 0, 0] })
        .translate([x, y + s * 0.3, winZ])
        .colorize(windowFrame)
      const glass = jf.cuboid({ size: [winW, 1.4, winH], center: [0, 0, 0] })
        .translate([x, y + s * 0.4, winZ])
        .colorize(windowBlue)
      sideWindows.push(frame, glass)
    })
  })

  // Sliding side doors in middle of each flank (brown with frame)
  const doorW = 14
  const doorH = 20
  const doorZ = bodyCenterZ - 2
  const doors = [1, -1].map((s) => {
    const y = s * (W / 2)
    const frame = jf.cuboid({ size: [doorW + 2, 1.2, doorH + 2] })
      .translate([0, y + s * 0.3, doorZ])
      .colorize(windowFrame)
    const panel = jf.cuboid({ size: [doorW, 1.4, doorH] })
      .translate([0, y + s * 0.4, doorZ])
      .colorize(woodBrown)
    return [frame, panel]
  }).flat()

  // End doors / windows on front & back faces
  const endGlass = [1, -1].map((s) => {
    const x = s * (L / 2)
    const frame = jf.cuboid({ size: [1.2, 10, 12] })
      .translate([x + s * 0.3, 0, winZ])
      .colorize(windowFrame)
    const glass = jf.cuboid({ size: [1.4, 8, 10] })
      .translate([x + s * 0.4, 0, winZ])
      .colorize(windowBlue)
    return [frame, glass]
  }).flat()

  // Cupola side windows (lookout windows)
  const cupWinZ = cupBottom + cupH / 2 + 1
  const cupWindows = []
  ;[-8, 8].forEach((x) => {
    [1, -1].forEach((s) => {
      const glass = jf.cuboid({ size: [8, 1.4, 6] })
        .translate([x, s * (cupWid / 2 + 0.3), cupWinZ])
        .colorize(windowBlue)
      cupWindows.push(glass)
    })
  })
  ;[1, -1].forEach((s) => {
    const glass = jf.cuboid({ size: [1.4, 12, 6] })
      .translate([s * (cupLen / 2 + 0.3), 0, cupWinZ])
      .colorize(windowBlue)
    cupWindows.push(glass)
  })

  // Couplers front & back (toy knuckle hint: shank + head)
  const coupler = (s) => {
    const shank = jf.cuboid({ size: [10, 6, 4], center: [0, 0, 0] })
      .translate([s * (L / 2 + 7), 0, chassisBottom + 2])
      .colorize(chassisBlack)
    const head = jf.cuboid({ size: [5, 10, 7], center: [0, 0, 0] })
      .translate([s * (L / 2 + 13), 0, chassisBottom + 2])
      .colorize(chassisBlack)
    return [shank, head]
  }

  // Rear ladder (two rails + 3 rungs) on back face
  const ladderX = -L / 2 - 0.8
  const railProto = jf.cuboid({ size: [1.2, 1.2, bodyH - 2] })
  const railL = railProto.translate([ladderX, 6, bodyCenterZ]).colorize(windowFrame)
  const railR = railProto.translate([ladderX, -6, bodyCenterZ]).colorize(windowFrame)
  const rungs = [-8, -2, 4, 10].map((dz) =>
    jf.cuboid({ size: [1.2, 13.2, 1.2] }).translate([ladderX, 0, bodyCenterZ + dz]).colorize(chassisBlack)
  )

  return [
    chassis, beamFront, beamBack, body, skirt,
    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,
    chimney, chimneyCap,
    ...axles, ...wheels, ...hubs,
    ...sideWindows, ...doors, ...endGlass, ...cupWindows,
    ...coupler(1), ...coupler(-1),
    railL, railR, ...rungs
  ]
}

module.exports = { main }
`

// Negative control: a simple toy delivery truck, about the caboose's size.
const DELIVERY_TRUCK = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const blue = [0.15, 0.35, 0.75]
  const white = [0.92, 0.92, 0.9]
  const black = [0.1, 0.1, 0.11]
  const grey = [0.6, 0.6, 0.62]
  const glass = [0.55, 0.82, 0.92]
  const WR = 9
  const W = 36

  const chassis = jf.cuboid({ size: [106, W - 4, 5], center: [0, 0, WR + 2] }).colorize(black)
  const cargo = jf.cuboid({ size: [66, W, 36], center: [-18, 0, WR + 4.5 + 18] }).colorize(white)
  const cab = jf.cuboid({ size: [30, W, 26], center: [35, 0, WR + 4.5 + 13] }).colorize(blue)
  const hood = jf.cuboid({ size: [10, W - 2, 14], center: [55, 0, WR + 4.5 + 7] }).colorize(blue)
  const windshield = jf.cuboid({ size: [1.4, W - 8, 10], center: [50.4, 0, WR + 4.5 + 19] }).colorize(glass)
  const sideWindows = [1, -1].map((s) => jf.cuboid({ size: [14, 1.4, 9], center: [38, s * (W / 2 + 0.3), WR + 4.5 + 19] }).colorize(glass))
  const bumper = jf.cuboid({ size: [3, W + 2, 5], center: [61, 0, WR + 3] }).colorize(grey)
  const lights = [1, -1].map((s) => jf.cuboid({ size: [1.4, 5, 3], center: [60.4, s * 12, WR + 9] }).colorize([0.95, 0.85, 0.3]))
  const wheelProto = jf.cylinder({ radius: WR, height: 7, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 3.5, height: 8, segments: 16 }).rotateX(Math.PI / 2)
  const wheelPos = [38, -30].flatMap((x) => [1, -1].map((s) => [x, s * (W / 2 + 1)]))
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, WR]).colorize(black))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, WR]).colorize(grey))

  return [chassis, cargo, cab, hood, windshield, ...sideWindows, bumper, ...lights, ...wheels, ...hubs]
}

module.exports = { main }
`

// Near miss: the caboose's red body on its chassis and wheels only.
const PLAIN_BOX = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const L = 80
  const W = 30
  const WR = 9

  const bodyH = 28
  const chassisH = 5
  const chassisBottom = WR * 2 - 5
  const chassisTop = chassisBottom + chassisH
  const bodyBottom = chassisTop
  const bodyCenterZ = bodyBottom + bodyH / 2

  const wheelThick = 6
  const wheelY = W / 2 + 1.5
  const wheelX = L * 0.325
  const wheelZ = WR

  const red = [0.78, 0.14, 0.13]
  const chassisBlack = [0.16, 0.16, 0.17]
  const wheelBlack = [0.1, 0.1, 0.11]
  const hubRed = [0.78, 0.14, 0.13]

  const chassis = jf.cuboid({ size: [L + 4, W + 2, chassisH], center: [0, 0, chassisBottom + chassisH / 2] })
    .colorize(chassisBlack)
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)

  const wheelProto = jf.cylinder({ radius: WR, height: wheelThick, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 2.6, height: wheelThick + 2, segments: 16 }).rotateX(Math.PI / 2)
  const axleProto = jf.cylinder({ radius: 2.2, height: W + 4, segments: 16 }).rotateX(Math.PI / 2)
  const wheelPos = [
    [wheelX, wheelY], [wheelX, -wheelY],
    [-wheelX, wheelY], [-wheelX, -wheelY]
  ]
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, wheelZ]).colorize(wheelBlack))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, wheelZ]).colorize(hubRed))
  const axles = [wheelX, -wheelX].map((x) => axleProto.translate([x, 0, wheelZ]).colorize(chassisBlack))

  return [chassis, body, ...axles, ...wheels, ...hubs]
}

module.exports = { main }
`

export const patched = (source, edits) =>
  edits.reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`grader-validation: no ${JSON.stringify(from.slice(0, 40))} to patch`)
    return text.replace(from, () => to)
  }, source)

// Near miss: the caboose with its roofs removed and the body and cupola hollowed, open on top.
const NO_ROOF = patched(CABOOSE, [
  [
    `  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)`,
    `  const wall = 2
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .subtract(jf.cuboid({ size: [L - 2 * wall, W - 2 * wall, bodyH], center: [0, 0, bodyCenterZ + wall] }))
    .colorize(red)`,
  ],
  [
    `  // Roof - slightly overhanging slab with rounded edge feel (two stacked slabs)
  const roofLower = jf.cuboid({ size: [L + 8, W + 6, 3], center: [0, 0, bodyTop + 1.5] })
    .colorize(roofGrey)
  const roofUpper = jf.cuboid({ size: [L + 4, W + 2, 2.5], center: [0, 0, bodyTop + 3 + 1.25] })
    .colorize(roofGrey)

`,
    '',
  ],
  [
    `  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupH], center: [0, 0, cupBottom + cupH / 2] })`,
    `  // open-topped cupola walls standing on the body floor
  const floorZ = bodyBottom + wall
  const cupTop = cupBottom + cupH
  const cupTall = cupTop - floorZ
  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupTall], center: [0, 0, floorZ + cupTall / 2] })
    .subtract(jf.cuboid({ size: [cupLen - 3, cupWid - 3, cupTall], center: [0, 0, floorZ + cupTall / 2 + 1.5] }))`,
  ],
  [
    `  const cupRoof = jf.cuboid({ size: [cupLen + 6, cupWid + 6, 3], center: [0, 0, cupBottom + cupH + 1.5] })
    .colorize(roofGrey)
  const cupRoofTop = jf.cuboid({ size: [cupLen, cupWid, 2], center: [0, 0, cupBottom + cupH + 3 + 1] })
    .colorize(roofGrey)
`,
    '',
  ],
  [
    `  const chimney = jf.cylinder({ radius: chimR, height: chimH, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH / 2 - 1])`,
    `  const chimTop = bodyTop + 4 + chimH
  const chimney = jf.cylinder({ radius: chimR, height: chimTop - floorZ, segments: 24 })
    .translate([chimX, 0, (chimTop + floorZ) / 2])`,
  ],
  ['    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,', '    cupola,'],
])

// Near miss: roof, cupola, chimney and wheels moved 15 to 30 mm from where they belong.
const EXPLODED = patched(CABOOSE, [
  [
    `  return [
    chassis, beamFront, beamBack, body, skirt,
    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,
    chimney, chimneyCap,
    ...axles, ...wheels, ...hubs,
    ...sideWindows, ...doors, ...endGlass, ...cupWindows,`,
    `  // Near miss: parts displaced 15-30 mm from where they belong
  const move = (v, ...gs) => gs.map((g) => g.translate(v))
  const out = (y) => Math.sign(y) * 15
  return [
    chassis, beamFront, beamBack, body, skirt,
    ...move([0, 0, 15], roofLower, roofUpper),
    ...move([0, 0, 30], cupola, cupRoof, cupRoofTop, ...cupWindows),
    ...move([-12, 0, 22], chimney, chimneyCap),
    ...move([0, 0, -20], ...axles),
    ...wheels.map((w, i) => w.translate([0, out(wheelPos[i][1]), -20])),
    ...hubs.map((h, i) => h.translate([0, out(wheelPos[i][1]), -20])),
    ...sideWindows, ...doors, ...endGlass,`,
  ],
])

export const CASES = [
  { name: 'caboose', messages: [CABOOSE_MESSAGE], expected: 'pass', source: CABOOSE },
  { name: 'delivery-truck', messages: [CABOOSE_MESSAGE], expected: 'fail', source: DELIVERY_TRUCK },
  { name: 'plain-box', messages: [CABOOSE_MESSAGE], expected: 'fail', source: PLAIN_BOX },
  { name: 'exploded', messages: [CABOOSE_MESSAGE], expected: 'gate', source: EXPLODED },
  { name: 'no-roof', messages: [CABOOSE_MESSAGE], expected: 'known-miss', source: NO_ROOF },
]
````

The `CABOOSE` template literal must match the trial file byte for byte in the lines the patches name; the `cases.test.js` sizes and part counts catch any drift.

- [ ] **Step 4: Write `eval/grader-validate.js`**

```js
// Usage: npm run grader-validate -w @jscadui/agent-loop [-- --until render]
// Builds and renders each case in eval/grader-validation/cases.js in the crt sandbox (docs/user-manual.md, Grader validation).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isMainModule } from '../src/mainModule.js'
import { harnessGates, renderRecord, settleRun } from './complex.js'
import { CASES } from './grader-validation/cases.js'
import { createRunRenderer } from './render.js'
import { fileStamp, GRADE_LIFETIME_S, requireSandbox } from './run-eval.js'
import { gradeInFreshExecutor } from './sandboxed-backend.js'
import { startExecutor } from './sandbox.js'

export const STAGES = ['render']
const DEFAULT_DIR = join(homedir(), '.local', 'state', 'jscad-chat', 'grader-validation')

export const validationRun = async (c, graded, render) => {
  const gates = harnessGates(graded, c.pieces ?? 1)
  const run = { fixture: c.name, run: 1, expected: c.expected, userMessages: c.messages, gates, description: null, verdict: null }
  if (!graded.mesh?.parts) return settleRun({ ...run, renderError: graded.mesh?.error ?? 'the case did not build' })
  return settleRun({ ...run, render: renderRecord(graded, await render(graded.mesh.parts, { fixture: c.name, run: 1 })) })
}

export const expectedMatch = (run) => {
  if (run.expected === 'known-miss') return null
  if (run.expected === 'gate') return run.gates.find((g) => g.name === 'connected')?.pass === false
  if (!run.verdict) return false
  return run.verdict.success === (run.expected === 'pass')
}

const verdictText = (run) => (run.verdict ? (run.verdict.success ? 'SUCCESS' : 'FAILURE') : run.graderError ? 'split' : '-')

const matchText = (run, judged) => {
  if (!judged && run.expected !== 'gate') return '-'
  const match = expectedMatch(run)
  return match === null ? 'not scored' : match ? 'yes' : 'NO'
}

export const formatValidation = (runs, { judged = true } = {}) => {
  const lines = ['case  expected  failed gates  verdict  votes  match']
  for (const run of runs) {
    const failed = run.gates.filter((g) => !g.pass).map((g) => g.name).join(',') || '-'
    lines.push(`${run.fixture}  ${run.expected}  ${failed}  ${verdictText(run)}  ${run.verdict?.votes?.join('-') ?? '-'}  ${matchText(run, judged)}`)
  }
  for (const run of runs) {
    if (run.description?.text) lines.push('', `${run.fixture}:`, run.description.text)
    else if (run.render?.views?.length) lines.push('', `${run.fixture}: ${dirname(run.render.views[0].path)}`)
    else if (run.renderError) lines.push('', `${run.fixture}: ${run.renderError}`)
  }
  return lines.join('\n')
}

const modelOf = (c) => (c.files ? { files: c.files, entry: c.entry } : { files: { 'main.js': c.source }, entry: 'main.js' })

const main = async (argv, env) => {
  const at = argv.indexOf('--until')
  const until = at === -1 ? STAGES.at(-1) : argv[at + 1]
  if (!STAGES.includes(until)) {
    console.error(`grader-validate: --until takes ${STAGES.join(', ')}`)
    process.exit(1)
  }
  const sandbox = await requireSandbox(env)
  const dir = env.GRADER_VALIDATION_DIR || DEFAULT_DIR
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${fileStamp()}-grader-validation.json`)
  const renderer = createRunRenderer(path)
  const results = []
  try {
    for (const c of CASES) {
      const api = c.api ?? 'fluent'
      const graded = await gradeInFreshExecutor(() => startExecutor({ api, sandbox, lifetimeS: GRADE_LIFETIME_S }), modelOf(c), { probe: { bodies: {} }, mesh: true })
      results.push(await validationRun(c, graded, renderer.render))
    }
  } finally {
    await renderer.close()
  }
  writeFileSync(path, JSON.stringify({ suite: 'complex', validation: true, date: new Date().toISOString(), results }, null, 2))
  console.log(`grader-validate: wrote ${path}`)
  const final = JSON.parse(readFileSync(path, 'utf8')).results
  const judged = until === 'judge'
  console.log(formatValidation(final, { judged }))
  if (final.some((run) => (judged || run.expected === 'gate') && expectedMatch(run) === false)) process.exitCode = 1
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
```

In `packages/agent-loop/package.json` `scripts`, after `"eval:keyless": ...` add:

```json
    "grader-validate": "node --import ./text-loader.js eval/grader-validate.js"
```

(add the comma the JSON needs after the `eval:keyless` line).

- [ ] **Step 5: Write `ci/grader-validate`**

```bash
#!/usr/bin/env bash
# Builds, renders (and in later stages describes and judges) the
# grader-validation cases on the CI host (packages/agent-loop/eval/grader-validation/)
# and fails when a scored case does not match.
#
#   sci push jscadui/grader-validate
#
# UNTIL is the last stage to run. sci push carries no arguments, so edit it in
# the working tree before pushing. Output: grader-validation/ in the job's
# worktree (sci artifact JOB grader-validation/<file>.renders/<case>-1/<view>.png).
set -uo pipefail

UNTIL="${GRADER_VALIDATE_UNTIL:-render}"
WORKTREE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKTREE"

node scripts/fetch-sources.js || exit 1
npm install || exit 1
npm run build -- --continue || echo "workspace build had failures (continuing)"

export EVAL_REQUIRE_MEMORY_LIMIT=1
if ! scripts/eval-sandbox-setup.sh --check; then
  echo "ci/grader-validate: the eval sandbox is not set up on this host; see ci/README.md" >&2
  exit 1
fi
if [ "$UNTIL" != render ] && ! scripts/describer-setup.sh --check; then
  echo "ci/grader-validate: the describer is not set up on this host; see ci/README.md (Describer)" >&2
  exit 1
fi
( cd apps/jscad-web && npx playwright install chromium ) || exit 1

export GRADER_VALIDATION_DIR="$WORKTREE/grader-validation"
npm run grader-validate -w @jscadui/agent-loop -- --until "$UNTIL"
```

Run: `chmod 755 ci/grader-validate`

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/grader-validation/cases.test.js eval/grader-validate.test.js`
Expected: PASS. If a case's size or part count differs from `TRIAL`, the patch text drifted from the trial file: compare the patched source against the diff in this step's `patched` calls, do not change `TRIAL`.

- [ ] **Step 7: Document grader validation**

In `packages/agent-loop/docs/user-manual.md`, insert before `### Sandbox setup`:

````markdown
### Grader validation

`eval/grader-validation/cases.js` holds known answers for the describer and
judge: model source, the user's messages and the expected result.

| case | expected |
|---|---|
| `caboose`, the chat-built toy caboose | pass |
| `delivery-truck` | fail |
| `plain-box`, the caboose's red body on its wheels only | fail |
| `exploded`, the caboose's roof, cupola, chimney and wheels moved 15 to 30 mm apart | fails `connected`, whatever the verdict |
| `no-roof`, the caboose with its roofs removed | a known miss: recorded, not scored |

```bash
npm run grader-validate -w @jscadui/agent-loop
```

builds each case in the crt sandbox with the `bodies` probe, renders it, and
prints each case's failed gates against the expected result and where its
renders are; it exits 1 when `exploded` does not fail `connected`. It writes
`<time>-grader-validation.json` and its renders to `GRADER_VALIDATION_DIR`
(default `~/.local/state/jscad-chat/grader-validation/`). A case may give
`files` and `entry` in place of `source`, and `api` (default `fluent`).
````

In the `### Environment variables` table, after the `EVAL_RUN_TIMEOUT` row add:

```markdown
| `GRADER_VALIDATION_DIR` | where `grader-validate` writes its file and renders, default `~/.local/state/jscad-chat/grader-validation` |
```

In `ci/README.md`, insert before `## gpu-poll`:

````markdown
## Grader validation (`ci/grader-validate`)

`sci push jscadui/grader-validate` runs `npm run grader-validate` on the CI
host (`packages/agent-loop/docs/user-manual.md`, Grader validation) after the
same sandbox check as `ci/eval` and a `npx playwright install chromium`. The
script's `UNTIL` picks the last stage; edit it in the working tree before
pushing. Output lands in the job's `grader-validation/`; fetch a render with
`sci artifact JOB grader-validation/<file>.renders/<case>-1/iso-front.png`
or copy the directory with `scp`.
````

- [ ] **Step 8: Commit**

```bash
git add packages/agent-loop/eval/grader-validation packages/agent-loop/eval/grader-validate.js packages/agent-loop/eval/grader-validate.test.js packages/agent-loop/package.json ci/grader-validate packages/agent-loop/docs/user-manual.md ci/README.md
```

```bash
git commit -m "feat(eval): grader-validation cases and a render-stage grader-validate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

- [ ] **Step 9: Rollout gate (spec step 1, on the CI host, with the user)**

1. `sci push jscadui/grader-validate` (with `UNTIL=render`). Expected: exit 0, `exploded  gate  connected  -  -  yes`.
2. Fetch the fifteen PNGs and ask the user to read them against the trial's renders (the caboose red with a grey roof and cupola; the truck blue and white; `plain-box` a red box on wheels; `exploded` with roof, cupola, chimney and wheels floating; `no-roof` open on top).
3. On the CI host, copy the current baseline result files to a scratch directory, run `npm run eval -w @jscadui/agent-loop -- --regrade <copies>` there, and confirm with `git diff --no-index` against the originals that only `regradedAt` changed.

Stop and report to the user before Task 6.

---

### Task 6: Describer install and `describe.py`

**Files:**
- Create: `scripts/describer-setup.sh` (mode 755)
- Create: `packages/agent-loop/eval/describer/describe.py`
- Create: `packages/agent-loop/eval/describer.test.js`
- Modify: `ci/README.md`, `packages/agent-loop/docs/architecture.md`, `packages/agent-loop/docs/development.md` (Tests)

**Model:** `sonnet` — Python and bash derived from the proven trial script; the kestrel patches must be copied exactly.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `scripts/describer-setup.sh [--check]`, reading `DESCRIBER_HOME` (default `/data/moondream3`) and `DESCRIBER_PYTHON` (default `python3`); prints `describer: ready` or `describer: <problem>` and exits 1.
  - `describe.py` protocol, one JSON object per line. Out: first `{ "ready": true, "model": "moondream3.1-9B-A2B", "kestrel": "0.9.1", "loadMs": N }`; per request `{ "id", "text", "ms", "inputTokens", "outputTokens" }` or `{ "id", "error" }`; after stdin closes `{ "done": true, "blockedConnections": N }`; on a start that cannot go on `{ "fatal": "...", "blockedConnections": N }` and exit 2. In: `{ "id", "image": "/abs/path.png", "prompt" }`.
  - Python module functions `is_loopback(host)`, `install_connection_guard() → list` (importable without kestrel).

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-loop/eval/describer.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESCRIBE_PY = fileURLToPath(new URL('./describer/describe.py', import.meta.url))
const SETUP = fileURLToPath(new URL('../../../scripts/describer-setup.sh', import.meta.url))
const hasPython = spawnSync('python3', ['--version']).status === 0

// Loads describe.py as a module (kestrel is imported only inside main()), then tries the guard.
const GUARD_CHECK = `
import importlib.util, socket, sys
spec = importlib.util.spec_from_file_location("describe", sys.argv[1])
describe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(describe)
blocked = describe.install_connection_guard()
server = socket.socket()
server.bind(("127.0.0.1", 0))
server.listen(1)
local = socket.socket()
local.connect(server.getsockname())
local.close()
outside = socket.socket()
try:
    outside.connect(("203.0.113.7", 443))
    print("connected")
except ConnectionRefusedError:
    print("refused")
print(socket.socket().connect_ex(("198.51.100.1", 80)) != 0, len(blocked))
print(describe.is_loopback("::1"), describe.is_loopback("localhost"), describe.is_loopback("api.moondream.ai"))
`

describe.skipIf(!hasPython)('describe.py', () => {
  it('refuses every connection but loopback and counts the refusals', () => {
    const out = spawnSync('python3', ['-c', GUARD_CHECK, DESCRIBE_PY], { encoding: 'utf8' })
    expect(out.stderr).toBe('')
    expect(out.stdout).toBe('refused\nTrue 2\nTrue True False\n')
  })
})

describe('describer-setup.sh --check', () => {
  it('names the missing venv and fails', () => {
    const home = mkdtempSync(join(tmpdir(), 'describer-home-'))
    const out = spawnSync('bash', [SETUP, '--check'], { encoding: 'utf8', env: { ...process.env, DESCRIBER_HOME: home } })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain(`describer: no venv at ${join(home, 'venv')}`)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/describer.test.js`
Expected: FAIL, neither file exists.

- [ ] **Step 3: Write `packages/agent-loop/eval/describer/describe.py`**

```python
# Moondream 3.1 describer for the agent-loop eval, started by eval/describe.js in the venv from
# scripts/describer-setup.sh; its JSON-lines protocol is in docs/architecture.md (The describer).

import errno
import ipaddress
import json
import os
import socket
import sys
import time

KESTREL = "0.9.1"
MODEL = "moondream3.1-9B-A2B"
SETTINGS = {"temperature": 0.0, "max_tokens": 300}
RUNTIME = {"enable_prefix_cache": False, "kv_cache_pages": 4096, "max_batch_size": 1, "decode_path": "native"}


def is_loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def install_connection_guard():
    """Refuses every IP connection to a host other than loopback; returns the refused addresses."""
    blocked = []
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def refused(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not is_loopback(str(address[0])):
            blocked.append(str(address))
            return True
        return False

    def connect(self, address):
        if refused(self, address):
            raise ConnectionRefusedError(f"outbound connection refused: {address}")
        return real_connect(self, address)

    def connect_ex(self, address):
        if refused(self, address):
            return errno.ECONNREFUSED
        return real_connect_ex(self, address)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    return blocked


def silence_telemetry():
    """kestrel 0.9.1 posts usage to api.moondream.ai at start, every 60 s and at shutdown, with no setting to stop it."""
    import kestrel.model_download as kmd
    import kestrel.photon as kp

    async def no_flush(self, *, rotate=True):
        return None

    kp.PhotonReporter._flush_window = no_flush
    kp.PhotonReporter.start = lambda self: None
    kmd.probe_supported_model_configs = lambda *a, **k: None


def fit_12gb_card():
    """Stock kestrel 0.9.1 does not fit Moondream 3.1 on a 12 GB card."""
    import kestrel.models.moondream.weights as kmw
    import torch
    import torch.nn as nn
    from kestrel.models.moondream._moe_layout import _interleave_gate_up_rows8
    from kestrel.models.moondream.model import MoondreamModel

    original_to_empty = nn.Module.to_empty

    # The bf16 placeholders for the MoE experts alone overflow the card; the fp8 weights replace them at load.
    def lean_to_empty(self, *, device, recurse=True):
        for block in self.text.blocks:
            if hasattr(block.mlp, "router"):
                fused = block.mlp["mlp"]
                for name in ("up_experts", "down_experts"):
                    getattr(fused, name).weight = nn.Parameter(torch.empty(0, dtype=torch.uint8, device="meta"), requires_grad=False)
        return original_to_empty(self, device=device, recurse=recurse)

    # The padded up-projection slab only feeds the megakernel; decode_path="native" reads per-layer weights.
    def per_layer_up(fused, up_w_slab, up_scale_slab, layer_idx, up_weight_uint8, up_scale, inter):
        fused.up_experts.weight = nn.Parameter(_interleave_gate_up_rows8(up_weight_uint8, inter), requires_grad=False)
        fused.up_experts.register_buffer("scale", _interleave_gate_up_rows8(up_scale, inter).float())

    MoondreamModel.to_empty = lean_to_empty
    kmw.build_md3_moe_up_slab = lambda text, **kw: (None, None)
    kmw.set_md3_moe_up_layer = per_layer_up


def main():
    os.environ["HF_HUB_OFFLINE"] = "1"
    # Library output would corrupt the protocol: fd 1 becomes stderr, replies go to a copy of the original.
    protocol = os.fdopen(os.dup(1), "w", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def send(message):
        protocol.write(json.dumps(message, ensure_ascii=False) + "\n")
        protocol.flush()

    blocked = install_connection_guard()
    try:
        from importlib.metadata import PackageNotFoundError, version

        try:
            installed = version("kestrel")
        except PackageNotFoundError:
            installed = None
        if installed != KESTREL:
            send({"fatal": f"describe.py patches kestrel {KESTREL} and found {installed or 'none'}; run scripts/describer-setup.sh", "blockedConnections": len(blocked)})
            return 2
        silence_telemetry()
        import moondream as md

        fit_12gb_card()
        started = time.time()
        client = md.photon(MODEL, **RUNTIME)
    except Exception as error:  # noqa: BLE001 - the parent reports it
        send({"fatal": f"the describer did not start: {error!r}"[:1000], "blockedConnections": len(blocked)})
        return 2
    model = client._model
    send({"ready": True, "model": MODEL, "kestrel": KESTREL, "loadMs": round((time.time() - started) * 1000)})

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            rid, image_path, prompt = request["id"], request["image"], request["prompt"]
        except (ValueError, KeyError, TypeError):
            send({"id": None, "error": "malformed request"})
            continue
        started = time.time()
        try:
            with open(image_path, "rb") as f:
                image = f.read()
            result = client._run(model.query(image=image, question=prompt, reasoning=False, stream=False, settings=SETTINGS))
            metrics = result.metrics
            send({
                "id": rid,
                "text": (result.output.get("answer") or "").strip(),
                "ms": round((time.time() - started) * 1000),
                "inputTokens": getattr(metrics, "input_tokens", None),
                "outputTokens": getattr(metrics, "output_tokens", None),
            })
        except Exception as error:  # noqa: BLE001 - one image failed, the rest go on
            send({"id": rid, "error": repr(error)[:500]})

    client.close()
    send({"done": True, "blockedConnections": len(blocked)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Write `scripts/describer-setup.sh`**

```bash
#!/usr/bin/env bash
# Installs and checks the eval's describer: Moondream 3.1 through kestrel,
# pinned, in a venv under DESCRIBER_HOME (packages/agent-loop/eval/describer/).
#
#   scripts/describer-setup.sh          install the venv and weights, then check
#   scripts/describer-setup.sh --check  check only (ci/eval-complex)
#
# DESCRIBER_HOME defaults to /data/moondream3 (venv/, hf/); the user the eval
# runs as must be able to read it. DESCRIBER_PYTHON picks the interpreter the
# venv is made from (default python3).
set -euo pipefail

HOME_DIR="${DESCRIBER_HOME:-/data/moondream3}"
VENV="$HOME_DIR/venv"
PY="$VENV/bin/python"
MOONDREAM=2.6.1
KESTREL=0.9.1
export HF_HOME="$HOME_DIR/hf"

fail() {
  echo "describer: $1" >&2
  exit 1
}

# Fetches the model and its tokenizer into HF_HOME; with HF_HUB_OFFLINE=1 it only checks they are there.
weights() {
  "$PY" - <<'PY'
from huggingface_hub import snapshot_download
from kestrel.model_download import ensure_model_weights

ensure_model_weights("moondream3.1-9B-A2B")
snapshot_download("moondream/starmie-v1")
PY
}

if [ "${1:-}" != --check ]; then
  mkdir -p "$HOME_DIR"
  [ -x "$PY" ] || "${DESCRIBER_PYTHON:-python3}" -m venv "$VENV"
  "$PY" -m pip install --quiet "moondream==$MOONDREAM" "kestrel==$KESTREL"
  weights
fi

[ -x "$PY" ] || fail "no venv at $VENV: run scripts/describer-setup.sh (DESCRIBER_HOME=$HOME_DIR)"
for pin in "moondream==$MOONDREAM" "kestrel==$KESTREL"; do
  name="${pin%%==*}"
  want="${pin#*==}"
  have="$("$PY" -c 'import sys, importlib.metadata as m; print(m.version(sys.argv[1]))' "$name" 2>/dev/null)" || fail "$name is not installed in $VENV: run scripts/describer-setup.sh"
  [ "$have" = "$want" ] || fail "$name $have is installed, the pin is $want: run scripts/describer-setup.sh"
done
"$PY" -c 'import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)' 2>/dev/null || fail "torch in $VENV cannot see a CUDA device"
HF_HUB_OFFLINE=1 weights 2>/dev/null || fail "the weights are not in $HF_HOME: run scripts/describer-setup.sh"
command -v nvidia-smi >/dev/null || fail "no nvidia-smi on PATH"
echo "describer: ready"
```

Run: `chmod 755 scripts/describer-setup.sh`

If `pip` resolves a torch without CUDA for the host, install the CUDA wheel the trial used (torch 2.14.0, CUDA 13) into the venv by hand; the `--check` torch line catches it.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/describer.test.js`
Expected: PASS (the `describe.py` block is skipped only when there is no `python3`).

- [ ] **Step 6: Document the describer install and its patches**

In `ci/README.md`, insert before `## Grader validation (\`ci/grader-validate\`)`:

````markdown
## Describer

The complex eval describes renders with Moondream 3.1 9B A2B
(`moondream/moondream3.1-9B-A2B`, the 10.5 GB fp8 build) through Photon,
`moondream==2.6.1` and `kestrel==0.9.1` pinned in a venv. It needs the whole
12 GB card (peak 11.7 GB). Once, as a user who can write `/data`:

```sh
scripts/describer-setup.sh
```

makes `DESCRIBER_HOME` (default `/data/moondream3`: `venv/`, `hf/`), installs
the pinned packages and fetches the model and its tokenizer
(`moondream/starmie-v1`). The CI job user must be able to read it.
`scripts/describer-setup.sh --check` repeats the check without changing
anything and prints `describer: ready` or what is missing: the venv, a pin,
CUDA in torch, the weights, `nvidia-smi`. If pip picks a torch without CUDA,
install the CUDA build into the venv by hand.
````

In `packages/agent-loop/docs/architecture.md`, `## Complex grading`, add after the `### Rendering` subsection:

```markdown
### The describer

`eval/describer/describe.py` runs Moondream 3.1 9B A2B (the 10.5 GB fp8
build) through Photon in the venv from `scripts/describer-setup.sh`. It loads
the model once, then reads one JSON request per line on stdin and writes one
JSON reply per line on stdout; everything a library prints goes to stderr, so
stdout carries only the protocol. It asks per view with reasoning off,
temperature 0 and at most 300 output tokens.

A request is `{ id, image, prompt }`, `image` an absolute PNG path. The first
line out is `{ ready: true, model, kestrel, loadMs }` once the model has
loaded; each request gets `{ id, text, ms, inputTokens, outputTokens }` or
`{ id, error }`, and one image that fails does not stop the rest. After stdin
closes the last line is `{ done: true, blockedConnections }`. A start that
cannot go on (the wrong kestrel, a model that does not load) writes
`{ fatal, blockedConnections }` and exits 2.

Kestrel 0.9.1 does not fit the CI host's 12 GB card as shipped, so
`describe.py` patches it at runtime, as the trial did: no bf16 placeholders
for the MoE experts before the fp8 weights replace them, per-layer
up-projection weights in place of the padded slab, `decode_path="native"`,
`kv_cache_pages=4096`, `max_batch_size=1`, and the prefix cache off. The
patches reach into kestrel's internals, so it refuses to start on any other
kestrel version, naming the pin.

Kestrel posts telemetry (instance id, model, hostname, token counts, GPU) to
`api.moondream.ai` at start, every 60 s and at shutdown, with no setting to
turn it off. `describe.py` replaces the reporter's start and flush with
no-ops, skips the Hugging Face config probe, runs with `HF_HUB_OFFLINE=1`, and
refuses every socket connection to an address other than loopback
(`connect` and `connect_ex`). It reports the refused connections when it ends.
```

In `packages/agent-loop/docs/development.md`, Tests section, append to the paragraph that ends with the `eval/render.test.js` sentence (Task 2):

```markdown
`eval/describer.test.js` checks `describe.py`'s connection guard with
`python3` and skips that check when there is none; it needs no kestrel, GPU or
weights.
```

- [ ] **Step 7: Commit**

```bash
git add scripts/describer-setup.sh packages/agent-loop/eval/describer packages/agent-loop/eval/describer.test.js ci/README.md packages/agent-loop/docs/architecture.md packages/agent-loop/docs/development.md
```

```bash
git commit -m "feat(eval): Moondream 3.1 describer process and its pinned install

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 7: `npm run describe`

**Files:**
- Create: `packages/agent-loop/eval/describe.js`
- Create: `packages/agent-loop/eval/fake-describer.js`
- Create: `packages/agent-loop/eval/describe.test.js`
- Modify: `packages/agent-loop/eval/grader-validate.js` (describe stage)
- Modify: `packages/agent-loop/package.json` (scripts)
- Modify: `packages/agent-loop/docs/user-manual.md`, `packages/agent-loop/docs/architecture.md`, `docs/backlog.md`

**Model:** `sonnet` — a child-process client, file updates and a GPU check, all given.

**Interfaces:**
- Consumes: `settleRun` (Task 3), `summarize` (report.js), `VIEW_LABELS` (Task 2), the `describe.py` protocol (Task 6).
- Produces (`eval/describe.js`):
  - `DESCRIBE_PROMPT`, `DESCRIBE_PROMPT_SHA256`, `viewPrompt(label, { dimensions, bodies }) → string`, `describedText(views: [{ label, reply }]) → string`
  - `pendingRuns(file, { all }) → runs`
  - `startDescriber({ command, args, env, spawn }) → { ready: Promise<hello>, describe(request, timeoutMs) → Promise<reply>, close() → Promise<{ done: true, blockedConnections } | { done: false, blockedConnections: null, error }>, kill() }`; a describer that exits before `done` resolves `close()` with `done: false` and the exit as `error`
  - `describeFiles(paths, { all, describer, log }) → Promise<{ described, failed, blockedConnections, crashed? }>`; `crashed` is the exit message of a describer that died before `done`, and `blockedConnections` is then null
  - `describeStop(outcome) → string | null`: why the judge must not run after this outcome (a crash, or any refused connection), or null; `describe.js` and `grader-validate.js` both print it
  - `REQUIRED_FREE_MIB = 11_800`, `unloadOllama({ fetch, settleMs, pollMs }) → Promise<string[]>`, `freeGpu({ fetch, exec, settleMs, pollMs }) → Promise<{ ok, free, holders?, unloaded }>`
  - `describerHome(env)`, `describerEnv(env, home)`, `runDescribe(paths, { all, env, log }) → Promise<outcome>` (GPU check, start, describe; throws with a message when the card is short or the describer does not start)
  - CLI exit codes: 0 when every pending run was described; 1 when it finished but a view failed (those runs keep `describeError` and a later run retries them); 2 when it stopped in a way that must keep the judge from running: no files given, the GPU check stopped it, the describer did not start or died, or it tried an outside connection. `ci/eval-complex` (Task 11) runs the judge after 0 or 1, never after 2.
  - A described run gains `description: { text, views: [{ name, text, ms, inputTokens, outputTokens }] }` or `describeError`; the file gains `describer: { model, kestrel, promptSha256, blockedConnections }`.

- [ ] **Step 1: Write the fake describer**

Create `packages/agent-loop/eval/fake-describer.js`:

```js
// Test-only stand-in for eval/describer/describe.py: the same JSON lines, no model.
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (process.env.FAKE_DESCRIBER_FATAL) {
  send({ fatal: process.env.FAKE_DESCRIBER_FATAL, blockedConnections: 0 })
  process.exit(2)
}
send({ ready: true, model: 'fake', kestrel: '0.9.1', loadMs: 0 })
for await (const line of createInterface({ input: process.stdin })) {
  if (process.env.FAKE_DESCRIBER_CRASH) process.exit(3)
  const { id, image, prompt } = JSON.parse(line)
  if (!existsSync(image)) send({ id, error: `no image at ${image}` })
  else send({ id, text: ` described ${prompt.split('.')[0]} `, ms: 1, inputTokens: 10, outputTokens: 5 })
}
send({ done: true, blockedConnections: Number(process.env.FAKE_DESCRIBER_BLOCKED ?? 0) })
```

- [ ] **Step 2: Write the failing tests**

Create `packages/agent-loop/eval/describe.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESCRIBE_PROMPT_SHA256, describeFiles, describerEnv, describeStop, freeGpu, pendingRuns, REQUIRED_FREE_MIB, startDescriber, viewPrompt } from './describe.js'
import { VIEWS } from './views.js'

const FAKE = fileURLToPath(new URL('./fake-describer.js', import.meta.url))
const fake = (env = {}) => startDescriber({ command: process.execPath, args: [FAKE], env: { PATH: process.env.PATH, ...env } })

const rendered = (overrides = {}) => ({
  fixture: 'caboose',
  run: 1,
  userMessages: ['we need a model of a toy caboose'],
  gates: [{ name: 'builds', pass: true }],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.5 },
  render: {
    meshSha256: 'a'.repeat(64),
    facts: { dimensions: [111, 41, 67], bodies: 62 },
    views: VIEWS.map((v) => ({ name: v.name, path: `r.renders/caboose-1/${v.name}.png`, sha256: 'b'.repeat(64) })),
  },
  description: null,
  verdict: null,
  verdictPending: true,
  ...overrides,
})

const resultFile = (runs, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'describe-test-'))
  mkdirSync(join(dir, 'r.renders', 'caboose-1'), { recursive: true })
  for (const view of VIEWS) writeFileSync(join(dir, 'r.renders', 'caboose-1', `${view.name}.png`), 'png')
  const path = join(dir, 'r.json')
  writeFileSync(path, JSON.stringify({ suite: 'complex', summary: [], results: runs, ...extra }))
  return { dir, path }
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

describe('the describer prompt', () => {
  it('names the view, the size and the part count, then asks for a plain description', () => {
    expect(viewPrompt('side view', { dimensions: [111, 41, 67], bodies: 62 })).toBe(
      "This is the side view. Overall size 111×41×67 mm, 62 parts.\n\nDescribe the object in these renders: what it most likely is, its main parts and how they're arranged, colours, and anything that looks broken or odd. Plain text, under 150 words. Do not guess a purpose you can't see.",
    )
    expect(DESCRIBE_PROMPT_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pendingRuns', () => {
  it('picks rendered runs with no description, or every rendered run with all', () => {
    const file = { suite: 'complex', results: [rendered(), rendered({ description: { text: 'x' } }), rendered({ renderStale: true }), rendered({ render: undefined, renderError: 'no mesh' })] }
    expect(pendingRuns(file)).toEqual([file.results[0]])
    expect(pendingRuns(file, { all: true })).toEqual([file.results[0], file.results[1]])
    expect(pendingRuns({ results: file.results })).toEqual([])
  })
})

describe('describeFiles', () => {
  it('describes each view and writes the description, joined one line per view', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake() })
    expect(outcome).toEqual({ described: 1, failed: 0, blockedConnections: 0 })
    const file = read(path)
    const [run] = file.results
    expect(run.description.text).toBe(VIEWS.map((v) => `${v.label}: described This is the ${v.label}`).join('\n'))
    expect(run.description.views).toEqual(VIEWS.map((v) => ({ name: v.name, text: `described This is the ${v.label}`, ms: 1, inputTokens: 10, outputTokens: 5 })))
    expect(run.verdictPending).toBe(true)
    expect(file.describer).toEqual({ model: 'fake', kestrel: '0.9.1', promptSha256: DESCRIBE_PROMPT_SHA256, blockedConnections: 0 })
  })

  it('leaves a run with a failed view undescribed and says which view', async () => {
    const { dir, path } = resultFile([rendered()])
    rmSync(join(dir, 'r.renders', 'caboose-1', 'side.png'))
    const outcome = await describeFiles([path], { describer: fake() })
    expect(outcome.failed).toBe(1)
    const [run] = read(path).results
    expect(run.description).toBeNull()
    expect(run.describeError).toMatch(/^side: no image at /)
  })

  it('redescribes a judged run with all, clearing its verdict', async () => {
    const { path } = resultFile([rendered({ description: { text: 'old', views: [] }, votes: [{ success: true }], verdict: { success: true, votes: [3, 0] }, verdictPending: undefined })])
    await describeFiles([path], { describer: fake() })
    expect(read(path).results[0].description.text).toBe('old')
    await describeFiles([path], { all: true, describer: fake() })
    const [run] = read(path).results
    expect(run.description.text).not.toBe('old')
    expect(run.verdict).toBeNull()
    expect(run).not.toHaveProperty('votes')
    expect(run.verdictPending).toBe(true)
  })

  it('records the connections the describer refused', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake({ FAKE_DESCRIBER_BLOCKED: '2' }) })
    expect(outcome.blockedConnections).toBe(2)
    expect(read(path).describer.blockedConnections).toBe(2)
  })

  it('fails with the describer own message when it cannot start', async () => {
    const { path } = resultFile([rendered()])
    await expect(describeFiles([path], { describer: fake({ FAKE_DESCRIBER_FATAL: 'describe.py patches kestrel 0.9.1 and found 0.9.2' }) })).rejects.toThrow('found 0.9.2')
  })

  it('reports a describer that dies as a crash, not as refused connections', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake({ FAKE_DESCRIBER_CRASH: '1' }) })
    expect(outcome).toMatchObject({ described: 0, failed: 1, blockedConnections: null, crashed: 'the describer exited (code 3)' })
    const file = read(path)
    expect(file.results[0].describeError).toMatch(/^iso-front: the describer exited \(code 3\)/)
    expect(file.describer.blockedConnections).toBeNull()
  })

  it('skips a file that is not a complex pass', async () => {
    const { path } = resultFile([rendered()], { suite: undefined })
    const log = []
    await describeFiles([path], { describer: fake(), log: (line) => log.push(line) })
    expect(read(path).results[0].description).toBeNull()
    expect(log[0]).toMatch(/not a complex result file/)
  })
})

describe('describeStop', () => {
  it('stops the judge after a crash or a refused connection, not after a failed view', () => {
    expect(describeStop({ described: 1, failed: 1, blockedConnections: 0 })).toBeNull()
    expect(describeStop({ described: 1, failed: 0, blockedConnections: 2 })).toMatch(/tried 2 outside connections, all refused/)
    expect(describeStop({ described: 0, failed: 1, blockedConnections: null, crashed: 'the describer exited (code 3)' })).toMatch(/exited \(code 3\).*unknown/)
  })
})

describe('freeGpu', () => {
  const ollama = (loaded) => {
    const calls = []
    const fetch = async (url, init) => {
      calls.push([url, init?.body ?? null])
      if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models: loaded.map((name) => ({ name })) }) }
      loaded.splice(0)
      return { ok: true, json: async () => ({}) }
    }
    return { calls, fetch }
  }
  const smi = (free) => (_command, args) => (args[0].includes('memory.free') ? `${free}\n` : '1234, chatterbox, 3496 MiB\n')

  it('unloads Ollama models, then passes with enough free memory', async () => {
    const { calls, fetch } = ollama(['qwen3.5:9b'])
    const gpu = await freeGpu({ fetch, exec: smi(REQUIRED_FREE_MIB + 200), pollMs: 1 })
    expect(gpu).toEqual({ ok: true, free: REQUIRED_FREE_MIB + 200, unloaded: ['qwen3.5:9b'] })
    expect(calls).toContainEqual(['http://127.0.0.1:11434/api/generate', JSON.stringify({ model: 'qwen3.5:9b', keep_alive: 0 })])
  })

  it('names the processes holding the card when it is short', async () => {
    const { fetch } = ollama([])
    const gpu = await freeGpu({ fetch, exec: smi(8000), pollMs: 1 })
    expect(gpu).toEqual({ ok: false, free: 8000, holders: '1234, chatterbox, 3496 MiB', unloaded: [] })
  })

  it('goes on when Ollama is not running', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect((await freeGpu({ fetch, exec: smi(12000), pollMs: 1 })).ok).toBe(true)
  })
})

describe('describerEnv', () => {
  it('passes the process only what the describer needs, never a key', () => {
    const env = describerEnv({ PATH: '/bin', HOME: '/home/s-ci', EVAL_API_KEY: 'sk-secret', LANG: 'C.UTF-8' }, '/data/moondream3')
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/s-ci', LANG: 'C.UTF-8', HF_HOME: '/data/moondream3/hf', HF_HUB_OFFLINE: '1' })
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/describe.test.js`
Expected: FAIL, `describe.js` cannot be resolved.

- [ ] **Step 4: Write `eval/describe.js`**

```js
// Usage: npm run describe -w @jscadui/agent-loop -- [--all] <result files>
// Stage B of the complex eval (docs/user-manual.md, Describe and judge); npm runs it in packages/agent-loop, so give absolute paths.
import { execFileSync, spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../src/mainModule.js'
import { settleRun } from './complex.js'
import { summarize } from './report.js'
import { VIEW_LABELS } from './views.js'

export const DESCRIBE_PY = fileURLToPath(new URL('./describer/describe.py', import.meta.url))
export const DEFAULT_DESCRIBER_HOME = '/data/moondream3'
export const DESCRIBE_TIMEOUT_MS = 120_000
export const REQUIRED_FREE_MIB = 11_800
const OLLAMA = 'http://127.0.0.1:11434'

export const DESCRIBE_PROMPT =
  "Describe the object in these renders: what it most likely is, its main parts and how they're arranged, colours, and anything that looks broken or odd. Plain text, under 150 words. Do not guess a purpose you can't see."

export const viewPrompt = (label, { dimensions, bodies }) => `This is the ${label}. Overall size ${dimensions.join('×')} mm, ${bodies} parts.\n\n${DESCRIBE_PROMPT}`

export const DESCRIBE_PROMPT_SHA256 = createHash('sha256').update(viewPrompt('{view}', { dimensions: ['{W}', '{D}', '{H}'], bodies: '{N}' })).digest('hex')

export const describedText = (views) => views.map(({ label, reply }) => `${label}: ${reply.text.trim()}`).join('\n')

// Rendered runs with no description, or with `all` every rendered run; a stale render waits for --rerender.
export const pendingRuns = (file, { all = false } = {}) =>
  file?.suite !== 'complex'
    ? []
    : file.results.filter((r) => r.render?.views?.length > 0 && !r.renderStale && !r.renderError && (all || r.description == null))

// The Node end of describe.py's protocol: JSON lines both ways, one request at a time.
export const startDescriber = ({ command, args = [], env, spawn = nodeSpawn }) => {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let exited = null
  let markReady
  let failReady
  let markDone
  const ready = new Promise((resolveReady, rejectReady) => {
    markReady = resolveReady
    failReady = rejectReady
  })
  ready.catch(() => {})
  const done = new Promise((resolveDone) => {
    markDone = resolveDone
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message?.ready) markReady(message)
    else if (message?.fatal) failReady(new Error(message.fatal))
    else if (message?.done) markDone(message)
    else {
      const settle = waiting.get(message?.id)
      waiting.delete(message?.id)
      settle?.(message)
    }
  })
  const end = (reason) => {
    exited ??= new Error(`the describer exited (${reason})`)
    failReady(exited)
    for (const settle of waiting.values()) settle({ error: exited.message })
    waiting.clear()
    markDone({ done: false, blockedConnections: null, error: exited.message })
  }
  child.on('error', (error) => end(error.message))
  child.on('close', (code, signal) => end(code === null ? `signal ${signal}` : `code ${code}`))
  // A write to a describer that has died (EPIPE) fails here; its 'close' settles the waiting requests.
  child.stdin.on('error', () => {})
  const describe = (request, timeoutMs = DESCRIBE_TIMEOUT_MS) =>
    new Promise((resolveReply) => {
      if (exited) return resolveReply({ id: request.id, error: exited.message })
      const timer = setTimeout(() => {
        waiting.delete(request.id)
        child.kill('SIGKILL')
        resolveReply({ id: request.id, error: `no answer within ${timeoutMs / 1000} s` })
      }, timeoutMs)
      waiting.set(request.id, (reply) => {
        clearTimeout(timer)
        resolveReply(reply)
      })
      child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  return {
    ready,
    describe,
    close: () => {
      child.stdin.end()
      return done
    },
    kill: () => child.kill('SIGKILL'),
  }
}

const describeRun = async (describer, run, dir) => {
  const views = []
  for (const view of run.render.views) {
    const label = VIEW_LABELS[view.name] ?? view.name
    const reply = await describer.describe({ id: `${run.fixture}-${run.run}/${view.name}`, image: resolve(dir, view.path), prompt: viewPrompt(label, run.render.facts) })
    views.push({ name: view.name, label, reply })
  }
  const failed = views.filter(({ reply }) => typeof reply.text !== 'string')
  const { describeError: _describeError, votes: _votes, graderError: _graderError, ...rest } = run
  if (failed.length) {
    return settleRun({ ...rest, description: null, verdict: null, describeError: failed.map(({ name, reply }) => `${name}: ${reply.error ?? 'no text'}`).join('; ') })
  }
  const description = {
    text: describedText(views),
    views: views.map(({ name, reply }) => ({ name, text: reply.text.trim(), ms: reply.ms, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens })),
  }
  return settleRun({ ...rest, description, verdict: null })
}

// Every file is written as its runs finish, and again with the refused-connection count once the process ends.
export async function describeFiles(paths, { all = false, describer, log = () => {} }) {
  const hello = await describer.ready
  const outcome = { described: 0, failed: 0, blockedConnections: null }
  const written = []
  for (const path of paths) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    if (file.suite !== 'complex') {
      log(`describe: ${path} is not a complex result file; skipped`)
      continue
    }
    const runs = pendingRuns(file, { all })
    if (runs.length === 0) continue
    for (const run of runs) {
      const next = await describeRun(describer, run, dirname(path))
      file.results[file.results.indexOf(run)] = next
      outcome[next.describeError ? 'failed' : 'described'] += 1
      log(`describe: ${run.fixture}#${run.run} ${next.describeError ? `failed (${next.describeError})` : 'described'}`)
    }
    file.describer = { model: hello.model, kestrel: hello.kestrel, promptSha256: DESCRIBE_PROMPT_SHA256, blockedConnections: null }
    if (file.summary) file.summary = summarize(file.results)
    writeFileSync(path, JSON.stringify(file, null, 2))
    written.push([path, file])
  }
  const closed = await describer.close()
  outcome.blockedConnections = closed.blockedConnections
  if (!closed.done) outcome.crashed = closed.error
  for (const [path, file] of written) {
    file.describer.blockedConnections = closed.blockedConnections
    writeFileSync(path, JSON.stringify(file, null, 2))
  }
  return outcome
}

// A crash leaves the refused-connection count unknown, so it stops the judge as a refused connection does.
export const describeStop = ({ blockedConnections, crashed }) => {
  if (crashed) return `${crashed}; the outside connections it tried are unknown, so check kestrel before trusting it again`
  if (blockedConnections !== 0) return `the describer tried ${blockedConnections} outside connections, all refused; check kestrel before trusting it again`
  return null
}

const execText = (command, args) => execFileSync(command, args, { encoding: 'utf8' })

const loadedModels = async (fetch) => {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`)
    return res.ok ? ((await res.json()).models ?? []).map((m) => m.name) : []
  } catch {
    return []
  }
}

// Asks Ollama to unload every model it holds, and waits up to `settleMs` for it to.
export const unloadOllama = async ({ fetch = globalThis.fetch, settleMs = 10_000, pollMs = 500 } = {}) => {
  const names = await loadedModels(fetch)
  for (const model of names) {
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => null)
  }
  for (let waited = 0; names.length > 0 && waited < settleMs; waited += pollMs) {
    if ((await loadedModels(fetch)).length === 0) break
    await new Promise((resolveWait) => setTimeout(resolveWait, pollMs))
  }
  return names
}

export const freeGpu = async ({ fetch = globalThis.fetch, exec = execText, settleMs, pollMs } = {}) => {
  const unloaded = await unloadOllama({ fetch, settleMs, pollMs })
  const free = Number(exec('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits']).trim().split('\n')[0])
  if (free >= REQUIRED_FREE_MIB) return { ok: true, free, unloaded }
  const holders = exec('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader']).trim()
  return { ok: false, free, holders, unloaded }
}

export const describerHome = (env) => env.DESCRIBER_HOME || DEFAULT_DESCRIBER_HOME

const PASSED_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'CUDA_VISIBLE_DEVICES']

// Only what Python and CUDA need: the describer never sees a key or the eval's settings.
export const describerEnv = (env, home) => ({
  ...Object.fromEntries(PASSED_ENV.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
  HF_HOME: join(home, 'hf'),
  HF_HUB_OFFLINE: '1',
})

const countPending = (paths, all) => paths.reduce((n, path) => n + pendingRuns(JSON.parse(readFileSync(path, 'utf8')), { all }).length, 0)

// Frees the card, starts describe.py and describes every pending run; the GPU is left alone when there is nothing to do.
export const runDescribe = async (paths, { all = false, env = process.env, log = console.log } = {}) => {
  if (countPending(paths, all) === 0) {
    log('describe: nothing to describe')
    return { described: 0, failed: 0, blockedConnections: 0 }
  }
  const gpu = await freeGpu()
  if (!gpu.ok) {
    throw new Error(`${gpu.free} MiB free on the GPU; the describer needs ${REQUIRED_FREE_MIB}. Holding it:\n${gpu.holders || '(no compute processes listed)'}`)
  }
  const home = describerHome(env)
  const describer = startDescriber({ command: join(home, 'venv', 'bin', 'python'), args: [DESCRIBE_PY], env: describerEnv(env, home) })
  try {
    return await describeFiles(paths, { all, describer, log })
  } finally {
    describer.kill()
  }
}

const USAGE = 'Usage: npm run describe -w @jscadui/agent-loop -- [--all] <result files>'

// Exit 2 is a stop the judge must not run after; 1 only means some views failed (docs/user-manual.md).
const main = async (argv, env) => {
  const paths = argv.filter((arg) => !arg.startsWith('--'))
  if (paths.length === 0) {
    console.error(USAGE)
    process.exit(2)
  }
  try {
    const outcome = await runDescribe(paths, { all: argv.includes('--all'), env })
    console.log(`describe: ${outcome.described} described, ${outcome.failed} failed`)
    const stop = describeStop(outcome)
    if (stop) {
      console.error(`describe: ${stop}`)
      process.exit(2)
    }
    if (outcome.failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`describe: ${error.message}`)
    process.exit(2)
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
```

In `packages/agent-loop/package.json` `scripts`, add after `"grader-validate"` (with the comma the JSON needs):

```json
    "describe": "node --import ./text-loader.js eval/describe.js"
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/describe.test.js`
Expected: PASS.

- [ ] **Step 6: Add the describe stage to `grader-validate`**

In `packages/agent-loop/eval/grader-validate.js`, after `import { createRunRenderer } from './render.js'` add:

```js
import { describeStop, runDescribe } from './describe.js'
```

Replace `export const STAGES = ['render']` with `export const STAGES = ['render', 'describe']`.

Replace

```js
  console.log(`grader-validate: wrote ${path}`)
  const final = JSON.parse(readFileSync(path, 'utf8')).results
```

with

```js
  console.log(`grader-validate: wrote ${path}`)
  let stopped = false
  if (until !== 'render') {
    const described = await runDescribe([path], { env })
    const stop = describeStop(described)
    if (stop) console.error(`grader-validate: ${stop}`)
    if (stop || described.failed > 0) process.exitCode = 1
    stopped = stop !== null
  }
  const final = JSON.parse(readFileSync(path, 'utf8')).results
```

A view that failed to describe fails the job (exit 1), and a stop (a crash or a refused connection) also keeps the judge stage (Task 8) from running.

In `ci/grader-validate` nothing changes; its `UNTIL` default stays `render` until Task 8.

- [ ] **Step 7: Document the describe stage, and add the backlog items**

In `packages/agent-loop/docs/user-manual.md`, insert before `### Grader validation`:

````markdown
### Describe and judge

A complex pass's runs are described and judged after the lanes finish, once
over every result file:

```bash
npm run describe -w @jscadui/agent-loop -- [--all] <result files>
```

npm runs it in `packages/agent-loop`, so give absolute paths. It frees the
GPU first: it asks Ollama on `127.0.0.1:11434` to unload every model it holds
(`keep_alive: 0`), then reads the card's free memory from `nvidia-smi`. Below
11,800 MiB it stops, naming the free amount and the processes holding the
card, and leaves the runs undescribed; running it again on the same files
finishes them. Then one describer process (`DESCRIBER_HOME/venv`, default
`/data/moondream3`; setup in `ci/README.md`) loads Moondream 3.1 once and
describes each view of every rendered run with no description:

> This is the {front three-quarter view | back three-quarter view | side
> view}. Overall size {W}×{D}×{H} mm, {N} parts.
>
> Describe the object in these renders: what it most likely is, its main
> parts and how they're arranged, colours, and anything that looks broken or
> odd. Plain text, under 150 words. Do not guess a purpose you can't see.

`N` is the `bodies` probe's count. The run's `description` is `{ text, views:
[{ name, text, ms, inputTokens, outputTokens }] }`, `text` the three replies
one per line as `{view label}: {reply}`. A run with a view that failed gets
`describeError` naming it and no description; the judge skips it, and the
next `npm run describe` on the file tries it again. The file records
`describer: { model, kestrel, promptSha256, blockedConnections }`; the
describer refuses every outside connection. `--all` describes every rendered
run again and clears its votes and verdict, so run the judge on the same
files after it. The describer never sees the prompt, the transcript, the
source, file names or parameter names, since any of them can name the object.

It exits 0 when every pending run was described, and 1 when it finished but
a view failed; the judge can run after either. It exits 2 when it stopped in
a way the judge must not run after: no files given, less than 11,800 MiB
free, a describer that did not start or died before it finished (its
refused-connection count is then unknown, `blockedConnections: null`), or any
refused outside connection. The descriptions already written are kept.
````

In the `### Environment variables` table, after the `GRADER_VALIDATION_DIR` row add:

```markdown
| `DESCRIBER_HOME` | the describer's venv (`venv/`) and weights (`hf/`), default `/data/moondream3` |
```

In the `### Grader validation` text, replace

```markdown
builds each case in the crt sandbox with the `bodies` probe, renders it, and
prints each case's failed gates against the expected result and where its
renders are; it exits 1 when `exploded` does not fail `connected`.
```

with

```markdown
builds each case in the crt sandbox with the `bodies` probe, renders it,
describes it, and prints each case's failed gates against the expected result
and its description; it exits 1 when `exploded` does not fail `connected`,
when a view fails to describe, or when the describe stage stops (a crash or a
refused connection, which it prints). `--until render` stops after rendering.
```

In `packages/agent-loop/docs/architecture.md`, `## Complex grading`, replace its opening paragraph

```markdown
A `complex` fixture's geometry grade comes from a verdict on renders of the
result ([user-manual.md](user-manual.md#complex-fixtures)).
```

with

```markdown
A `complex` fixture's geometry grade comes from a verdict on renders of the
result ([user-manual.md](user-manual.md#complex-fixtures)), in three stages.
Stage A runs in each `run-eval` lane: the conversation, the grade in a fresh
executor with the `bodies` probe, the same executor's `mesh` reply, the gates,
and three renders. Stage B (`eval/describe.js`) runs once over the pass's
result files: one describer process loads the model once and describes every
rendered run. Stage C (`eval/judge.js`) judges every described run. Keeping
B out of the lanes keeps the GPU out of them: the model loads once per pass
and no lane waits on it. It also makes describing and judging again the same
commands on older files.

The describer sees only the renders, the model's size and its part count,
never the prompt, transcript, source, file names or parameter names, since any
of them can name the object (`cupolaHeight`).
```

In `docs/backlog.md`, `## Chat API help`, append three items at the end of its list (before `## Refactoring`):

```markdown
- GPU sharing on the CI host (agent-loop eval). The describer needs about
  11.8 GB of the 12 GB card, so `npm run describe` stops while
  chatterbox-tts, an Ollama model it could not unload, or a CI job holds it.
  A lease the describer, Ollama, chatterbox-tts and CI jobs take turns on
  would let a complex pass describe without a person freeing the card.
- The describer's blind spot for open or missing tops (agent-loop eval).
  Moondream called the caboose with its roofs removed intact
  (`no-roof` in `eval/grader-validation/cases.js`), and asking it about
  missing or floating parts made it call broken models intact. No gate
  catches an open top either; a gate on the top cut, a ring where a closed
  object has a solid, would, for requests whose objects are closed.
- A cap on the `bodies` probe (agent-loop eval, `eval/probe.js`). It lists
  every body with no limit, so a model of about 5,000 bodies pushes the grade
  reply past the executor's 1 MiB cap; the whole grade becomes `NO_GRADE` and
  a complex run fails `builds` with no word on why. A cap that reports the
  count and drops the list past it would keep the grade and name the cause.
  No complex fixture comes near it.
```

- [ ] **Step 8: Commit**

```bash
git add packages/agent-loop/eval/describe.js packages/agent-loop/eval/fake-describer.js packages/agent-loop/eval/describe.test.js packages/agent-loop/eval/grader-validate.js packages/agent-loop/package.json packages/agent-loop/docs/user-manual.md packages/agent-loop/docs/architecture.md docs/backlog.md
```

```bash
git commit -m "feat(eval): describe stage for complex runs, with a GPU check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

- [ ] **Step 9: Rollout gate (spec step 2, on the CI host)**

Run `scripts/describer-setup.sh` on the host once (as the user who owns `/data`), then `sci push jscadui/grader-validate` with `UNTIL=describe` edited into `ci/grader-validate`. Expected: `describer: ready`, the job exits 0 (no failed view, no refused connection, no crash), and each case's per-view texts equal the trial's (Moondream is deterministic at temperature 0; the trial's renders came from the same renderer, with `front-34`/`back-34` for `iso-front`/`iso-back`). The trial's texts, `front three-quarter`, `back three-quarter`, `side` in order:

- caboose: "This is a red caboose with black trim, light blue windows, and a brown door. The roof is dark gray and angled. The wheels are black with red rims. The image is a 3D isometric view with no visible parts broken or odd." / "This is a red caboose with black wheels, a dark gray roof, and white-framed windows. A brown door is visible on the side. The caboose has a black chimney and a small black step at the rear. The overall design is isometric and stylized." / "This is a stylized caboose rendered in pixel art style. It has a red body with a gray roof and dark gray wheels with red hubs. Two light blue windows are visible on the front, and a brown door is centered. The caboose is positioned horizontally on a light gray background."
- delivery-truck: "This is a 3D isometric rendering of a delivery truck. The cab is blue with a light blue windshield and headlights. The cargo area is white and rectangular. The truck has black wheels with silver rims and tires. The background is plain gray." / "This is a 3D isometric render of a delivery truck. The cab is blue with a light blue window. The cargo area is white. The truck has black wheels and dark gray undercarriage. The background is light gray. No visible parts are broken or odd." / "This is a side view of a blue delivery truck. The cab is blue with a single window on the side. The truck bed is white and rectangular. The wheels are black with gray rims. The truck is positioned horizontally on a light gray background."
- plain-box: "This is a red rectangular box with black wheels and base, viewed from a three-quarter angle. The box is positioned horizontally on a flat surface. The wheels are black with red centers. The base is black. The image is flat and vector-like, with no textures, reflections, or signs of wear." / "This is a red rectangular box on wheels, viewed from the side. The box is mounted on a dark gray platform with four black wheels, each with a red circle in the center. The box is flat and rectangular, with no visible handles, wheels, or protrusions. The background is plain gray." / "This is a flat, rectangular cart or wagon with a solid red body. It has a dark gray or black frame along the bottom edge and sides, and black wheels with red centers. The wheels are positioned side by side, facing forward. The cart is isolated on a plain gray background with no other objects or details."
- exploded: "This is a red caboose-style vehicle with a two-story gray roof and four black wheels with red hubs. The body is a single, continuous red structure with four rectangular windows and a brown door. The roof is angled and flat. The wheels are positioned under the vehicle’s body. The image is a 3D isometric rendering with no visible mechanical parts or damage." / "This is a red caboose-style vehicle with a dark gray roof and roof rails. It has four black wheels with red hubs, a brown door in the center, and four windows arranged symmetrically. The roof has a small black chimney or vent. The vehicle is angled slightly, presenting a three-quarter view." / "This is a side view of a red train car with four windows and a brown door. The car is positioned horizontally on a light gray background. Above the car is a gray roof section with small windows and a black chimney-like protrusion. The wheels are black with red rims. The overall design is simple and blocky, with flat colors and minimal detail."
- no-roof: "This is a red toy train with black wheels, red lights, and light blue windows. The roof is two-tiered with small windows and a black chimney. The front has a brown door and side windows. The overall design is isometric and stylized." / "This is a red, two-story cabin with black wheels, a brown door, and white-framed windows. A black chimney is visible on the roof. The cabin is angled slightly, viewed from a side-angled perspective." / "This is a side view of a red caboose with black wheels and a brown door. The caboose has four light blue windows arranged symmetrically, a black chimney, and black fenders at the front and back. The overall dimensions are 111×41×62 mm, with 58 visible parts."

A text that differs is not by itself a failure (the trial's 768-token cap is 300 here), but a different object name is: report it to the user.

Then repeat the Task 5 regrade check: on the CI host, copy the current baseline result files to a scratch directory, run `npm run eval -w @jscadui/agent-loop -- --regrade <copies>` there, and confirm with `git diff --no-index` against the originals that only `regradedAt` changed. Stop and report before Task 8.

---

### Task 8: `npm run judge`

**Files:**
- Modify: `packages/agent-loop/src/providers.js`
- Modify: `packages/agent-loop/test/providers.test.js` (append)
- Create: `packages/agent-loop/eval/judge.js`
- Create: `packages/agent-loop/eval/judge.test.js`
- Modify: `packages/agent-loop/eval/grader-validate.js` (judge stage), `ci/grader-validate` (default stage)
- Modify: `packages/agent-loop/package.json` (scripts)
- Modify: `packages/agent-loop/docs/user-manual.md`, `packages/agent-loop/docs/architecture.md`

**Model:** `sonnet` — given code, but it touches the shared provider adapter.

**Interfaces:**
- Consumes: `createProvider` (`src/providers.js`), `resolveCredentials` (`eval/credentials.js`), `runPool` (`eval/parallel.js`), `settleRun` (Task 3), `summarize`.
- Produces:
  - `createProvider({ ..., temperature?, maxTokens? })`: the openai chat-completions adapter sends `temperature` and `max_tokens` only when set.
  - `eval/judge.js`: `JUDGE = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`, `JUDGE_CALLS = 3`, `JUDGE_MAX_TOKENS = 150`, `JUDGE_QUESTION`, `judgePrompt(messages, description) → string`, `JUDGE_PROMPT_SHA256`, `parseVote(text) → { success, reason } | null`, `castVote(provider, prompt, now) → Promise<{ success: boolean|null, reason, ms }>`, `verdictOf(votes) → { success, votes: [yes, no] } | null`, `unjudgedRuns(file, { all })`, `judgeRun(run, { makeProvider, now }) → Promise<run>`, `judgeFiles(paths, { all, makeProvider, log, concurrency, now }) → Promise<{ judged, graderErrors }>`, `judgeProviderFactory() → () => provider`.
  - A judged run gains `votes`, `verdict` (or `graderError: true` with `verdict: null`); the file gains `judge: { provider, model, promptSha256 }`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `packages/agent-loop/test/providers.test.js` (`fetchMock`, `sseBody` and `createProvider` are in scope):

```js
describe('openai request settings', () => {
  const empty = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`

  it('sends temperature and max_tokens only when the config sets them', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody(empty)))
    const judge = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'deepseek-v4.1-flash', baseUrl: 'https://relay.test', effort: 'none', temperature: 0, maxTokens: 150 })
    for await (const e of judge.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'none', temperature: 0, max_tokens: 150 })
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response(sseBody(empty)))
    const plain = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'deepseek-v4.1-flash', baseUrl: 'https://relay.test' })
    for await (const e of plain.send([{ role: 'user', content: 'hi' }], [])) void e
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
  })
})
```

Create `packages/agent-loop/eval/judge.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { castVote, JUDGE, JUDGE_PROMPT_SHA256, judgeFiles, judgePrompt, parseVote, unjudgedRuns, verdictOf } from './judge.js'

// A scripted judge in the shape of eval/fake-provider.js: each reply in order, an Error thrown as a provider failure.
const replies = (...texts) => {
  const queue = [...texts]
  return () => ({
    async *send() {
      const next = queue.shift()
      if (next instanceof Error) throw next
      yield { type: 'text', text: next ?? '' }
      yield { type: 'done', stopReason: 'stop' }
    },
  })
}
const clock = () => {
  let t = 0
  return () => (t += 100)
}

const described = (overrides = {}) => ({
  fixture: 'caboose',
  run: 1,
  userMessages: ['we need a model of a toy caboose'],
  gates: [
    { name: 'builds', pass: true },
    { name: 'watertight', pass: true },
    { name: 'connected', pass: true, groups: 1 },
  ],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.75 },
  render: { meshSha256: 'a'.repeat(64), facts: { dimensions: [111, 41, 67], bodies: 62 }, views: [] },
  description: { text: 'side view: a red caboose', views: [] },
  verdict: null,
  verdictPending: true,
  ...overrides,
})
const fileWith = (runs) => {
  const path = join(mkdtempSync(join(tmpdir(), 'judge-test-')), 'r.json')
  writeFileSync(path, JSON.stringify({ suite: 'complex', summary: [], results: runs }))
  return path
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

describe('the judge prompt', () => {
  it('quotes each user message, then the description, then the question', () => {
    expect(judgePrompt(['a model rocket about 20cm tall', 'can you make it two stages, with fins only on the bottom one'], 'side view: a rocket')).toBe(
      'The user\'s message(s):\n"a model rocket about 20cm tall"\n"can you make it two stages, with fins only on the bottom one"\n\nA description of the result:\nside view: a rocket\n\nDid the result succeed at what the user asked for? Answer SUCCESS only if the user who made the request would accept the model as what they asked for. A generic shape, missing major parts, or parts floating apart are FAILURE. Answer SUCCESS or FAILURE, then one line why.',
    )
    expect(JUDGE_PROMPT_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('votes', () => {
  it('takes the first SUCCESS or FAILURE and the rest as the reason', () => {
    expect(parseVote('SUCCESS — the model is a recognizable toy caboose')).toEqual({ success: true, reason: 'the model is a recognizable toy caboose' })
    expect(parseVote('**FAILURE**: a plain red box')).toEqual({ success: false, reason: 'a plain red box' })
    expect(parseVote('FAILURE - x'.padEnd(300, 'y')).reason).toHaveLength(200)
    expect(parseVote('I think it is fine')).toBeNull()
  })

  it('asks again after a reply with neither word or a provider error, up to twice', async () => {
    expect(await castVote(replies('hmm', 'FAILURE - no roof')(), 'p', clock())).toEqual({ success: false, reason: 'no roof', ms: 100 })
    expect((await castVote(replies(new Error('status 500'), 'SUCCESS — fine')(), 'p')).success).toBe(true)
    expect(await castVote(replies('eh', 'eh', 'still unsure')(), 'p', clock())).toEqual({ success: null, reason: 'still unsure', ms: 100 })
  })

  it('needs two agreeing votes for a verdict', () => {
    const v = (success) => ({ success })
    expect(verdictOf([v(true), v(true), v(false)])).toEqual({ success: true, votes: [2, 1] })
    expect(verdictOf([v(false), v(false), v(false)])).toEqual({ success: false, votes: [0, 3] })
    expect(verdictOf([v(true), v(false), v(null)])).toBeNull()
    expect(verdictOf([v(true), v(null), v(null)])).toBeNull()
  })
})

describe('unjudgedRuns', () => {
  it('picks described runs with no verdict, or every described run with all', () => {
    const file = {
      suite: 'complex',
      results: [described(), described({ verdict: { success: true, votes: [3, 0] } }), described({ description: null }), described({ graderError: true }), described({ renderStale: true })],
    }
    expect(unjudgedRuns(file)).toEqual([file.results[0]])
    expect(unjudgedRuns(file, { all: true })).toEqual([file.results[0], file.results[1], file.results[3]])
  })
})

describe('judgeFiles', () => {
  it('records the votes and the majority, and settles geometry and the summary', async () => {
    const path = fileWith([described()])
    const outcome = await judgeFiles([path], { makeProvider: replies('SUCCESS — a caboose', 'SUCCESS — yes', 'FAILURE — no cupola'), concurrency: 1 })
    expect(outcome).toEqual({ judged: 1, graderErrors: 0 })
    const file = read(path)
    const [run] = file.results
    expect(run.votes.map((v) => v.success)).toEqual([true, true, false])
    expect(run.verdict).toEqual({ success: true, votes: [2, 1] })
    expect(run.verdictPending).toBeUndefined()
    expect(run.report.dimensions.geometry).toBe(2)
    expect(run.report.total).toBe(8)
    expect(run.report.checkRate).toBe(1)
    expect(file.judge).toEqual({ provider: JUDGE.provider, model: JUDGE.model, promptSha256: JUDGE_PROMPT_SHA256 })
    expect(file.summary[0].verdictRate).toBe(1)
  })

  it('marks a split judge as a graderError with no verdict', async () => {
    const path = fileWith([described()])
    const outcome = await judgeFiles([path], { makeProvider: replies('SUCCESS', 'FAILURE', 'eh', 'eh', 'eh'), concurrency: 1 })
    expect(outcome).toEqual({ judged: 0, graderErrors: 1 })
    const [run] = read(path).results
    expect(run.graderError).toBe(true)
    expect(run.verdict).toBeNull()
    expect(run.verdictPending).toBeUndefined()
    expect(run.report.dimensions.geometry).toBe(0)
  })

  it('judges a judged run again only with all', async () => {
    const path = fileWith([described({ verdict: { success: true, votes: [3, 0] }, verdictPending: undefined })])
    expect(await judgeFiles([path], { makeProvider: replies() })).toEqual({ judged: 0, graderErrors: 0 })
    await judgeFiles([path], { all: true, makeProvider: replies('FAILURE — box', 'FAILURE — box', 'FAILURE — box'), concurrency: 1 })
    expect(read(path).results[0].verdict).toEqual({ success: false, votes: [0, 3] })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/judge.test.js test/providers.test.js`
Expected: FAIL, `judge.js` cannot be resolved and the request body has no `temperature`.

- [ ] **Step 3: Add `temperature` and `maxTokens` to the openai adapter**

In `packages/agent-loop/src/providers.js`, in `openaiProvider`, replace

```js
      if (config.effort) body.reasoning_effort = config.effort
      if (config.kind === 'openai' || config.kind === 'opencode-go') body.stream_options = { include_usage: true }
```

with

```js
      if (config.effort) body.reasoning_effort = config.effort
      if (config.temperature !== undefined) body.temperature = config.temperature
      if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens
      if (config.kind === 'openai' || config.kind === 'opencode-go') body.stream_options = { include_usage: true }
```

and replace the JSDoc line

```js
 * @param {{kind:'anthropic'|'openai'|'opencode-go'|'meta',apiKey:string,model:string,baseUrl?:string,sessionId?:string,effort?:string,chatId?:string}} config
```

with

```js
 * @param {{kind:'anthropic'|'openai'|'opencode-go'|'meta',apiKey:string,model:string,baseUrl?:string,sessionId?:string,effort?:string,chatId?:string,temperature?:number,maxTokens?:number}} config
```

- [ ] **Step 4: Write `eval/judge.js`**

```js
// Usage: npm run judge -w @jscadui/agent-loop -- [--all] <result files>
// Stage C of the complex eval (docs/architecture.md, The judge); npm runs it in packages/agent-loop, so give absolute paths.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isMainModule } from '../src/mainModule.js'
import { createProvider } from '../src/providers.js'
import { settleRun } from './complex.js'
import { resolveCredentials } from './credentials.js'
import { runPool } from './parallel.js'
import { summarize } from './report.js'

export const JUDGE = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
export const JUDGE_CALLS = 3
export const JUDGE_MAX_TOKENS = 150
const MAX_ATTEMPTS = 3
const REASON_CHARS = 200
const JUDGE_CONCURRENCY = 8

export const JUDGE_QUESTION =
  'Did the result succeed at what the user asked for? Answer SUCCESS only if the user who made the request would accept the model as what they asked for. A generic shape, missing major parts, or parts floating apart are FAILURE. Answer SUCCESS or FAILURE, then one line why.'

export const judgePrompt = (messages, description) =>
  `The user's message(s):\n${messages.map((m) => `"${m}"`).join('\n')}\n\nA description of the result:\n${description}\n\n${JUDGE_QUESTION}`

export const JUDGE_PROMPT_SHA256 = createHash('sha256').update(judgePrompt(['{message}'], '{description}')).digest('hex')

export const parseVote = (text) => {
  const found = /SUCCESS|FAILURE/.exec(text ?? '')
  if (!found) return null
  const reason = text
    .slice(found.index + found[0].length)
    .replace(/^[\s*:.,;—–-]+/, '')
    .trim()
    .slice(0, REASON_CHARS)
  return { success: found[0] === 'SUCCESS', reason }
}

const replyOf = async (provider, prompt) => {
  let text = ''
  for await (const event of provider.send([{ role: 'user', content: prompt }], [])) {
    if (event.type === 'text') text += event.text
  }
  return text
}

// A reply with neither word, or a provider error that outlived the adapter's own retries, is asked again up to twice.
export const castVote = async (provider, prompt, now = () => performance.now()) => {
  const started = now()
  let last = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      last = await replyOf(provider, prompt)
    } catch (error) {
      last = `provider error: ${error.message}`
      continue
    }
    const vote = parseVote(last)
    if (vote) return { ...vote, ms: Math.round(now() - started) }
  }
  return { success: null, reason: last.trim().slice(0, REASON_CHARS), ms: Math.round(now() - started) }
}

export const verdictOf = (votes) => {
  const yes = votes.filter((v) => v.success === true).length
  const no = votes.filter((v) => v.success === false).length
  return Math.max(yes, no) < 2 ? null : { success: yes > no, votes: [yes, no] }
}

export const unjudgedRuns = (file, { all = false } = {}) =>
  file?.suite !== 'complex'
    ? []
    : file.results.filter((r) => typeof r.description?.text === 'string' && !r.renderStale && (all || (r.verdict == null && !r.graderError)))

export const judgeRun = async (run, { makeProvider, now }) => {
  const prompt = judgePrompt(run.userMessages ?? [], run.description.text)
  const votes = []
  for (let call = 0; call < JUDGE_CALLS; call += 1) votes.push(await castVote(makeProvider(), prompt, now))
  const verdict = verdictOf(votes)
  const { graderError: _graderError, ...rest } = run
  return settleRun({ ...rest, votes, verdict, ...(verdict ? {} : { graderError: true }) })
}

export async function judgeFiles(paths, { all = false, makeProvider, log = () => {}, concurrency = JUDGE_CONCURRENCY, now } = {}) {
  const outcome = { judged: 0, graderErrors: 0 }
  for (const path of paths) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    if (file.suite !== 'complex') {
      log(`judge: ${path} is not a complex result file; skipped`)
      continue
    }
    const runs = unjudgedRuns(file, { all })
    if (runs.length === 0) continue
    await runPool(runs, concurrency, async (run) => {
      const judged = await judgeRun(run, { makeProvider, now })
      file.results[file.results.indexOf(run)] = judged
      outcome[judged.graderError ? 'graderErrors' : 'judged'] += 1
      const said = judged.verdict ? `${judged.verdict.success ? 'SUCCESS' : 'FAILURE'} ${judged.verdict.votes.join('-')}` : 'no majority (graderError)'
      log(`judge: ${run.fixture}#${run.run} ${said}`)
    })
    file.judge = { provider: JUDGE.provider, model: JUDGE.model, promptSha256: JUDGE_PROMPT_SHA256 }
    if (file.summary) file.summary = summarize(file.results)
    writeFileSync(path, JSON.stringify(file, null, 2))
  }
  return outcome
}

// The key comes from the same keys.json lookup as the eval's providers and never leaves this process.
export const judgeProviderFactory = () => {
  const { apiKey, baseUrl } = resolveCredentials({ EVAL_PROVIDER: JUDGE.provider })
  if (!apiKey) throw new Error(`no ${JUDGE.provider} key: put it in ~/.config/jscad-chat/keys.json (or point JSCAD_CHAT_KEYS at one)`)
  return () => createProvider({ kind: JUDGE.provider, model: JUDGE.model, apiKey, baseUrl, effort: 'none', temperature: 0, maxTokens: JUDGE_MAX_TOKENS })
}

const USAGE = 'Usage: npm run judge -w @jscadui/agent-loop -- [--all] <result files>'

const main = async (argv) => {
  const paths = argv.filter((arg) => !arg.startsWith('--'))
  if (paths.length === 0) {
    console.error(USAGE)
    process.exit(1)
  }
  try {
    const outcome = await judgeFiles(paths, { all: argv.includes('--all'), makeProvider: judgeProviderFactory(), log: console.log })
    console.log(`judge: ${outcome.judged} judged, ${outcome.graderErrors} with no majority`)
  } catch (error) {
    console.error(`judge: ${error.message}`)
    process.exit(1)
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2))
}
```

In `packages/agent-loop/package.json` `scripts`, add after `"describe"` (with the comma the JSON needs):

```json
    "judge": "node --import ./text-loader.js eval/judge.js"
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/judge.test.js test/providers.test.js`
Expected: PASS.

- [ ] **Step 6: Add the judge stage to `grader-validate`**

In `packages/agent-loop/eval/grader-validate.js`, after `import { runDescribe } from './describe.js'` add:

```js
import { judgeFiles, judgeProviderFactory } from './judge.js'
```

Replace `export const STAGES = ['render', 'describe']` with `export const STAGES = ['render', 'describe', 'judge']`.

Replace

```js
  const final = JSON.parse(readFileSync(path, 'utf8')).results
```

with

```js
  if (until === 'judge' && !stopped) await judgeFiles([path], { makeProvider: judgeProviderFactory(), log: console.log })
  const final = JSON.parse(readFileSync(path, 'utf8')).results
```

Replace the two-line usage comment at the top of the file with:

```js
// Usage: npm run grader-validate -w @jscadui/agent-loop [-- --until render|describe]
// Builds, renders, describes and judges each case in eval/grader-validation/cases.js (docs/user-manual.md, Grader validation).
```

In `ci/grader-validate`, replace `UNTIL="${GRADER_VALIDATE_UNTIL:-render}"` with `UNTIL="${GRADER_VALIDATE_UNTIL:-judge}"`, and in its header comment replace `# Builds, renders (and in later stages describes and judges) the` with `# Builds, renders, describes and judges the`.

- [ ] **Step 7: Document the judge**

In `packages/agent-loop/docs/user-manual.md`, `### Describe and judge`, append after its last paragraph (ending `The descriptions already written are kept.`):

````markdown
```bash
npm run judge -w @jscadui/agent-loop -- [--all] <result files>
```

makes three calls per described run with no verdict to DeepSeek v4.1 flash
through opencode-go (`reasoning_effort: "none"`, temperature 0, at most 150
output tokens), with the key from the same `keys.json` lookup as the eval's
providers ([Provider keys](#provider-keys)):

> The user's message(s):
> "{message 1}"
> "{message 2}"
>
> A description of the result:
> {description}
>
> Did the result succeed at what the user asked for? Answer SUCCESS only if
> the user who made the request would accept the model as what they asked
> for. A generic shape, missing major parts, or parts floating apart are
> FAILURE. Answer SUCCESS or FAILURE, then one line why.

The user's messages are the run's `userMessages`. A vote is the first
`SUCCESS` or `FAILURE` in the reply and the rest, trimmed to 200 characters,
its reason; a reply with neither word, or a provider error, is asked again up
to twice, then the vote is null. The run gets `votes: [{ success, reason, ms
}]` and `verdict: { success, votes: [for, against] }`, the majority of three
non-null votes; with fewer than two agreeing votes it gets `graderError: true`
and `verdict: null`, and stays out of the means. Geometry, `checkRate`, the
total and the file's summary are recomputed, and the file records `judge: {
provider, model, promptSha256 }`. `--all` judges every described run again,
after a change to the judge's prompt or model. The judge never sees the
assistant's text, tool calls, source or renders: a model that writes "here is
your caboose" over a box gains nothing. It exits 1 when it cannot run (no
`opencode-go` key, a file it cannot read) and 0 otherwise; a run with no
majority is a `graderError`, not a failed stage.
````

In `### Grader validation`, replace

```markdown
builds each case in the crt sandbox with the `bodies` probe, renders it,
describes it, and prints each case's failed gates against the expected result
and its description; it exits 1 when `exploded` does not fail `connected`,
when a view fails to describe, or when the describe stage stops (a crash or a
refused connection, which it prints). `--until render` stops after rendering.
```

with

```markdown
builds each case in the crt sandbox with the `bodies` probe, renders it,
describes and judges it (three judge calls), and prints each case's failed
gates, verdict and votes against the expected result, then its description;
it exits 1 when a scored case does not match or a view fails to describe. When
the describe stage stops (a crash or a refused connection, which it prints) it
exits 1 without judging. `--until render` or `--until describe` stops early.
It needs the GPU, so it runs on the CI host (`sci push
jscadui/grader-validate`, `ci/README.md`). Every scored case must match before
a change to either prompt, either model or the renderer is kept.
```

In `packages/agent-loop/docs/architecture.md`, `## Complex grading`, add after the `### The describer` subsection:

```markdown
### The judge

`eval/judge.js` asks DeepSeek v4.1 flash through opencode-go, the path
`src/providers.js` already takes for it, in the Node process with the key from
`keys.json`, never in an executor. It reads only the user's messages and the
blind description. DeepSeek is also a model under test; judging only the
request and a blind description of the result, it cannot favour its own
habits beyond its idea of the object, and in the trial that idea agreed with
qwen3.5:9b's on every case with a clear answer. Neither judge passed the
delivery-truck control in 70 tries; with this prompt neither passed the plain
box, and the real caboose passed 6 of 6 on Moondream's per-view descriptions.
On Moondream's shorter `caption` output DeepSeek failed the real caboose
("views inconsistent"), which is why the describer answers the per-view
prompt.
```

In `## Providers`, insert before `## Tool protocol`:

```markdown
The chat-completions adapter also sends `temperature` and `max_tokens` when
the config sets `temperature` and `maxTokens`. Only the eval's judge does; no
chat or tested model's request carries them.
```

- [ ] **Step 8: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/test/providers.test.js packages/agent-loop/eval/judge.js packages/agent-loop/eval/judge.test.js packages/agent-loop/eval/grader-validate.js ci/grader-validate packages/agent-loop/package.json packages/agent-loop/docs/user-manual.md packages/agent-loop/docs/architecture.md
```

```bash
git commit -m "feat(eval): judge stage for complex runs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 9: `npm run describe -- --rerender`

**Files:**
- Create: `packages/agent-loop/eval/rerender.js`
- Create: `packages/agent-loop/eval/rerender.test.js`
- Modify: `packages/agent-loop/eval/describe.js` (flag)
- Modify: `packages/agent-loop/docs/user-manual.md`

**Model:** `sonnet` — small module over pieces that exist.

**Interfaces:**
- Consumes: `complexProbe`, `renderRecord`, `settleRun` (Task 3), `gradedModel` (grade.js), `summarize` (report.js), `createRunRenderer` (Task 2), `fixtureForApi`, `freshExecutorGrader`, `GRADE_LIFETIME_S`, `loadFixtures`, `requireSandbox` (run-eval.js), `startExecutor` (sandbox.js).
- Produces: `rerenderFile(file, { grader, renderer, fixturesByName }) → Promise<file>` (each `renderStale` run built again with its mesh and rendered; `renderStale` and `regradeNote` cleared; `verdictPending` stays; a file with a `summary` gets it recomputed, since a run that no longer builds gains `renderError` and leaves the pending count), `rerenderedCount(before, after) → number` (stale runs that now have renders), `rerenderFiles(paths, env) → Promise<number>` (the runs rendered again, not counting ones that could not be).

- [ ] **Step 1: Write the failing test**

Create `packages/agent-loop/eval/rerender.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { summarize } from './report.js'
import { rerenderedCount, rerenderFile } from './rerender.js'
import { VIEWS } from './views.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const BROKEN = 'module.exports = { main: () => { throw new Error("nope") } }'
const fixture = { name: 'cube', group: 'complex', prompt: 'a cube please', requires: ['write'], verifyBeforeWrite: false, maxTurns: 8, gates: () => [] }
const transcript = [
  { role: 'user', content: 'a cube please' },
  { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: CUBE } }] },
  { role: 'tool', toolCallId: 't1', content: JSON.stringify({ ok: true }) },
  { role: 'assistant', content: 'done', toolCalls: [] },
]
const stale = {
  fixture: 'cube',
  run: 1,
  transcript,
  gates: [{ name: 'builds', pass: true }],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.5 },
  render: { meshSha256: 'new', facts: { dimensions: [20, 20, 20], bodies: 1 }, views: [] },
  renderStale: true,
  regradeNote: 'the mesh changed; its renders and verdict are stale',
  description: null,
  verdict: null,
  verdictPending: true,
}
const renderer = () => {
  const calls = []
  return {
    calls,
    render: async (_parts, where) => {
      calls.push(where)
      return VIEWS.map((v) => ({ name: v.name, path: `r.renders/${where.fixture}-${where.run}/${v.name}.png`, sha256: 'c'.repeat(64) }))
    },
  }
}

describe('rerenderFile', () => {
  it('renders a stale run again and leaves it waiting for a description', async () => {
    const r = renderer()
    const file = { suite: 'complex', api: 'fluent', results: [stale, { ...stale, run: 2, renderStale: undefined }] }
    const out = await rerenderFile(file, { grader: createEvalBackend(), renderer: r, fixturesByName: new Map([['cube', fixture]]) })
    expect(r.calls).toEqual([{ fixture: 'cube', run: 1 }])
    const [run, untouched] = out.results
    expect(run.render.views).toHaveLength(3)
    expect(run.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(run.render.facts).toEqual({ dimensions: [20, 20, 20], bodies: 1 })
    expect(run).not.toHaveProperty('renderStale')
    expect(run).not.toHaveProperty('regradeNote')
    expect(run.verdictPending).toBe(true)
    expect(untouched).toBe(file.results[1])
  })

  it('notes a run whose fixture no longer exists', async () => {
    const out = await rerenderFile({ suite: 'complex', results: [stale] }, { grader: createEvalBackend(), renderer: renderer(), fixturesByName: new Map() })
    expect(out.results[0].regradeNote).toMatch(/cannot render again/)
    expect(out.results[0].renderStale).toBe(true)
  })

  it('counts only the runs rendered again and recomputes the summary', async () => {
    const broken = { ...stale, run: 2, transcript: transcript.map((m) => (m.toolCalls?.length ? { ...m, toolCalls: [{ ...m.toolCalls[0], input: { path: 'main.js', content: BROKEN } }] } : m)) }
    const missing = { ...stale, run: 3, fixture: 'gone' }
    const file = { suite: 'complex', api: 'fluent', summary: [], results: [stale, broken, missing] }
    const out = await rerenderFile(file, { grader: createEvalBackend(), renderer: renderer(), fixturesByName: new Map([['cube', fixture]]) })
    expect(out.results[1].renderError).toBeDefined()
    expect(out.results[1].verdictPending).toBeUndefined()
    expect(rerenderedCount(file, out)).toBe(1)
    expect(out.summary).toEqual(summarize(out.results))
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --root packages/agent-loop eval/rerender.test.js`
Expected: FAIL, `rerender.js` cannot be resolved.

- [ ] **Step 3: Write `eval/rerender.js`**

```js
// `npm run describe -- --rerender`: builds again, in the sandbox, and renders each run
// whose mesh changed at --regrade (`renderStale`), before the describe stage describes it.
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_API } from '../src/api.js'
import { complexProbe, renderRecord, settleRun } from './complex.js'
import { gradedModel } from './grade.js'
import { createRunRenderer } from './render.js'
import { summarize } from './report.js'
import { fixtureForApi, freshExecutorGrader, GRADE_LIFETIME_S, loadFixtures, requireSandbox } from './run-eval.js'
import { startExecutor } from './sandbox.js'

export async function rerenderFile(file, { grader, renderer, fixturesByName }) {
  const api = file.api ?? DEFAULT_API
  const results = []
  for (const run of file.results) {
    if (!run.renderStale) {
      results.push(run)
      continue
    }
    const fixture = fixtureForApi(fixturesByName.get(run.fixture), api)
    if (!fixture || !Array.isArray(run.transcript)) {
      results.push({ ...run, regradeNote: 'cannot render again: the fixture or the transcript is missing' })
      continue
    }
    const graded = await grader.gradeProject(gradedModel(fixture, run.transcript), { probe: complexProbe(fixture), mesh: true })
    const { renderStale: _stale, regradeNote: _note, ...rest } = run
    if (!graded.mesh?.parts) {
      results.push(settleRun({ ...rest, renderError: graded.mesh?.error ?? 'the project no longer builds' }))
      continue
    }
    const views = await renderer.render(graded.mesh.parts, { fixture: run.fixture, run: run.run })
    results.push(settleRun({ ...rest, render: renderRecord(graded, views) }))
  }
  return { ...file, results, ...(file.summary ? { summary: summarize(results) } : {}) }
}

export const rerenderedCount = (before, after) => after.results.filter((r, i) => before.results[i].renderStale && !r.renderStale && !r.renderError).length

export async function rerenderFiles(paths, env) {
  const stale = paths.filter((path) => JSON.parse(readFileSync(path, 'utf8')).results?.some((r) => r.renderStale))
  if (stale.length === 0) return 0
  const sandbox = await requireSandbox(env)
  const fixturesByName = new Map((await loadFixtures()).map((f) => [f.name, f]))
  let count = 0
  for (const path of stale) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    const api = file.api ?? DEFAULT_API
    const grader = freshExecutorGrader(() => startExecutor({ api, sandbox, lifetimeS: GRADE_LIFETIME_S }))
    const renderer = createRunRenderer(path)
    try {
      const next = await rerenderFile(file, { grader, renderer, fixturesByName })
      writeFileSync(path, JSON.stringify(next, null, 2))
      count += rerenderedCount(file, next)
    } finally {
      await renderer.close()
    }
  }
  return count
}
```

- [ ] **Step 4: Add the flag to `describe.js`**

In `packages/agent-loop/eval/describe.js`, replace

```js
const USAGE = 'Usage: npm run describe -w @jscadui/agent-loop -- [--all] <result files>'
```

with

```js
const USAGE = 'Usage: npm run describe -w @jscadui/agent-loop -- [--all] [--rerender] <result files>'
```

and in `main`, replace

```js
  try {
    const outcome = await runDescribe(paths, { all: argv.includes('--all'), env })
```

with

```js
  try {
    if (argv.includes('--rerender')) {
      const { rerenderFiles } = await import('./rerender.js')
      console.log(`describe: rendered ${await rerenderFiles(paths, env)} runs again`)
    }
    const outcome = await runDescribe(paths, { all: argv.includes('--all'), env })
```

Update the usage line in the file's header comment to `// Usage: npm run describe -w @jscadui/agent-loop -- [--all] [--rerender] <result files>`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/rerender.test.js eval/describe.test.js`
Expected: PASS.

- [ ] **Step 6: Document `--rerender`**

In `packages/agent-loop/docs/user-manual.md`, `### Regrading`, replace

```markdown
that no longer builds loses them too and scores geometry 0. `--regrade` makes
no provider call, starts no describer and renders nothing.
```

with

```markdown
that no longer builds loses them too and scores geometry 0. `--regrade` makes
no provider call, starts no describer and renders nothing:
`npm run describe -- --rerender <files>` builds each `renderStale` run again
in the sandbox, renders it and describes it, and `npm run judge` on the same
files judges it.
```

In `### Describe and judge`, after the sentence that ends `so run the judge on the same files after it.` (Task 7 wraps it across a line break) insert:

```markdown
`--rerender` first builds and renders again each run `--regrade` marked
`renderStale`, which needs the crt sandbox and chromium as `run-eval` does.
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/eval/rerender.js packages/agent-loop/eval/rerender.test.js packages/agent-loop/eval/describe.js packages/agent-loop/docs/user-manual.md
```

```bash
git commit -m "feat(eval): render stale complex runs again before describing them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

- [ ] **Step 8: Rollout gate (spec step 3, on the CI host)**

`sci push jscadui/grader-validate` (default `UNTIL=judge`). Expected: exit 0; `caboose` SUCCESS, `delivery-truck` and `plain-box` FAILURE, `exploded` fails `connected`, `no-roof` not scored. Also repeat the Task 5 regrade check on the baseline files. Stop and report to the user before Task 10.

---

### Task 10: The ten complex fixtures

**Files:**
- Create: `packages/agent-loop/eval/fixtures/toy-caboose.js`, `birdhouse.js`, `desk-organizer.js`, `dump-truck.js`, `lamp-shade.js`, `planter.js`, `chess-pieces.js`, `cable-clip.js`, `toothbrush-holder.js`, `rocket-revised.js`
- Create: `packages/agent-loop/eval/complex-fixtures.test.js`
- Modify: `packages/agent-loop/eval/fixtures.test.js`
- Modify: `packages/agent-loop/docs/user-manual.md`

**Model:** `sonnet` — ten small files with given code and gate tests that must pass on real geometry.

**Interfaces:**
- Consumes: `connectedGroups` (Task 3), `footprint`, `holeLoops`, `outerLoops` (`eval/probe.js`), the fixture shape from Task 3.
- Produces: ten fixtures with `group: 'complex'`, `gates`, `pieces`, `followUps`, selected by `EVAL_FIXTURES=complex`.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-loop/eval/complex-fixtures.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { complexGates, complexProbe } from './complex.js'
import { loadFixtures } from './run-eval.js'

const JF = "const jf = require('@jbroll/jscad-fluent')\n"
const model = (body) => `${JF}module.exports = { main: () => ${body} }\n`
// Two 4 mm arms `gap` apart, joined at the back: a C clip in profile, 30 mm long in x.
const clip = (gap) =>
  model(`[
  jf.cuboid({ size: [30, 20, 4] }).translate([0, 0, 2]),
  jf.cuboid({ size: [30, 20, 4] }).translate([0, 0, ${4 + gap + 2}]),
  jf.cuboid({ size: [30, 4, ${8 + gap}] }).translate([0, -12, ${(8 + gap) / 2}]),
]`)

const byName = Object.fromEntries((await loadFixtures()).map((f) => [f.name, f]))
const backend = createEvalBackend({ api: 'fluent' })
const COMPLEX = ['toy-caboose', 'birdhouse', 'desk-organizer', 'dump-truck', 'lamp-shade', 'planter', 'chess-pieces', 'cable-clip', 'toothbrush-holder', 'rocket-revised']

const gatesOf = async (name, source) => {
  const fixture = byName[name]
  const graded = await backend.gradeProject({ files: { 'main.js': source }, entry: 'main.js' }, { probe: complexProbe(fixture) })
  return Object.fromEntries(complexGates(fixture, graded).map((g) => [g.name, g.pass]))
}

describe('complex fixtures', () => {
  it('are the ten the spec lists', () => {
    expect(Object.values(byName).filter((f) => f.group === 'complex').map((f) => f.name).sort()).toEqual([...COMPLEX].sort())
  })

  it('have the stated pieces and follow-ups', () => {
    expect(COMPLEX.map((name) => byName[name].pieces)).toEqual([1, 1, 1, 1, 1, 2, 2, 1, 1, 1])
    expect(byName['rocket-revised'].followUps).toEqual([{ message: 'can you make it two stages, with fins only on the bottom one' }])
  })

  it('state as many gates as the requests do, and each fails a grade with no geometry', () => {
    const gates = COMPLEX.map((name) => byName[name].gates(null, { solid: null, probe: null, params: [] }))
    expect(gates.map((list) => list.length)).toEqual([0, 1, 1, 0, 1, 1, 1, 1, 0, 1])
    expect(gates.flat().map((g) => g.pass)).toEqual(Array(7).fill(false))
  })

  it.each([
    ['birdhouse', 'at least two bodies', true, model('[jf.cuboid({ size: [100, 100, 100] }).translateZ(50), jf.cuboid({ size: [110, 110, 5] }).translateZ(102.5)]')],
    ['birdhouse', 'at least two bodies', false, model('jf.cuboid({ size: [100, 100, 100] })')],
    ['desk-organizer', 'a pocket at least 77 x 77 mm', true, model('jf.cuboid({ size: [100, 100, 40] }).translateZ(20).subtract(jf.cuboid({ size: [80, 80, 40] }).translateZ(25))')],
    ['desk-organizer', 'a pocket at least 77 x 77 mm', false, model('jf.cuboid({ size: [100, 100, 40] }).translateZ(20).subtract(jf.cuboid({ size: [70, 70, 40] }).translateZ(25))')],
    ['lamp-shade', 'a round hole 40 to 44 mm across', true, model('jf.cylinder({ radius: 40, height: 3, segments: 64 }).subtract(jf.cylinder({ radius: 21, height: 5, segments: 64 }))')],
    ['lamp-shade', 'a round hole 40 to 44 mm across', false, model('jf.cylinder({ radius: 40, height: 3, segments: 64 }).subtract(jf.cylinder({ radius: 25, height: 5, segments: 64 }))')],
    ['planter', 'at least two bodies', true, model('[jf.cylinder({ radius: 40, height: 60 }).translateZ(35), jf.cylinder({ radius: 50, height: 5 }).translateZ(2.5)]')],
    ['planter', 'at least two bodies', false, model('jf.cylinder({ radius: 40, height: 60 })')],
    ['chess-pieces', 'exactly two groups', true, model('[jf.cylinder({ radius: 10, height: 30 }), jf.cylinder({ radius: 10, height: 40 }).translate([40, 0, 5])]')],
    ['chess-pieces', 'exactly two groups', false, model('jf.cylinder({ radius: 10, height: 30 })')],
    ['cable-clip', 'a slot 20 to 21.5 mm wide', true, clip(20.5)],
    ['cable-clip', 'a slot 20 to 21.5 mm wide', false, clip(25)],
    ['rocket-revised', 'tallest size 180 to 220 mm', true, model('jf.cylinder({ radius: 12, height: 200 })')],
    ['rocket-revised', 'tallest size 180 to 220 mm', false, model('jf.cylinder({ radius: 12, height: 250 })')],
  ])('%s: "%s" is %s', async (name, gate, pass, source) => {
    expect((await gatesOf(name, source))[gate]).toBe(pass)
  })
})
```

In `packages/agent-loop/eval/fixtures.test.js`, replace

```js
    it(`${fixture.name}: declares known tools, a prompt, and function checks`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(0)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      expect(typeof fixture.checks).toBe('function')
      expect(typeof fixture.maxTurns).toBe('number')
    })

    it(`${fixture.name}: leaves the API to the setting`, () => {
      if (fixture.api !== undefined) expect(APIS).toContain(fixture.api)
      expect(fixture.prompt).not.toMatch(/fluent|@jscad|modeling|\bjf\b/i)
    })
```

with

```js
    it(`${fixture.name}: declares known tools, a prompt, and function checks, or gates for a complex one`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(0)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      if (fixture.group === 'complex') {
        expect(typeof fixture.gates).toBe('function')
        expect(fixture.checks).toBeUndefined()
        expect(Number.isInteger(fixture.pieces ?? 1) && (fixture.pieces ?? 1) >= 1).toBe(true)
      } else {
        expect(typeof fixture.checks).toBe('function')
      }
      for (const followUp of fixture.followUps ?? []) expect(followUp.message.trim().length).toBeGreaterThan(0)
      expect(typeof fixture.maxTurns).toBe('number')
    })

    it(`${fixture.name}: leaves the API to the setting`, () => {
      if (fixture.api !== undefined) expect(APIS).toContain(fixture.api)
      for (const message of [fixture.prompt, ...(fixture.followUps ?? []).map((f) => f.message)]) expect(message).not.toMatch(/fluent|@jscad|modeling|\bjf\b/i)
    })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/complex-fixtures.test.js eval/fixtures.test.js`
Expected: FAIL, no complex fixtures exist yet.

- [ ] **Step 3: Write the fixtures**

`packages/agent-loop/eval/fixtures/toy-caboose.js`:

```js
export const fixture = {
  name: 'toy-caboose',
  group: 'complex',
  prompt: 'we need a model of a toy caboose',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: () => [],
}
```

`packages/agent-loop/eval/fixtures/birdhouse.js`:

```js
// A removable roof is a body of its own; resting on the walls, it still touches them.
export const fixture = {
  name: 'birdhouse',
  group: 'complex',
  prompt: 'a birdhouse with a removable roof',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'at least two bodies', pass: (probe?.bodies?.length ?? 0) >= 2 }],
}
```

`packages/agent-loop/eval/fixtures/desk-organizer.js`:

```js
import { footprint, holeLoops } from '../probe.js'

const LEVELS = Array.from({ length: 19 }, (_, k) => 0.05 + k * 0.05)
// A 3 inch sticky-note pad is 76 mm square.
const POCKET = 77

export const fixture = {
  name: 'desk-organizer',
  group: 'complex',
  prompt: 'a desk organizer with spots for pens, my phone and sticky notes (the 3 inch square ones)',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: [{ axis: 'z', at: LEVELS }] },
  gates: (m, { probe } = {}) => [
    {
      name: `a pocket at least ${POCKET} x ${POCKET} mm`,
      pass: (probe?.sections ?? []).some((s) => holeLoops(s).some((loop) => footprint(loop, 'z').every((d) => d >= POCKET))),
    },
  ],
}
```

`packages/agent-loop/eval/fixtures/dump-truck.js`:

```js
// No gate for the tipping bed: the judge rules on the whole object.
export const fixture = {
  name: 'dump-truck',
  group: 'complex',
  prompt: 'a toy dump truck where the bed tips up',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: () => [],
}
```

`packages/agent-loop/eval/fixtures/lamp-shade.js`:

```js
import { footprint, holeLoops } from '../probe.js'

const LEVELS = Array.from({ length: 49 }, (_, k) => 0.02 + k * 0.02)
// An E27 holder's shade ring takes a 40 mm hole; up to 44 mm still sits on it.
const [LOW, HIGH] = [40, 44]

const roundHole = (loop) => {
  const [a, b] = footprint(loop, 'z')
  return a >= LOW && b <= HIGH && b - a <= 1
}

export const fixture = {
  name: 'lamp-shade',
  group: 'complex',
  prompt: 'a lamp shade for a standard E27 bulb holder',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: [{ axis: 'z', at: LEVELS }] },
  gates: (m, { probe } = {}) => [{ name: `a round hole ${LOW} to ${HIGH} mm across`, pass: (probe?.sections ?? []).some((s) => holeLoops(s).some(roundHole)) }],
}
```

`packages/agent-loop/eval/fixtures/planter.js`:

```js
export const fixture = {
  name: 'planter',
  group: 'complex',
  prompt: 'a small planter with a saucer for the water to drain into',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 2,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'at least two bodies', pass: (probe?.bodies?.length ?? 0) >= 2 }],
}
```

`packages/agent-loop/eval/fixtures/chess-pieces.js`:

```js
import { connectedGroups } from '../complex.js'

export const fixture = {
  name: 'chess-pieces',
  group: 'complex',
  prompt: 'a chess pawn and a knight',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 2,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'exactly two groups', pass: connectedGroups(probe?.bodies ?? []) === 2 }],
}
```

`packages/agent-loop/eval/fixtures/cable-clip.js`:

```js
import { outerLoops } from '../probe.js'

const AXES = ['x', 'y', 'z']
// In-plane axes of a cut normal to each axis, as eval/probe.js orders them.
const PLANE = { x: [1, 2], y: [2, 0], z: [0, 1] }
const ALONG = Array.from({ length: 24 }, (_, k) => 0.02 + k * 0.04)
const DESK = 20

// Two loops of one cut facing each other across a gap: the arms either side of the slot.
const gapsIn = (section) => {
  const loops = outerLoops(section)
  const [u, v] = PLANE[section.axis]
  const gaps = []
  for (let a = 0; a < loops.length; a += 1) {
    for (let b = a + 1; b < loops.length; b += 1) {
      const [[pLo, pHi], [qLo, qHi]] = [loops[a].boundingBox, loops[b].boundingBox]
      for (const [k, other] of [
        [u, v],
        [v, u],
      ]) {
        const gap = Math.max(pLo[k] - qHi[k], qLo[k] - pHi[k])
        const facing = Math.min(pHi[other], qHi[other]) - Math.max(pLo[other], qLo[other]) > 0
        if (gap > 0 && facing) gaps.push(gap)
      }
    }
  }
  return gaps
}

export const fixture = {
  name: 'cable-clip',
  group: 'complex',
  prompt: 'a clip to run cables along the edge of my desk, the desk is 20mm thick',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: AXES.map((axis) => ({ axis, at: ALONG })) },
  gates: (m, { probe } = {}) => [
    { name: `a slot ${DESK} to ${DESK + 1.5} mm wide`, pass: (probe?.sections ?? []).some((s) => gapsIn(s).some((w) => w >= DESK && w <= DESK + 1.5)) },
  ],
}
```

`packages/agent-loop/eval/fixtures/toothbrush-holder.js`:

```js
export const fixture = {
  name: 'toothbrush-holder',
  group: 'complex',
  prompt: 'a holder for two toothbrushes and a tube of toothpaste',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: () => [],
}
```

`packages/agent-loop/eval/fixtures/rocket-revised.js`:

```js
// The multi-turn case: the judge reads both messages, so a single-stage rocket with fins all round fails.
export const fixture = {
  name: 'rocket-revised',
  group: 'complex',
  prompt: 'a model rocket about 20cm tall',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [{ message: 'can you make it two stages, with fins only on the bottom one' }],
  gates: (m) => {
    const tallest = Math.max(0, ...(m?.dimensions ?? []))
    return [{ name: 'tallest size 180 to 220 mm', pass: tallest >= 180 && tallest <= 220 }]
  },
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/complex-fixtures.test.js eval/fixtures.test.js eval/complex-run.test.js`
Expected: PASS.

- [ ] **Step 5: Document the fixtures**

In `packages/agent-loop/docs/user-manual.md`, `### Complex fixtures`, after the list item ending `filled in by the describe and\n  judge stages.`, add:

```markdown
The complex group; `builds`, `watertight` and `connected` apply to all:

| fixture | user messages | pieces | stated gates |
|---|---|---|---|
| `toy-caboose` | "we need a model of a toy caboose" | 1 | none |
| `birdhouse` | "a birdhouse with a removable roof" | 1 | at least two bodies |
| `desk-organizer` | "a desk organizer with spots for pens, my phone and sticky notes (the 3 inch square ones)" | 1 | a pocket at least 77 x 77 mm in a horizontal cut |
| `dump-truck` | "a toy dump truck where the bed tips up" | 1 | none |
| `lamp-shade` | "a lamp shade for a standard E27 bulb holder" | 1 | a round hole 40 to 44 mm across in a horizontal cut |
| `planter` | "a small planter with a saucer for the water to drain into" | 2 | at least two bodies |
| `chess-pieces` | "a chess pawn and a knight" | 2 | exactly two groups |
| `cable-clip` | "a clip to run cables along the edge of my desk, the desk is 20mm thick" | 1 | a slot 20 to 21.5 mm wide in a cut through the clip |
| `toothbrush-holder` | "a holder for two toothbrushes and a tube of toothpaste" | 1 | none |
| `rocket-revised` | "a model rocket about 20cm tall", then "can you make it two stages, with fins only on the bottom one" | 1 | tallest size 180 to 220 mm |

A roof resting on its walls touches them, so `birdhouse` is one group of at
least two bodies. `rocket-revised` is the multi-turn case: the judge reads
both messages, so a single-stage rocket with fins all round fails.
`dump-truck` has no gate for motion; the judge rules on the whole object. The
pocket gate wants a hole loop at least 77 mm both ways in a horizontal cut (a
3 inch pad is 76 mm); the lamp-shade gate a hole loop 40 to 44 mm across,
within 1 mm of round; the clip gate two loops of one cut, in any of the three
directions, 20 to 21.5 mm apart along one in-plane axis while facing each
other along the other. `eval/complex-fixtures.test.js` passes and fails a
simple model against each stated gate.
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/eval/fixtures/toy-caboose.js packages/agent-loop/eval/fixtures/birdhouse.js packages/agent-loop/eval/fixtures/desk-organizer.js packages/agent-loop/eval/fixtures/dump-truck.js packages/agent-loop/eval/fixtures/lamp-shade.js packages/agent-loop/eval/fixtures/planter.js packages/agent-loop/eval/fixtures/chess-pieces.js packages/agent-loop/eval/fixtures/cable-clip.js packages/agent-loop/eval/fixtures/toothbrush-holder.js packages/agent-loop/eval/fixtures/rocket-revised.js packages/agent-loop/eval/complex-fixtures.test.js packages/agent-loop/eval/fixtures.test.js packages/agent-loop/docs/user-manual.md
```

```bash
git commit -m "feat(eval): ten complex fixtures graded by gates and a blind verdict

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

---

### Task 11: `ci/eval-complex`, fetching renders, approved answers

**Files:**
- Modify: `ci/eval` (one line, `EVAL_CONF`)
- Create: `ci/eval-complex` (mode 755), `ci/eval-complex.conf`
- Modify: `packages/agent-loop/eval/fetch-ci-results.js`
- Modify: `packages/agent-loop/eval/fetch-ci-results.test.js` (imports, append)
- Modify: `packages/agent-loop/eval/grader-validate.js` (`--case-from`), `packages/agent-loop/eval/grader-validate.test.js` (imports, append)
- Modify: `ci/README.md`, `packages/agent-loop/docs/user-manual.md`

**Model:** `sonnet` — shell and a file-copy change with tests.

**Interfaces:**
- Consumes: `fixtureForApi`, `loadFixtures` (run-eval.js), `gradedModel` (grade.js), `userMessagesOf` (Task 3), the `npm run describe` and `npm run judge` CLIs.
- Produces:
  - `ci/eval` reads its settings from `$EVAL_CONF` (default `ci/eval.conf`).
  - `fetch-ci-results.js`: `renderViews(text) → [{ name, path, sha256 }]`; `fetchCiResults(jobId, { sci, dataDir, run, runBytes, fs, log }) → { files, fetched, renders: { fetched, mismatched } }` (plus the existing fallback fields); removes other `*.renders` directories from `dataDir` after fetching a complex pass.
  - `grader-validate.js`: `approvedCase(file, fixturesByName, fixtureName, runNumber) → case`; `--case-from <result file> <fixture> <run>` prints it.

- [ ] **Step 1: Write the failing tests**

In `packages/agent-loop/eval/fetch-ci-results.test.js`, replace the import line

```js
import { fetchCiResults, parseIndex, sciPath } from './fetch-ci-results.js'
```

with

```js
import { createHash } from 'node:crypto'
import { fetchCiResults, parseIndex, renderViews, sciPath } from './fetch-ci-results.js'
```

and append:

```js
describe('a complex pass', () => {
  const png = Buffer.from('png bytes')
  const sha = createHash('sha256').update(png).digest('hex')
  const complexFile = (views) => JSON.stringify({ suite: 'complex', results: [{ render: { views } }] })
  const view = (name, digest = sha) => ({ name, path: `c.renders/toy-caboose-1/${name}.png`, sha256: digest })
  const fakeFs = () => {
    const written = {}
    const removed = []
    return {
      written,
      removed,
      fs: {
        existsSync: () => false,
        mkdirSync: vi.fn(),
        writeFileSync: (path, content) => {
          written[path] = content
        },
        readdirSync: () => ['a.renders', 'c.renders', 'c.json'],
        rmSync: (path) => removed.push(path),
      },
    }
  }

  it('copies each view checked against its sha256 and removes an older pass renders', () => {
    const run = (_sci, args) => (args[2] === 'eval-results/index.txt' ? 'c.json\n' : complexFile([view('iso-front'), view('side', 'f'.repeat(64))]))
    const runBytes = vi.fn(() => png)
    const { fs, written, removed } = fakeFs()
    const log = vi.fn()
    const out = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, runBytes, fs, log })
    expect(runBytes).toHaveBeenCalledWith('/bin/sci', ['artifact', 'job1', 'eval-results/c.renders/toy-caboose-1/iso-front.png'])
    expect(written['/data/results/c.renders/toy-caboose-1/iso-front.png']).toBe(png)
    expect(Object.keys(written)).not.toContain('/data/results/c.renders/toy-caboose-1/side.png')
    expect(out.renders).toEqual({ fetched: 1, mismatched: ['c.renders/toy-caboose-1/side.png'] })
    expect(removed).toEqual(['/data/results/a.renders'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('did not match their sha256'))
  })

  it('never fetches a render path that leaves the results directory', () => {
    expect(renderViews(complexFile([{ name: 'x', path: '../../etc/passwd', sha256: sha }, { name: 'y', path: 'c.renders/../x.png', sha256: sha }]))).toEqual([])
    expect(renderViews('{"results":[]}')).toEqual([])
    expect(renderViews('not json')).toEqual([])
  })
})
```

In `packages/agent-loop/eval/grader-validate.test.js`, replace the import line

```js
import { expectedMatch, formatValidation, validationRun } from './grader-validate.js'
```

with

```js
import { approvedCase, expectedMatch, formatValidation, validationRun } from './grader-validate.js'
```

and append:

```js
describe('approvedCase', () => {
  const fixture = { name: 'rocket-revised', group: 'complex', prompt: 'a model rocket about 20cm tall', followUps: [{ message: 'two stages' }], requires: ['write'], pieces: 1, gates: () => [] }
  const transcript = [
    { role: 'user', content: 'a model rocket about 20cm tall' },
    { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: 'rocket' } }] },
    { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
  ]
  const file = { api: 'modeling', results: [{ fixture: 'rocket-revised', run: 2, userMessages: ['a model rocket about 20cm tall', 'two stages'], transcript }] }

  it('makes a validation case from a run the user approved', () => {
    expect(approvedCase(file, new Map([[fixture.name, fixture]]), 'rocket-revised', 2)).toEqual({
      name: 'rocket-revised-approved',
      messages: ['a model rocket about 20cm tall', 'two stages'],
      expected: 'pass',
      api: 'modeling',
      pieces: 1,
      files: { 'main.js': 'rocket' },
      entry: 'main.js',
    })
  })

  it('names a run that is not in the file', () => {
    expect(() => approvedCase(file, new Map([[fixture.name, fixture]]), 'rocket-revised', 3)).toThrow(/no run rocket-revised#3/)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/agent-loop eval/fetch-ci-results.test.js eval/grader-validate.test.js`
Expected: FAIL, `renderViews` and `approvedCase` are not exported.

- [ ] **Step 3: Copy renders in `fetch-ci-results.js`**

In `packages/agent-loop/eval/fetch-ci-results.js`, replace

```js
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
```

with

```js
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
```

Replace

```js
const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
```

with

```js
const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const defaultRunBytes = (sci, args) => execFileSync(sci, args, { maxBuffer: 256 * 1024 * 1024 })

const RENDER_PATH = /^[\w.-]+\.renders\/[\w.-]+\/[\w-]+\.png$/

// A complex result file's views, which sit beside it in the job's eval-results/.
export const renderViews = (text) => {
  let file
  try {
    file = JSON.parse(text)
  } catch {
    return []
  }
  if (file?.suite !== 'complex' || !Array.isArray(file.results)) return []
  return file.results
    .flatMap((r) => r?.render?.views ?? [])
    .filter((v) => typeof v?.path === 'string' && RENDER_PATH.test(v.path) && !v.path.split('/').includes('..') && typeof v.sha256 === 'string')
}

// The evals repo keeps only the newest complex pass's renders; git history keeps the rest.
const pruneRenders = (dataDir, keep, { fs, log }) => {
  for (const name of fs.readdirSync(dataDir)) {
    if (!name.endsWith('.renders') || keep.includes(name)) continue
    fs.rmSync(join(dataDir, name), { recursive: true, force: true })
    log(`fetch-ci-results: removed ${name}, an older complex pass's renders`)
  }
}
```

Replace

```js
export function fetchCiResults(jobId, { sci, dataDir, run = defaultRun, fs = { existsSync, mkdirSync, writeFileSync }, log = () => {} }) {
```

with

```js
export function fetchCiResults(
  jobId,
  { sci, dataDir, run = defaultRun, runBytes = defaultRunBytes, fs = { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync }, log = () => {} },
) {
```

Replace

```js
  const fetched = []
  for (const file of files) {
    const dest = join(dataDir, file)
    if (fs.existsSync(dest)) {
      log(`fetch-ci-results: ${file} already exists, skipping`)
      continue
    }
    fs.writeFileSync(dest, run(sci, ['artifact', jobId, `eval-results/${file}`]))
    fetched.push(file)
    log(`fetch-ci-results: wrote ${dest}`)
  }
  return { files, fetched }
}
```

with

```js
  const fetched = []
  const renders = { fetched: 0, mismatched: [] }
  const kept = []
  for (const file of files) {
    const dest = join(dataDir, file)
    if (fs.existsSync(dest)) {
      log(`fetch-ci-results: ${file} already exists, skipping`)
      continue
    }
    const text = run(sci, ['artifact', jobId, `eval-results/${file}`])
    fs.writeFileSync(dest, text)
    fetched.push(file)
    log(`fetch-ci-results: wrote ${dest}`)
    const views = renderViews(text)
    if (views.length) kept.push(`${basename(file, '.json')}.renders`)
    for (const view of views) {
      const target = join(dataDir, view.path)
      if (fs.existsSync(target)) continue
      const bytes = runBytes(sci, ['artifact', jobId, `eval-results/${view.path}`])
      if (createHash('sha256').update(bytes).digest('hex') !== view.sha256) {
        renders.mismatched.push(view.path)
        continue
      }
      fs.mkdirSync(dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
      renders.fetched += 1
    }
  }
  if (kept.length) pruneRenders(dataDir, kept, { fs, log })
  if (renders.mismatched.length) {
    log(`fetch-ci-results: ${renders.mismatched.length} renders did not match their sha256 (sci artifact may not pass binary files through); copy them with scp from the job's eval-results/`)
  }
  return { files, fetched, renders }
}
```

Replace the file's three-line header comment with:

```js
// Usage: node eval/fetch-ci-results.js JOB-ID
// Fetches ci/eval's result files (eval-results/index.txt), and a complex pass's renders, into the local results dir.
```

- [ ] **Step 4: Add `--case-from` to `grader-validate`**

In `packages/agent-loop/eval/grader-validate.js`, after `import { isMainModule } from '../src/mainModule.js'` add:

```js
import { DEFAULT_API } from '../src/api.js'
```

replace

```js
import { harnessGates, renderRecord, settleRun } from './complex.js'
```

with

```js
import { harnessGates, renderRecord, settleRun, userMessagesOf } from './complex.js'
import { gradedModel } from './grade.js'
```

and replace

```js
import { fileStamp, GRADE_LIFETIME_S, requireSandbox } from './run-eval.js'
```

with

```js
import { fileStamp, fixtureForApi, GRADE_LIFETIME_S, loadFixtures, requireSandbox } from './run-eval.js'
```

After `const modelOf = ...` add:

```js
// A run the user read and accepted, as a case for CASES in eval/grader-validation/cases.js.
export const approvedCase = (file, fixturesByName, fixtureName, runNumber) => {
  const run = file.results.find((r) => r.fixture === fixtureName && r.run === runNumber)
  if (!run) throw new Error(`no run ${fixtureName}#${runNumber} in the file`)
  const api = file.api ?? DEFAULT_API
  const fixture = fixtureForApi(fixturesByName.get(fixtureName), api)
  const model = fixture && gradedModel(fixture, run.transcript ?? [])
  if (!model) throw new Error(`${fixtureName}#${runNumber} saved no project`)
  return { name: `${fixtureName}-approved`, messages: run.userMessages ?? userMessagesOf(fixture), expected: 'pass', api, pieces: fixture.pieces ?? 1, files: model.files, entry: model.entry }
}
```

At the top of `main`, before `const at = argv.indexOf('--until')`, add:

```js
  const from = argv.indexOf('--case-from')
  if (from !== -1) {
    const [path, fixtureName, runNumber] = argv.slice(from + 1)
    const fixturesByName = new Map((await loadFixtures()).map((f) => [f.name, f]))
    console.log(JSON.stringify(approvedCase(JSON.parse(readFileSync(path, 'utf8')), fixturesByName, fixtureName, Number(runNumber)), null, 2))
    return
  }
```

Replace the usage line in its header comment (the first of its two lines) with `// Usage: npm run grader-validate -w @jscadui/agent-loop [-- --until render|describe | --case-from <result file> <fixture> <run>]`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root packages/agent-loop eval/fetch-ci-results.test.js eval/grader-validate.test.js`
Expected: PASS.

- [ ] **Step 6: Write the CI job**

In `ci/eval`, replace

```bash
# shellcheck source=ci/eval.conf
. "$WORKTREE/ci/eval.conf"
```

with

```bash
# ci/eval-complex points EVAL_CONF at ci/eval-complex.conf.
# shellcheck source=ci/eval.conf
. "${EVAL_CONF:-$WORKTREE/ci/eval.conf}"
```

Create `ci/eval-complex.conf`:

```bash
# ci/eval-complex settings, sourced by ci/eval for the complex pass. Edit the
# working tree, then
#   sci push jscadui/eval-complex
# Same variables as ci/eval.conf.

EVAL_MODELS="meta:muse-spark-1.3-contributor opencode-go:deepseek-v4.1-flash"
EVAL_APIS="fluent modeling"

# The complex group runs in a pass of its own.
EVAL_FIXTURES="complex"

EVAL_RUNS=3

# 10 fixtures x 3 runs x 2 models x 2 styles is 120 conversations, each two to
# three times a single-shot run's length, plus three renders per run in the
# lane's chromium.
EVAL_CONCURRENCY=8
```

Create `ci/eval-complex` (then `chmod 755 ci/eval-complex`):

```bash
#!/usr/bin/env bash
# The complex eval pass on the CI host: ci/eval's lanes on the complex
# fixtures (settings in ci/eval-complex.conf), then the describer once over
# every result file, then the judge unless the describer stopped (exit 2).
# Exits non-zero when a lane, the describer or the judge failed.
#
#   sci push jscadui/eval-complex
#
# Never runs on author trust alone for a ci/ or scripts/ diff (ci/README.md's
# harness-pin gate), since it spends real API budget.
set -uo pipefail

WORKTREE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKTREE"

node scripts/fetch-sources.js || exit 1
npm install || exit 1

# The describer and the renderer must be ready before any provider call.
if ! scripts/describer-setup.sh --check; then
  echo "ci/eval-complex: the describer is not set up on this host; see ci/README.md (Describer)" >&2
  exit 1
fi
( cd apps/jscad-web && npx playwright install chromium ) || exit 1

status=0
EVAL_CONF="$WORKTREE/ci/eval-complex.conf" ci/eval || status=1

shopt -s nullglob
files=("$WORKTREE"/eval-results/*-complex-*.json)
if [ ${#files[@]} -eq 0 ]; then
  echo "ci/eval-complex: no complex result files to describe" >&2
  exit 1
fi
npm run describe -w @jscadui/agent-loop -- "${files[@]}"
described=$?
# 2 is a stop (GPU short, a describer crash, a refused connection): the judge must not run.
if [ "$described" -eq 2 ]; then
  echo "ci/eval-complex: the describe stage stopped; the judge did not run" >&2
  exit 1
fi
[ "$described" -eq 0 ] || status=1
npm run judge -w @jscadui/agent-loop -- "${files[@]}" || status=1
exit "$status"
```

`npm run` exits with the script's own code, so the describe stage's 2 reaches the check. A 1 from it (views that failed) leaves those runs undescribed; the judge skips them and judges the rest.

- [ ] **Step 7: Document the job and the fetch**

In `ci/README.md`, insert before `## Describer`:

````markdown
## Complex eval (`ci/eval-complex`)

`sci push jscadui/eval-complex` runs the complex fixtures
(`packages/agent-loop/docs/user-manual.md`, Complex fixtures) as their own job,
never with `ci/eval`. It checks the describer install
(`scripts/describer-setup.sh --check`) and installs Playwright's chromium
before any provider call, runs `ci/eval` with `EVAL_CONF=ci/eval-complex.conf`
(the same variables as `ci/eval.conf`, `EVAL_FIXTURES="complex"`), then
`npm run describe` once over every `*-complex-*.json` in `eval-results/`, then
`npm run judge` over the same files. `npm run describe` exits 1 when views
failed to describe (those runs wait for the next describe; the judge still
runs on the rest) and 2 when it stopped: the GPU had less than 11,800 MiB
free after Ollama unloads (chatterbox-tts holds 3.5 GB while it runs: `sudo
sv down chatterbox-tts`, then `sudo sv up chatterbox-tts` after), the
describer did not start or died, or it tried an outside connection. After a 2
the job does not run the judge; run `npm run describe` and `npm run judge` on
the job's files in its worktree (`sci path JOB`) to finish them once the
cause is dealt with. The job exits non-zero when a lane, the describer or the
judge failed. The renders sit beside the result files in
`eval-results/<file stem>.renders/`, and `fetch-ci-results.js` copies them
with the files.
````

In `ci/README.md`, `## Live model eval (\`ci/eval\`)`, after the paragraph that starts `It reads \`eval-results/index.txt\` via \`sci artifact\`,` and ends `for you to run by hand.`, add:

```markdown
For a complex pass it also copies each run's renders (`<file
stem>.renders/<fixture>-<run>/<view>.png`, listed in the file's `render.views`)
and checks each against its `sha256`; one that does not match is reported, not
written, and needs `scp`. It then removes other `*.renders` directories from
the results dir, since the evals repo keeps only the newest complex pass's
renders (git history keeps the older ones): commit the removal with the new
pass.
```

In `packages/agent-loop/docs/user-manual.md`, `### Running on CI`, append after its first paragraph (ending `Details: \`ci/README.md\`.`):

```markdown
`sci push jscadui/eval-complex` (`ci/eval-complex`, `ci/eval-complex.conf`)
runs the complex group the same way, then describes and judges every result
file on the host, skipping the judge when the describe stage stops (exit 2,
[Describe and judge](#describe-and-judge)); `fetch-ci-results.js` copies each
file's renders beside it and removes an older complex pass's renders from the
results dir.
```

In `### Grader validation`, append:

```markdown
Once a complex pass exists, one approved answer per complex fixture joins the
cases: after the user reads a run's renders and accepts it,
`npm run grader-validate -w @jscadui/agent-loop -- --case-from <result file>
<fixture> <run>` prints the case (the run's saved project, messages, api and
pieces, `expected: 'pass'`) to add to `CASES`.
```

- [ ] **Step 8: Commit**

```bash
git add ci/eval ci/eval-complex ci/eval-complex.conf packages/agent-loop/eval/fetch-ci-results.js packages/agent-loop/eval/fetch-ci-results.test.js packages/agent-loop/eval/grader-validate.js packages/agent-loop/eval/grader-validate.test.js ci/README.md packages/agent-loop/docs/user-manual.md
```

```bash
git commit -m "feat(ci): complex eval job, render fetching and approved validation cases

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

- [ ] **Step 9: Rollout gate (spec step 4, on the CI host, with the user)**

1. `sci push jscadui/eval-complex`, then `sci wait JOB` under Bash `run_in_background` (one notification at the end; no polling). Expected: exit 0, or a describe stop naming what holds the GPU (free it with the user, then finish the stages on the host).
2. `node packages/agent-loop/eval/fetch-ci-results.js JOB`.
3. Put ten descriptions (one per fixture) beside their renders for the user; the user judges whether they are fair.
4. For each fixture, the user picks one run whose renders they accept. For each pick run `npm run grader-validate -w @jscadui/agent-loop -- --case-from <absolute result file> <fixture> <run>` and add the printed object to the end of `CASES` in `eval/grader-validation/cases.js`. Leave `cases.test.js` as it is: it checks and builds only the five trial cases (`TRIAL_CASES`), since an approved case is model-written code and must build only in the crt sandbox, which `grader-validate` does. Run `npx vitest run --root packages/agent-loop eval/grader-validation/cases.test.js` (expected: PASS, unchanged) and commit (`test(eval): approved complex answers join the grader validation set`, with the two attribution lines).
5. `sci push jscadui/grader-validate`; every scored case, the approved ones included, must match.
6. On the CI host, repeat the Task 5 regrade check on a copy of the current baseline result files: `npm run eval -w @jscadui/agent-loop -- --regrade <copies>`, then `git diff --no-index` against the originals shows only `regradedAt` changed.

Stop and report to the user before Task 12.

---

### Task 12: Fold and delete the working documents

**Files:**
- Delete: `docs/superpowers/specs/2026-09-30-blind-description-grading-design.md`
- Delete: `docs/superpowers/plans/2026-09-30-blind-description-grading.md` (this plan)
- Modify: `docs/superpowers/specs/2026-09-29-conversational-eval-and-skills-design.md` (Part 4's superseded note replaced; the file stays, since its Parts 1-3 and 5 are not implemented)
- Modify: `packages/agent-loop/README.md`

**Model:** `sonnet` — a read of the spec against the permanent docs, then deletions.

**Interfaces:**
- Consumes: every earlier task's docs.
- Produces: no working documents for this feature on the branch.

- [ ] **Step 1: Check the spec is folded in**

Read the spec's "Where it lands in the permanent docs" list and confirm each item has a home:

- `packages/agent-loop/docs/user-manual.md`: Complex fixtures (gates, `pieces`, `followUps`, scoring, `verdictRate`, the fixture table), Describe and judge (both commands, the prompts, verdict fields, `--all`, `--rerender`, the describe exit codes 0/1/2), Grader validation, Regrading, Result files, the environment variables `DESCRIBER_HOME` and `GRADER_VALIDATION_DIR`.
- `packages/agent-loop/docs/architecture.md`: Eval conversations (follow-ups, the per-message turn cap), Complex grading (the three stages and why they are split, why describer and judge are blind, Rendering with its 3% margin on each side, The describer with its protocol, patches and connection block, The judge), the `mesh` request and its packed pages in Sandbox, the provider's `temperature`/`maxTokens`.
- `packages/agent-loop/docs/development.md`: the chromium and python3 skips.
- `ci/README.md`: Complex eval (with the describe exit codes and the judge skip), Describer (install), Grader validation, render fetching.
- `docs/backlog.md`: GPU sharing, the open-top blind spot, the `bodies` probe cap.

Anything missing: add it to the document listed, in plain words, in this commit.

- [ ] **Step 2: Point the README at the new docs**

In `packages/agent-loop/README.md`, replace

```markdown
- [User manual](docs/user-manual.md): the API style setting, conversation
  context, the `docs` tool, option warnings, the chat log reader, and the
  eval's commands, fixtures, environment variables, grading and result files.
```

with

```markdown
- [User manual](docs/user-manual.md): the API style setting, conversation
  context, the `docs` tool, option warnings, the chat log reader, and the
  eval's commands, fixtures, environment variables, grading and result files,
  including complex fixtures graded by a blind description and a judge.
```

- [ ] **Step 3: Mark Part 4 of the older spec superseded**

In `docs/superpowers/specs/2026-09-29-conversational-eval-and-skills-design.md`, under the heading `## Part 4: grading complex requests by blind description`, replace the existing paragraph

```markdown
Superseded by `2026-09-30-blind-description-grading-design.md`, which sets
the describer (Moondream 3.1 on the CI host), the judge (DeepSeek v4.1
flash), three views, the `connected` gate and the staged pipeline from the
2026-09-30 trials. The text below is the earlier draft.
```

with

```markdown
Superseded and built: see `packages/agent-loop/docs/user-manual.md` (Complex
fixtures, Describe and judge, Grader validation) and
`packages/agent-loop/docs/architecture.md` (Complex grading). The rest of this
part is kept only as history of the earlier design.
```

It is the only note on Part 4, and it no longer names the new spec, which this task deletes. Do not delete this spec: its Parts 1-3 and 5 are not implemented yet.

- [ ] **Step 4: Delete the new spec and this plan**

Run: `git rm docs/superpowers/specs/2026-09-30-blind-description-grading-design.md docs/superpowers/plans/2026-09-30-blind-description-grading.md`
Expected: both removed.

Run: `git grep -n "2026-09-30-blind-description-grading"`
Expected: no output (the old spec's Part 4 note named the new spec until Step 3 replaced it).

- [ ] **Step 5: Run the whole agent-loop suite**

Run: `npx vitest run --root packages/agent-loop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/README.md docs/superpowers/specs/2026-09-29-conversational-eval-and-skills-design.md
```

```bash
git commit -m "docs: fold blind-description grading into the permanent docs, drop its spec and plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv"
```

The branch is then ready for the user's fast-forward merge into `main` (root `CLAUDE.md`, Merge Workflow). Do not merge and do not open a pull request.
