---
name: chat-review
description: Review recorded jscad-chat conversations, reproduce each stumble as an eval fixture, and improve the agent-loop system prompt and examples against the eval. Use when asked to "review the chat logs", review chat conversations, or improve the chat prompt from real sessions.
---

# Chat review

Improves `packages/agent-loop`'s system prompt from what users actually hit.
The launcher relay logs every chat request; the log reader rebuilds the
conversations; the eval measures a prompt change before it is kept.

## Scope

Edit only `packages/agent-loop/prompt.md`, `packages/agent-loop/prompt/`
(`fluent.md`, `modeling.md`, the examples and `prompt/index.js`) and
`packages/agent-loop/eval/fixtures/` in jscadui.

The chat teaches one API style at a time, `fluent` (the default) or
`modeling`, set by the user's settings and by `EVAL_API` in the eval (see
`packages/agent-loop/docs/user-manual.md`, "API style"). A log conversation ran under
one style: the logged request body carries the system prompt, whose
`## jscad-fluent style` or `## @jscad/modeling style` heading tells which.
Log lines from before the setting carry the older prompt that taught both.
Shared prose goes
in `prompt.md`, one style's prose in its own file, and one style's examples in
`prompt/examples/<api>/`, keeping both folders to the same requests. Logs and eval result files live in the private `jscad-chat-evals`
repo, `$JSCAD_CHAT_DATA` (default `~/src/jscad-chat-evals`); new result files
go there, not in jscadui. A stumble whose cause is in the runtime, the tools
or the app goes to `docs/backlog.md` as an item instead, with the
conversation's chat id and the error text.

Live eval runs spend API budget. Before the first live run of a review, tell
the user the fixture count times `EVAL_RUNS` and get a yes.

## Rules

- A fixture's `prompt` is what a user would type: the user's message from the
  log, verbatim, or, for a new fixture, a casual, possibly underspecified
  request. Never write a prompt like a spec so a band can grade it, and never
  phrase a prompt to provoke or steer the model toward a particular answer.
- A fixture's `prompt` never names the API ("in jscad-fluent", "using
  @jscad/modeling"): the setting picks it, as a user's radio button does.
  A fixture whose checks test one style's code (method chaining, which
  package it requires) declares `api: '<style>'` and runs only under that
  style; every other fixture leaves `api` out and runs under both.
- `checks` test properties any reasonable answer has: plausible size, hollow
  where the object should be hollow, watertight (via the `solid` context), a
  size the prompt actually states, and, for a fixture with `api: 'fluent'`,
  the chaining style. No exact-answer volume band unless the prompt pins the
  geometry.
- A prompt or example change is general guidance that holds across requests.
  Never add a line to `prompt.md` or an example to fix one fixture's failure;
  that overfits the prompt to a single case.
- When a stumble comes from a confusing API or error (e.g. `cube` given
  `[x, y, z]` fails with "size must be positive"), prefer fixing the tool
  side first — `docs`, warnings, clearer error text — and record it in
  `docs/backlog.md`, over changing prompt text.
- The default suite tests CSG primitives and booleans, plus the `harder`
  group: multi-change follow-ups, corrections, assemblies, parameters, text,
  and tasks that combine several constraints, stated tolerances, real-world
  sizes the model must know, parts that must fit, and computed shapes
  (point-list profiles, helices, twists). The opt-in `profiles` group is for
  experiments.

## Steps

1. **Read the logs.** Read `~/.local/state/jscad-chat/last-review` with the
   Read tool; it holds one ISO time, or does not exist on the first review.
   Note the current time as the review time. Run, from the repo root:

   ```bash
   npm run read-log -w @jscadui/agent-loop -- --since <ISO time from last-review>
   ```

   Drop `--since` when the file does not exist. Add `--json` when you need a
   tool call's full input or result. Each conversation's summary header names
   the style it ran under (`fluent`, `modeling`, or `unknown` for a log from
   before the two-style split); the `--json` output carries the same value as
   `api`.

2. **List the stumbles.** For each conversation:
   - every failed tool call, with its error message and the source that
     caused it;
   - every turn where the user corrected the model ("no", "that's wrong",
     a repeat of the request, a changed dimension);
   - every turn that ended without a `write` or `edit` that built, or with
     the project's last build failing.

3. **Group by cause.** Stumbles with the same cause across conversations are
   one group: the same bad import, the same misread parameter style, the same
   wrong API call. Name each group by its cause, not its symptom.

4. **Reproduce each group as a fixture.** Add
   `packages/agent-loop/eval/fixtures/<name>.js`, where `<name>` is the
   fixture's `name`. The `prompt` is the user's message from the log,
   verbatim — never rewritten to steer the model toward the fix. The
   `checks` test properties any reasonable answer has, not one exact answer,
   so the fixture keeps testing the stumble even after the model's phrasing
   of a correct answer varies:

   ```js
   // <one line: the stumble this fixture reproduces>
   export const fixture = {
     name: '<name>',
     prompt: '<the user message from the log, verbatim>',
     requires: ['write'],
     verifyBeforeWrite: false,
     maxTurns: 8,
     checks: (m, { params = [], solid } = {}) => [
       { name: '<a property any reasonable answer has>', pass: /* from m.dimensions, m.volume, m.boundingBox, params, solid.watertight */ false },
     ],
     // For a follow-up request, add the prior turns and project files from the log:
     // transcript: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }],
     // files: { 'main.js': '...' },
   }
   ```

   Run the new fixtures on the current prompt, under the style the log
   conversation used (`EVAL_API`, default `fluent`):

   ```bash
   EVAL_API=<style> EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor EVAL_FIXTURES=<name>,<name> npm run eval -w @jscadui/agent-loop
   ```

   Confirm each fails the way the log shows: a nonzero mean `firstFail`, and
   the same error text in the run transcripts (`results[].transcript`, the
   tool messages with `"ok":false`) in the result file. A fixture that passes
   on the current prompt does not reproduce the stumble; rework its prompt or
   context until it fails, or drop it.

5. **Draft a prompt or example change.** Use the
   `llm-application-dev:prompt-engineering-patterns` skill, especially its
   few-shot reference (`references/few-shot-learning.md`). If that skill is
   not available, prefer a short example file over added prose, and keep
   prose edits to the Imports and Tool policy sections. Prefer a short
   example model in `prompt/examples/<api>/NN-<name>.js` that shows the right
   form over more prose, with its counterpart under the same name in the
   other style's folder. Each example opens with a one-line comment naming
   the request it answers (never the API), and must be listed in
   `prompt/index.js` in file-name order. Keep the prose short and concrete.

6. **Measure the candidate.** Run the suite on the candidate. Prefer
   `sci push jscadui/eval` (`ci/eval`, `ci/eval.conf`) for a full-suite run
   across every model — it runs on the CI host, not this machine, and keeps
   the models running concurrently; use a local run for a quick check of one
   model or a handful of fixtures. The default run (no `EVAL_FIXTURES`) is
   the CSG suite, primitives and boolean operations, which is what most real
   requests exercise, and the `harder` group, which always runs with it.
   `gear` sits in the opt-in `profiles` group, kept for experiments
   (`EVAL_FIXTURES=profiles` or `EVAL_FIXTURES=all`):

   ```bash
   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
   npm run eval -w @jscadui/agent-loop -- --compare <data>/results/<baseline>.json <data>/results/<candidate>.json
   ```

   Conversations run concurrently, `EVAL_CONCURRENCY` at a time (default 6),
   so the default suite at 3 runs takes minutes rather than an hour; a
   conversation's lines in the live log are prefixed
   `[<model> <fixture>#<run>] `. Model code runs in a crt sandbox, and the
   eval (and `--regrade`) refuses to start without it: run
   `scripts/eval-sandbox-setup.sh` once first
   (`packages/agent-loop/docs/user-manual.md`, "Sandbox setup").

   The turn budget is per model: `packages/agent-loop/eval/models.json` sets
   `maxTurns` for a model, `EVAL_MAX_TURNS` overrides it for one run, and a
   model with no entry gets each fixture's own `maxTurns`. The goal is a
   correct model within the budget, fixing mistakes across turns, not a
   one-shot answer, so judge a change by multi-turn success and `rounds`
   rather than by first-attempt failures alone.

   Baselines compare within one API style. Each result file records its
   `api` and names it (`<time>-<model>-<api>-<sha8>.json`), each style's
   prompt has its own `promptSha256`, and `--compare` refuses two files of
   different styles. The baseline for a style is the newest result file in
   `<data>/results/` (`$JSCAD_CHAT_DATA`, default `~/src/jscad-chat-evals`)
   for that style and its current prompt (its `promptSha256` matches the
   committed prompt for that style); run one if none exists. A change to
   shared prose (`prompt.md`) changes both prompts, so measure it under both
   styles; `ci/eval` runs every model under every style in `EVAL_APIS`.

   Whether to keep a change is a judgement, made fresh each round and shown
   to the user. For every model and style measured:
   - Show the per-fixture comparison against the previous run
     (`--compare <previous> <candidate>`): mean total, `rounds`, input and
     output tokens and seconds for each fixture, and the suite total.
   - Say which differences are within noise. At 3 runs one bad run moves a
     fixture's mean total by about 0.67, so a move of that size on one
     fixture, or a suite total that moves by a few such steps spread across
     fixtures, may be one run going the other way. Rerun a fixture on its own
     when the decision hangs on it.
   - Read the transcripts behind every change that matters, better or worse
     (`results[].transcript` in both files): what the model did differently,
     and whether the prompt or example change caused it or the run was luck.
   - State the decision, keep, revert or revise, with its reason: which
     fixtures moved, why, and what the transcripts showed.

7. **Show and commit.** Show the user the prompt/example diff, the
   comparison and the decision from step 6. On approval, commit the prompt,
   examples and fixtures in jscadui; then, in the evals repo, `git -C <data> add logs results` and
   commit the new log and result files, with a message naming the jscadui
   commit it goes with. Push the evals repo (`jbroll/jscad-chat-evals`, the
   user's private repo). Never push jscadui without asking, and never open a
   pull request. Write the review time from step 1 to
   `~/.local/state/jscad-chat/last-review` with the Write tool.
