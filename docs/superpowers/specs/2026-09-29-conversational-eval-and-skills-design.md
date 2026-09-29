# Conversational eval with a simulated user, and on-demand skills

Status: draft for review. Working document on `chat-review-3`; fold into the
permanent docs and delete before merge.

## Goal

The app is moving toward a conversation: the user asks, the agent builds or
asks back, the user corrects, the agent refines. The eval today scores one
user message per run, so it cannot tell a useful question from a wasted one,
and it scores any question as a failure. This spec adds:

1. a dialogue suite in which a cheap fixed model plays the user, answering
   from a hidden intent;
2. a `skill` tool that loads short procedures on demand, so the base prompt
   stays small;
3. the existing single-shot suite, unchanged, as the regression floor.

## Evidence from the current runs

From the 2026-09-29 CI results (`c0beff44` fluent, `8e14ddee` modeling, 3 runs
per fixture, cap 8 rounds):

- Muse, fluent, `pegboard` run 3: one round, no tool calls, six clarifying
  questions (size, hole pitch, thickness, borders, mounting, printer). Total 4
  of 8 (discipline 0, geometry 0). The other 11 Muse pegboard runs in the four
  files built a default and scored 8. The single-shot suite has no way to answer the
  questions, and a user would likely have accepted a default for all six.
- DeepSeek ends without saving on the larger models: `phone-stand` in 11 of 12
  runs across the four files, `shelf-bracket` 8 of 12, `enclosure` 5 of 12,
  each hitting the cap (rounds 9: eight plus the cap's closing round). In
  `phone-stand` run 2 (fluent) it ran five full-source `eval`s of 2.0 to 2.6 KB,
  checked three of them watertight, and never called `writeModel`, though all 11
  tool results carried the `notSaved` notice. Two problems show: whole-file rewrites
  spend a round per change, and a clean model is not saved before refining.
- Muse left only three runs unsaved in the same four files.

## Part 1: the simulated user

### Fixture shape

A dialogue fixture is an ordinary fixture file with `group: 'dialogue'` and
three more fields:

```js
export const fixture = {
  name: 'router-mount',
  group: 'dialogue',
  prompt: 'a wall mount for my wifi router',
  persona: 'Hobbyist, prints on a Prusa MK4. Measures with a ruler in mm. Short answers, no CAD terms.',
  intent: {
    router: { value: '180 x 120 x 35 mm, cables out the back', ask: true },
    fixing: { value: 'two screws into drywall anchors', ask: false },
    clearance: { value: 'about 20 mm behind it for the cables', ask: false },
  },
  followUps: [{ message: 'can you make it tilt the router forward a bit?', checks: (m, ctx) => [/* ... */] }],
  maxUserTurns: 4,
  requires: ['eval', 'writeModel'],
  maxTurns: 8,
  checks: (m, ctx) => [
    { name: 'holds a 180 x 120 x 35 router', fields: ['router'], pass: /* ... */ false },
    { name: 'has two screw holes', fields: ['fixing'], pass: /* ... */ false },
  ],
}
```

- `prompt` stays what a user would type, under the same rules as today.
- `intent` is the concrete spec the user has in mind, one entry per fact. `ask`
  is `true` when no sensible default exists and a wrong guess wastes the build
  (the router's size), `false` when a default is fine and a param or a
  follow-up fixes it (the screw count). Anything not listed is open: the user
  has no opinion.
- `persona` says how the user answers and what they know: units, vocabulary,
  patience, whether they give numbers or impressions ("a bit wider").
- `checks` test the intent's spec, not only what the prompt says. Each check
  names the intent `fields` it tests, which is how the harness knows what the
  user would see as wrong.
- `followUps` (optional) are sent in order after the model is accepted, each
  with its own `checks`. They test the refine path: a small change to a saved
  project.
- `maxUserTurns` (default 4) caps the user's replies, follow-ups included.

Fixtures come from two places: new casual requests, and chat-log
conversations in which the user corrected the model (chat-review step 2
already lists these). For a log conversation the intent is what the user's
later messages revealed.

### The loop

`runJob` calls a new `runDialogue(fixture, run, options)` for a fixture with
`intent`, and `runConversation` as today otherwise. One dialogue is:

1. Send the opening prompt through `runTurn`, as `runConversation` does.
2. After the turn, grade the saved project in a fresh executor (the existing
   `backend.gradeProject(gradedModel(...))`), giving `measure`, `params`,
   `solid` and the fixture's check results.
3. Decide:
   - the turn saved a model and every check passes: accepted. Send the next
     follow-up if any, else end.
   - otherwise, ask the user model for a reply, and send it as the next user
     message.
4. End on acceptance of the last stage, when the user model gives up, at
   `maxUserTurns`, at `EVAL_RUN_TIMEOUT`, or on a provider or infrastructure
   error.

Acceptance is decided by the harness from the checks, not by the user model.
The user model sees only text, and a model that could declare acceptance is
open to an agent reply that says "looks great, accept". The checks are what a
user would see in the viewer.

Each later user turn is built the way the app builds it
(`apps/jscad-web/src/aiChat.js`): `buildMessages` with the prior turns as
user and assistant text only, the project's current files, and the new
message. Tool calls and tool results do not carry over between user turns in
the app, so they must not in the eval. The stored `transcript` keeps every
turn in full, tool calls included, for grading and review.

The conversation's executor persists across user turns, so the project files
written in turn 1 are there in turn 2, as in the app.

### What the user model sees and returns

Its system prompt is fixed text in `eval/`, plus the persona and the intent.
Each call gets:

- the opening prompt and the conversation so far, as text;
- a "what you see" block from the grade: bounding box dimensions, the params
  with their values, and, for each failing check, its name and fields. No
  source, no tool results.

Rules in its prompt: answer only what the agent asked, from the intent, in one
to three sentences in the persona's voice; for an open field say "whatever you
think"; when a check fails and the agent did not ask anything, say what looks
wrong in the persona's terms; never recite the intent; give up only when the
agent asks again for something already answered.

It returns JSON:

```json
{ "reply": "...", "asked": ["router"], "named": ["clearance"], "giveUp": false }
```

- `asked`: the intent fields the agent's last message asked about, plus
  `"open"` for a question about something the intent leaves open.
- `named`: the intent fields the agent's message stated an assumed value for
  ("I made it 20 mm deep behind the router").

The harness caps `reply` at 600 characters and flags a leak when the reply
contains an intent value for a field that is neither in `asked` nor failing.
Leaks are counted per run and reviewed; they are a harness bug, not an agent
score.

### Budget, keys and sandboxing

- Rounds: each user turn gets the model's usual cap (`eval/models.json`
  `maxTurns`, 8 for both models today), through a fresh `withTurnCap` per
  turn. The result records `rounds` as the sum and `roundsPerTurn` as a list.
  The app has no round cap; the eval cap stands in for user patience, as now.
- The user model makes one call per user turn, at most `maxUserTurns` calls,
  with a small output cap (300 tokens) and no tools. Its tokens and time go to
  `metrics.user` (`calls`, `inputTokens`, `outputTokens`, `seconds`), never to
  the agent's `rounds`, tokens or speed.
- It runs in the `run-eval` process through the existing provider adapters and
  `fetchWithRetry`. It runs no code and gets no tools, so it needs no
  executor. Its key never reaches an executor, like the agent's.
- Configuration: `EVAL_USER_PROVIDER` and `EVAL_USER_MODEL`, defaulting to a
  pinned entry in `eval/models.json` (`"user": { provider: "opencode-go",
  model: "deepseek-v4.1-flash", temperature: 0 }`). The key comes from the same lookup as `EVAL_PROVIDER`'s
  (`keys.json`, then the provider's auth file). On CI the job user's
  `keys.json` needs that provider's key.
- A user-model reply that is not valid JSON is retried once; a second failure,
  or a provider error that survives the retries, marks the run
  `userError: true`, left out of the means like `providerError`.

### Scoring

The four existing grades (discipline, recovery, geometry, conservation) are
computed over the whole transcript as today, with geometry from the final
stage's checks. The dialogue adds:

| metric | meaning |
|---|---|
| `accepted` | every stage's checks passed within the caps |
| `userTurns` | user replies before the first acceptance (0: the first build was right) |
| `checkRate` | fraction of the final stage's checks passing |
| `necessaryQuestions` | questions about `ask: true` fields |
| `unnecessaryQuestions` | questions about `ask: false` fields, open fields, or fields the prompt already gives |
| `missedQuestions` | `ask: true` fields the user had to correct without being asked |
| `assumptionsStated` | of the `ask: false` fields the agent guessed, the fraction it named in its text |
| `askedWithoutBuilding` | turns that ended with a question and no saved model |

Proposed dialogue total, 0 to 8, so the keep rule can use a sum of means:

- outcome: 2 accepted, else 0;
- turns: 2 for 0 or 1 user replies before acceptance, 1 for 2, else 0;
- questions: 2 for no unnecessary question, 1 for one, else 0;
- assumptions: 2 when `assumptionsStated` is at least 0.75, 1 at 0.25, else 0.

A question about an `ask: true` field costs a user turn but is not penalised
as unnecessary, so asking it first and guessing it wrong both land at one
reply; guessing it right scores best, as it would for a real user.

Result files for the dialogue suite are named
`<time>-<model>-<api>-dialogue-<sha8>.json`, record `suite: 'dialogue'` and
the user model's id and prompt hash, and `--compare` refuses a single-shot
file against a dialogue file, or two dialogue files with different user
models. `--regrade` recomputes the transcript-derived grades and the final
checks; the user model's classifications (`asked`, `named`) stay as stored,
since recomputing them needs provider calls.

### Keeping variance down

- One fixed user model at temperature 0, pinned in `eval/models.json`. The
  provider adapters send no `temperature` or `seed` today; both become
  optional provider config, used only for the user model.
- A per-run seed, a hash of fixture name and run number, where the provider
  takes one. OpenAI-style chat completions accept `seed` on a best-effort
  basis; the Anthropic Messages API has none. Where there is no seed,
  temperature 0 and short replies are the control.
- Acceptance from checks, not from the user model, removes the largest source
  of judge noise.
- 5 runs per dialogue fixture rather than 3, since a dialogue has more steps
  that can vary (open question 3).
- Before any prompt change is measured against it, the dialogue suite is run
  twice on the same prompt; each fixture's mean dialogue total must agree
  within 1.0 between the two, or the user prompt or the fixture is fixed
  first.

## Part 2: the single-shot suite stays

The default run (ungrouped fixtures) is not changed: same prompts, checks,
grades and caps. The `dialogue` group is opt-in (`EVAL_FIXTURES=dialogue`), as
`profiles` is. Every step below must pass the chat-review keep rule on the
single-shot suite as well as improve its own target. `ci/eval` runs the
dialogue suite as a separate pass per model and style, writing its own result
file.

## Part 3: on-demand skills

### Why not the superpowers skills as they are

- They are long. The small models under test follow short, concrete text
  better, and every loaded page costs context in an 8-round budget.
- Brainstorming gates any work on an approved design and asks one question
  per message. For "a pegboard panel" that is several exchanges before any
  geometry, where a maker expects a model and sliders.
- Planning and execution assume plan files, git, subagents and tests. The app
  has a project of model files and a viewer.

What carries over are three habits: ask only what matters, split a big job
into parts, check before claiming done.

### The `skill` tool

`skill({ name })` returns one procedure's text. It works the way `docs` does:
a pure function, `skillTool(name, { api })` in `src/skills.js`, used by the app
and the eval alike. An unknown name answers
`{ ok: false, error: { name: 'NotFoundError', message: 'no skill <name>; skills: ...' } }`.

- Procedures live in `packages/agent-loop/prompt/skills/<name>.md`, imported as
  `?raw` like the prompt. Each stays under about 250 words. Prose is shared by
  both styles; any code in one is CommonJS layout that reads the same in both
  (`require('./lid.js')`), with no API calls, so the style rules still hold.
- The base prompt gets a short `## Procedures` section listing each procedure
  with one line on when it applies, and the tool's description repeats the
  names. That list is the only trigger; nothing forces a load.
- `promptSha256` covers the system prompt and every procedure file, since the
  procedures are prompt text.
- `metrics.skillCalls` counts loads per name, transcript-derived, so
  `--regrade` fills it.
- The app answers `skill` in its `requestTool` from the bundled text, like
  `docs` from `apiIndex.js`, with no worker call. The tool and the app's
  handler ship in the same commit, since `buildTools` is shared.
- In the app a tool result does not survive to the next user turn, so a
  procedure loaded in one turn must be loaded again in a later one. At under
  250 words that is cheap; the dialogue suite shows whether models do it
  (open question 6).

If a model rarely loads a procedure where it applies (low `skillCalls` on the
target fixtures), the fallback is a two-line version of it in the base prompt,
measured the same way.

### clarify-or-default

When: the request leaves out sizes or features that change the build.

Procedure: build a sensible default from common sizes and the request's
context; state the assumed values in one or two lines; expose the key
dimensions as params; ask only about a fact a wrong guess would waste the
build on (the size of the user's own device, which board), and then ask that
one thing, alongside the default build where one is possible.

Measured by: the dialogue suite (`unnecessaryQuestions`, `missedQuestions`,
`assumptionsStated`, `userTurns`), and in the single-shot suite by
`askedWithoutBuilding` on `pegboard` and the other underspecified fixtures.

### plan-then-build

When: the object has two or more parts that fit together, or a part with
several features that each need their own measurement.

Procedure: list the parts and how they meet (which faces touch, which
clearances matter); write each part in its own file exporting a function;
write `main.js` early, returning the parts as an array; build and measure one
part at a time with `measure({ parts })` and `between` for the gaps; save
after each part measures right; change one part's file per step rather than
rewriting the whole project.

This uses what exists: `writeModel` with `entry` writes one file and re-runs
`main.js`; `eval` runs with the project's other files beside it; `measure`
takes part selectors and a `between` pair. It targets the DeepSeek pattern
above, where each change is a 2 to 3 KB rewrite that costs a round.

Measured by: 2 or 3 new single-shot fixtures in an `assembly` group, for
example an enclosure with a lid and board posts, a pair of shelf brackets with
a cleat, and a drawer in a frame. Their checks test fit, not process: the lid
covers the base's opening, the drawer clears the frame by a plausible gap, the
posts sit inside the walls. A single-file answer that fits passes. Grading
needs two changes for these:

- the grade measures each part as well as the whole (`m.parts`), so checks can
  test fit between parts;
- conservation counts `writeModel` calls per file, not in total, since
  `writes <= 2` would penalise a three-part build that saves each part once.

The `assembly` group gets its own baseline on the current prompt before the
procedure is added. Whether it joins the default suite later is open
question 7.

### verify-before-done

Mostly there already: the Tool policy says to verify with `measure` and
`check` before claiming a result and to save once the model measures right,
and `eval`, `measure` and `check` results carry `notSaved`. It stays in the
base prompt; it is short and applies to every request, so it is not a
procedure.

The gap is the one the DeepSeek runs show: a clean, unsaved model gets refined
until the cap. Following the chat-review rule of fixing the tool side first,
the addition is a stronger notice: when `check` reports a watertight model and
the geometry is not saved, the result says
`"this model checks clean and is not saved; call writeModel now, then refine"`.
Measured by the `saved: false` rate on `phone-stand`, `shelf-bracket` and
`enclosure`.

## Part 4: rollout

Each step is measured under both styles and both models, and kept only if it
passes the chat-review keep rule (target fixtures improve; the suite-wide sum
of mean totals does not fall; no fixture's mean total falls by more than 1.0
or its mean `rounds` rises by more than 2.0) on the single-shot suite, plus
the step's own gate.

1. **Harness and dialogue fixtures, no prompt change.** 4 to 6 dialogue
   fixtures: at least one where every field is defaultable (`pegboard`'s
   request), one with an `ask: true` field (a device only the user has), one
   with a follow-up. Gate: the single-shot results are unchanged (the prompt
   hash is the same, and a `--regrade` of the current baseline files changes
   nothing); two dialogue runs on the same prompt agree within 1.0 per
   fixture; no leaks; a read of ten transcripts finds the user answers
   plausible.
2. **`skill` tool with clarify-or-default, app handler included.** Gate:
   dialogue `unnecessaryQuestions` and `askedWithoutBuilding` fall, `accepted`
   does not fall, `assumptionsStated` rises; single-shot keep rule.
3. **`assembly` fixtures and the two grading changes**, baselined on the
   current prompt. Gate: `--regrade` of the existing baselines moves no
   single-shot fixture's total (conservation per file only matters where a
   run wrote several files).
4. **plan-then-build.** Gate: on `assembly`, fewer unsaved runs and fewer
   rounds, `checkRate` not lower; on `phone-stand`, `shelf-bracket` and
   `enclosure`, `saved: false` falls for DeepSeek; single-shot keep rule.
5. **verify-before-done notice.** Gate: `saved: false` falls on the same three
   fixtures; single-shot keep rule.

Steps 4 and 5 target the same unsaved runs, so they are measured apart, not
together; if step 5 alone fixes the saving, step 4 is judged by rounds and
the assembly fixtures only.

## Where it lands in the permanent docs

- `packages/agent-loop/docs/user-manual.md`: dialogue fixtures, the user-model
  settings, the dialogue metrics, the `skill` tool.
- `packages/agent-loop/docs/architecture.md`: the user model's place beside
  the sandbox (no executor, keys in `run-eval` only), and why acceptance comes
  from checks.
- `packages/agent-loop/docs/development.md`: `prompt/skills/` and its rules.
- `.claude/skills/chat-review/SKILL.md`: corrected conversations become
  dialogue fixtures; the keep rule covers the dialogue total.

## Open questions

1. **Which user model.** Decided: `deepseek-v4.1-flash` through
   `opencode-go`, the cheap model, whose key is already in the CI job's
   `keys.json`. It is also under test, so when it plays both sides the two can
   share habits. Three things limit that: acceptance comes from the checks,
   not the user model's judgement; the user model answers only from the
   hidden intent, under its own system prompt, at temperature 0 with no tools;
   and result files record the user model, so a later switch to another model
   shows up in `--compare`.
2. **Cost per CI run.** The four latest single-shot files used about 4.5M input
   and 1.8M output agent tokens (138 runs). A dialogue pass of 5 fixtures ×
   5 runs × 2 models × 2 styles is 100 conversations of up to 4 user turns;
   expect the agent side to roughly match the single-shot spend, so a full CI
   run about doubles. The user model adds at most about 400 calls of 2 to 3K
   input and 300 output tokens, about 1.2M input and 0.12M output. Should the
   dialogue pass run on every eval push, or only for prompt and skill changes?
3. **Runs per dialogue fixture**: 5, or 3 to match the single-shot suite and
   halve the cost.
4. **Acceptance by checks** (proposed) or by the user model's judgement.
5. **One dialogue total** for the keep rule (proposed), or the separate
   metrics judged one by one.
6. **Procedures across user turns in the app**: reload on demand (proposed),
   or the app remembers loaded procedures and adds them to the next turn's
   system prompt.
7. **`assembly` in the default suite** once baselined, or opt-in like
   `profiles`.
