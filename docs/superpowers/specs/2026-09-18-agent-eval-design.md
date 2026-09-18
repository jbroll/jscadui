# Agent eval harness — design

Date: 2026-09-18. Status: approved all sections in brainstorming.

## Goal

Score the shipped `runTurn` + `SYSTEM_PROMPT` as a modeling agent, so prompt
and tool edits are judged by measured deltas instead of vibes. Live provider,
real geometry execution, scored rubric, three fixtures.

## Background

`packages/agent-loop` has unit tests for turn mechanics, provider adapters,
and prompt/source parity, plus a scripted e2e turn. None of them evaluate
whether the prompt produces competent modeling behavior. Field guidance
(Anthropic's tool/agent writing) converges on: tool descriptions beat system
prompts for leverage, schemas can't teach usage (examples can),
anti-hallucination needs direct prohibitions — and evals come first, so every
edit is measured. This harness is that instrument.

## 1. Layout and runner

New `packages/agent-loop/eval/`, kept out of the published package:
`run-eval.js` (CLI entry), `backend.js` (real tool execution), `grade.js`
(rubric scorer), `fixtures/` (three task files), `report.js` (JSON + console
table). The runner imports the shipped `runTurn`, `TOOLS`, and
`SYSTEM_PROMPT` directly, so scores always reflect what the app runs.
Provider from env (`EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_API_KEY`) via the
existing `createProvider` adapters; no key refuses with a one-line message.
One `runTurn` per fixture with a turn cap; transcript plus tool results feed
the grader.

## 2. Real-execution tool backend

`backend.js` implements `requestTool` against live geometry. The agent writes
`jscad-fluent` with `jscad-anchors`: `eval` runs source in Node with a
require shim mapping `@jbroll/jscad-fluent` to the real local dist, returning
parameter definitions plus geometry or a JSON error shaped like the
browser's, so recovery behavior transfers. `measure`/`check` run
`@jscadui/model-tools` on the geometry. `writeModel` persists to an
in-memory project map; `params` returns current definitions. `view` and
`export` are stubbed as unavailable-with-reason, never faked, and fixtures
never require them. Fixture models stay within plain `main()` plus fluent
primitives (no params-proxy UI), keeping Node execution faithful without the
browser worker.

Prerequisite, out of scope: the production worker needs the fluent bundle
wired before fluent-writing agents work in the app.

## 3. Fixtures

Three `{ prompt, checks }` records in `eval/fixtures/`: a cube with a
through-hole (boolean correctness, net volume in tolerance), a 12-tooth gear
(teeth count, outer dimension), a bracket that must pass `check` on a named
bed (constraint satisfaction). Checks assert on executed geometry and the
transcript, never on prose. Each fixture declares the tools it requires.
Fixture count stays at three until scores discriminate prompts; more tasks
before that only burn API budget.

## 4. Rubric and grading

`grade.js` scores four dimensions per fixture, 0–2 each: tool discipline
(`eval` before any claim, `measure`/`check` before `writeModel`), error
recovery (failed tool call followed by corrected retry, not repeat or
abandonment), geometry correctness (volumes, dimensions, bed fit within
stated tolerances), conservation (no unrelated rewrites, bounded turn
count). Suite total out of 24, reported as JSON plus a console table.
Per-dimension deltas are the point: a prompt edit should move specific
dimensions, and a dimension that never discriminates gets its fixture
hardened, not its weight tweaked.

## 5. Running and reporting

`node eval/run-eval.js` runs on demand only — never in CI or pre-commit
hooks, since it spends real API budget with no key in automation. Missing
key or unreachable provider fails fast naming the env var. Reports carry
model id, prompt hash, per-fixture turns and tool counts, so a prompt edit's
before/after is a diff of two files. The first scored run is the baseline
all prompt work measures against.

## Non-goals

Browser/Playwright evals (reserved for later if `view`-dependent behavior
needs grading), record/replay cassettes, CI integration, judging prose
quality, more than three fixtures.
