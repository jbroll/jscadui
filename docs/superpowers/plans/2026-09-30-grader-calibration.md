# Complex grader calibration

Working plan on `grader-calibration`; delete before merge. Background:
`docs/backlog.md`, "Calibrate the complex grader", and the first pass
`~/src/jscad-chat-evals/results/2026-09-30T230517Z-*-complex-*` (30 of 118
judged a success; a read of 34 runs found 21 false failures and 16 unfair
descriptions).

## Goal

Complex verdicts agree with a reviewed label set on at least 85% of runs,
measured by re-rendering, re-describing and re-judging the first pass on the
CI host, with no new conversations. The trial validation cases still match
(`ci/grader-validate`). Single-shot grading is unchanged.

## Global constraints

- Same rules as the rest of `packages/agent-loop/eval`: ES2022 modules,
  test-first, comments one or two lines (why only), plain-words docs in the
  same commit, no shell sleep/poll loops, model code only in crt executors,
  renders only in the run-eval parent, keys never printed.
- Commit trailers:
  `Co-Authored-By: <model> <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UHngnCmdqG3AKiiGGC9mbv`
- Changing the views, palette or describer prompt changes
  `DESCRIBE_PROMPT_SHA256` only if the prompt text changes; changing the
  judge prompt changes `JUDGE_PROMPT_SHA256`. `--compare` already refuses
  files whose hashes differ; that is intended.

## Task 1: renders the describer can read

`eval/views.js`, `eval/render/page.html`, tests, `docs/architecture.md`
(Rendering).

- A part with no colour gets one from a fixed palette by its index among the
  uncoloured parts, instead of neutral grey for all:
  `#c8553d #3d7cc8 #5aa05a #d4a017 #8e5bbf #3fb0b0 #d07a3a #8a8a8a`, cycling.
  A model whose parts are all coloured renders as before.
- The `side` view moves off the pure elevation, which Moondream read as a
  silhouette ("laptop", "no windows"): direction `(0.25, -1, 0.35)`, label
  stays `side view`.
- Test: a two-part uncoloured model renders its parts in two different
  palette colours (pixel check, as `render.test.js` does for red).

## Task 2: a judge that can count pieces and knows views disagree

`eval/judge.js`, `eval/judge.test.js`, docs (`user-manual.md` Describe and
judge, `architecture.md` Complex grading).

The judge message becomes, verbatim:

```
The user's message(s):
"{message 1}"
"{message 2}"

Measured result: overall size {W} x {D} x {H} mm, {G} separate piece(s).

A describer looked at three renders of the result (front three-quarter, back three-quarter and a raised side view) and described each view on its own, without seeing the request. It can misread a single view, so the views may disagree; judge the object they describe together. The describer does not know what the object is for and often names it by its shape alone ("a box with holes", "a U-shaped bracket"); judge whether the shapes and parts it describes would do what the user asked for, not whether it uses the user's words.
{description}

Did the result succeed at what the user asked for? Answer SUCCESS if the user who made the request would accept the model as what they asked for. A generic shape, missing major parts, or parts floating apart are FAILURE. Still renders cannot show motion or removal: a visible hinge, pivot, or separate piece counts for a part that moves or comes off, and a fitting counts when its opening or shape is there. Do not fail it for colours, style, or details the user did not ask for. Answer SUCCESS or FAILURE, then one line why.
```

- `{W} x {D} x {H}` from `run.render.facts.dimensions` rounded to whole mm;
  `{G}` from the `connected` gate's `groups`. When either is missing, leave
  out that clause (and the whole line if both are).
- `judgePrompt` takes the run (or `{ messages, description, facts, groups }`)
  rather than two strings; `JUDGE_PROMPT_SHA256` hashes the template with
  placeholders.
- Tests: the line appears with facts, is dropped without, and the hash
  changes from the old prompt's.

## Task 3: unbuilt runs count against verdictRate

`eval/report.js` (`summarize`), tests, `user-manual.md`.

- A complex run whose `builds` gate failed counts as a judged failure in
  `verdictRate` (it already scores geometry 0). Runs left out stay left out:
  `renderError`, `graderError`, `verdictPending`, `infraError`,
  `providerError`.
- Test: two successes and one unbuilt run give `verdictRate` 2/3.

## Task 4: recalibrate a pass on the CI host

`eval/describe.js` (`--rerender --all`), `eval/rerender.js`,
`eval/grader-agreement.js` (new) + test, `ci/regrade-complex` (new),
`ci/README.md`, `user-manual.md`.

- `npm run describe -- --rerender --all <files>` renders every rendered or
  stale run again (not only stale ones), then describes every run.
- `eval/grader-agreement.js <labels.json> <result files…>`: labels are
  `[{ "file": "<result file name>", "fixture": "…", "run": 1, "expected":
  "success" | "failure", "note": "…" }]`; prints, per label, the run's
  verdict (or why it has none) and whether it agrees, then agreement as
  `agree/labelled` and the disagreements; exit 0 always. Export a pure
  function for the test.
- `ci/regrade-complex`: for every complex result file in `regrade-input/`,
  copy to `regrade-output/` (never touch the input), check the sandbox and
  the describer (`scripts/describer-setup.sh --check`) and install
  Playwright chromium as `ci/eval-complex` does, run
  `describe -- --rerender --all`, then `judge -- --all`, then
  `grader-agreement` when `regrade-input/labels.json` exists. Exit non-zero
  when a stage fails, as `ci/eval-complex` does (judge skipped on a describe
  exit of 2).
- Docs: how to recalibrate a pass: copy the result files (not their
  `.renders` directories, which the host makes again) and `labels.json` into
  `regrade-input/`, `sci push jscadui/regrade-complex`, and fetch
  `regrade-output/` within `CI_WORKTREE_TTL`.

## Task 5: the label set (data, evals repo)

From the read of the first pass
(`scratchpad/complex-pass/summary.json`, 34 reviewed runs plus the 10
proposed approved answers), write
`~/src/jscad-chat-evals/calibration/2026-09-30T230517Z-labels.json` in the
Task 4 format. Expected is the reviewer's read of the renders against the
request, not the old verdict. Committed to the evals repo with the user's
sign-off of the label set.

## Loop

1. Baseline: the old grader's agreement on the labels (12 of 34 reviewed,
   plus the approved answers).
2. After Tasks 1-4: `sci push jscadui/regrade-complex` with the four files
   and `labels.json`; read the disagreements beside renders.
3. Adjust the judge prompt or describer prompt; repeat until agreement is at
   least 85%, with `ci/grader-validate` still matching. Each round costs
   about 360 judge calls and a few minutes of describer time.
