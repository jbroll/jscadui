# Agent-loop dev environment — design

Date: 2026-10-17
Status: approved and implemented (branch feat/agent-loop-dev-env)

## Intent and why

The browser agent loop in `packages/agent-loop` (used by `apps/jscad-web`) today one-shots an entire project: `prompt.md` says "once a build meets the request, reply", every `write`/`edit` saves and builds, and the build report is treated as verification. There is no directed, repeatable testing organization the agent iterates against inside its turn.

We want a standard code-development environment around the loop: iterative improvement with live feedback, where model changes are externally observable, tests run automatically, and the agent keeps notes/plans/todos as files the user can see and edit. Skills give it repeatable procedures (brainstorm, plan, execute, debug) following OpenCode conventions.

## Goals

- Iterative turns: agent writes a little, gets feedback, rewrites, all inside one `runTurn`, with viewer/files updating live after each `write`/`edit`/`delete`.
- Test-after-write: any file write containing code triggers a run of all tests in the project's `test/` directory in a separate browser test worker (not the geometry/build worker, so a hanging test cannot freeze the viewer); the test output returns to the agent as part of that tool result.
- Coverage awareness: test result counts passing asserts per geometry part (which part index each `test(name, fn)` asserted on via the shared `test` package) to give the agent a sense of coverage. Completeness floor is one passing test per part; beyond that the report makes no judgement about completeness.
- Standard JS test package requireable from model/project code (so tests and model code share one assertion/helper surface).
- Skills feature following OpenCode V2 conventions: `SKILL.md` with frontmatter `description`, on-demand loading via a `skill` tool (list shows ID + description only), path-derived IDs, later sources override earlier ones. First skills: superpowers brainstorming, writing-plans, executing-plans, systematic-debugging — adapted to the browser loop's tools.
- Memory convention that mimics skills, described in the system prompt: project `notes/` folder, each note file carries a one-line descriptive header (frontmatter `description:` preferred) that is included in the prompt index; agent reads the whole file with the existing `read` tool and creates missing notes on demand with `write`.
- System prompt describes iterative improvement style (build-test-fix loop, verify before reply) replacing the current stop-early wording.

## Non-goals

- No background daemons, no hidden vector DB, no cross-machine sync in v1.
- No new model providers or relay changes.
- No changes to render sweep, parts catalog, deploy, or transpiler performance.
- No automatic commit/push from the agent.

## Anti-goals (failure even if it technically works)

- Agent iterates invisibly and only shows the final file set.
- Test output that the user cannot see or re-run the same way (`npm`-level repeatability lost).
- Memory or plans hidden in transcript/summary only, not as files.
- Skills that bloat every prompt (full bodies inlined) instead of index-then-load.
- Coverage that rewards gaming the metric over exercising real parts.

## Constraints (from current code)

- Everything runs in the browser (my miss — now explicit). No Node child processes, no shell, no `npm install`, no filesystem outside project storage (local/rowboat). Model code, test code, and the test runner all execute in the app + compute frame worker (`src_frame/*`, `frameHost.js`, `workerSlot.js`). The standard JS test package must be browser-requireable via the existing `require('./part.js')` / package-root loader and the npm-CDN fallback, not a Node-only runner. Vitest/Playwright remain repo dev-time checks only; the in-browser suite needs its own lightweight runner, timeout, and console/geometry capture that fits `BUILD_BUDGET`-style caps and streams progress via `afterToolCall` without blocking the UI.

- Loop: `src/loop.js` `runTurn`, `DEFAULT_MAX_ROUNDS=32`, doom-loop guard, tool errors are JSON results never throws (`src/dispatchTool.js`), read-only tools run concurrently, mutating serially (`src/tools.js` `READ_ONLY`).
- Context budgets: `CONTEXT_BUDGET=24k`, `PROJECT_BUDGET=24k`, `TOTAL_BUDGET=55k`, `BUILD_BUDGET=4k` (`src/context.js`). Skill/memory indexes must stay small; full bodies load on demand. `projectMessage` + `PROJECT_NOTE` pattern is the place to add skill/note indexes.
- Prompt assembly: `src/prompt.js` + `prompt.md`, `prompt/*.md`, `?raw` imports (`prompt/index.js`, `text-loader.js`). Skills likely live as `prompt/skills/<name>.md` imported `?raw` and served by a pure function like `docsTool`, per `docs/backlog.md:635-648`.
- App wiring: `apps/jscad-web/src/aiChat.js` calls `runTurn`/`buildMessages`, `src/aiDeps.js` `createProjectTools` handlers save+build+lint on write/edit, `main.js` wires `dispatchTool`. Frame worker in `src_frame/*`. Same pure functions shared by app and `eval/backend.js`.
- Tests: vitest (`packages/agent-loop`, `apps/jscad-web`), `npm run validate`. Eval grades `discipline`/`firstAttemptFailures` in `eval/grade.js`; keep eval green (`--regrade` moves no other fixture).
- Style: ESM, no semicolons, single quotes, 2-space, JSDoc on exports.

## Decided parts (what the human partner chose)

1. Observable iteration: each code `write`/`edit` re-renders (viewer + file tree update live) and then runs tests in the separate test worker; agent stays in its turn getting test feedback.
2. Test result on write: `write`/`edit` answer = saved/deleted header + build report (geometry worker) + test run output + coverage summary (test worker). Only for files containing code; docs/notes writes skip tests. Test worker timeouts/hangs return as tool error JSON, never freeze the viewer. V1 runs the full `test/` suite on every code write with no batching or suppression, for rapid feedback.
3. `test/` convention: all tests in project's `test/` directory run after every code write (unconditional, decided yes). Repeatable via the same runner the user runs by hand in the browser.
4. Coverage: separate test worker counts passing asserts per part index (attributed per `test(name, fn)` via `require('test')` helpers over `main()` output — volume, dims, bbox, watertight/manifold, gap/section). Floor is one passing test per part; no judgement beyond that. Report shows per-part assert counts + uncovered parts list, truncated to budget.
5. Skills = OpenCode shape: directory or flat `.md`, `SKILL.md` exact name for nested, path-derived kebab-case ID, `description` required for discovery, `metadata.opencode/autoinvoke:false` to hide, permissions per skill ID. Base prompt lists only names + when each applies (under ~250 words each per backlog note).
6. Memory = skills shape: `notes/` (name agreed; was `note/`) in project, one file per topic/plan/todo, first line is header via frontmatter `description:`, index of headers injected in prompt every turn, full read via `read`, update via `write`/`edit`, create-on-demand when agent needs a missing note (confirmed "yes").
7. System prompt update: replace stop-early tool policy with iterate-until-tests-green, verify-before-reply, state assumptions as params, ask via `question` only when a wrong guess wastes the build. When tests stay red past the round cap the turn errors (failure + what was tried returned, no silent reply); the cap itself stays tunable with experience (`DEFAULT_MAX_ROUNDS`, per-model `maxTurns`).
8. Extra ideas accepted for later (not v1 gates): part-level coverage display in viewer, test-duration budget per write, skill/todo persistence across user turns (tool results today do not survive user turns).

## What's left to the builder (plan may decide)

- Exact skill file paths and loader (`prompt/skills/` vs `.opencode/skills/` project shadow; pure function name; `skill` tool JSON schema; app vs eval serving without worker call).
- Exact contents of the four starter skills, trimmed for 8-round turns and browser tools (`read/glob/grep/write/edit/delete/execute/measure/check/docs/question`).
- Notes index format and parsing (frontmatter vs first `#` line; max index chars; omission listing like `filesSection` when over budget), and whether `notes/` files count toward `PROJECT_BUDGET` or a separate budget.
- Test runner choice and sandboxing in browser/frame (separate test worker decided — reuse frame executor protocol vs new worker entry; timeout; console capture; failure file/line/col mapping), and the standard test package name + require surface. Test worker runs `test/` only, never geometry; geometry worker never runs tests.
- Coverage mechanism for JS + geometry parts (V8/istanbul vs custom part-hit tracking via `measure`; report shape and truncation under `BUILD_BUDGET`-style cap).
- Prompt wording diffs (`prompt.md` tool policy section only, plus per-style files if needed) and `eval/fixtures` + `grade.js` updates to reward iteration without breaking baselines.
- Live-update plumbing in `aiChat.js`/`aiDeps.js` (`afterToolCall` streaming of files/view + test progress) and cancellation behavior.
- Naming: `notes/` vs `memory/` final, `test/` glob, todo file shape (single `todos.md` vs per-task files).

## Builder-check resolutions (my calls, 2026-10-17)

- `test/`, `notes/`, and skill sources are excluded from geometry build/transpiler input and viewer render. Only the model entry (`package.json` main else `index.js` else `main.js` plus its `require` closure) builds. Test/note writes update files + test index live but never feed geometry. Rationale: otherwise test helpers would draw as parts.
- Empty/missing `test/` or `notes/`: skip gracefully (build report + "no tests" note, no failure), and the agent scaffolds on demand with `write` when it needs a note or first test. No auto-scaffold of empty dirs on project open.

## Open questions for builder-check

None yet — reviewer round to follow.
