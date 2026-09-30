# Conversational eval with a simulated user, grading by description, and on-demand skills

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
3. the existing single-shot suite, unchanged, as the regression floor;
4. grading for requests at the level of a real session ("we need a model of a
   toy caboose"), which property checks cannot grade: a vision model describes
   renders of the result without seeing the request, and a text model judges
   the description against the user's messages;
5. a `view` tool, sharing the grader's renderer, for models that read images.

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

Proposed dialogue total, 0 to 8, so the chat-review comparison can use a sum of means:

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
`profiles` is. Every step below must hold up under the chat-review step 6 judgement on the
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
needs one change for these: the grade measures each part as well as the whole
(`m.parts`), so checks can test fit between parts. Conservation does not
count `write` and `edit` calls, so a three-part build that writes each part
costs nothing there.

The `assembly` group gets its own baseline on the current prompt before the
procedure is added. Whether it joins the default suite later is open
question 7.

### verify-before-done

Superseded on the chat-review-4 branch by the project environment: every
`write` and `edit` saves and builds, so nothing is left unsaved, and its build
report (size, volume, watertightness) counts as verification in grading.

## Part 4: grading complex requests by blind description

Superseded by `2026-09-30-blind-description-grading-design.md`, which sets
the describer (Moondream 3.1 on the CI host), the judge (DeepSeek v4.1
flash), three views, the `connected` gate and the staged pipeline from the
2026-09-30 trials. The text below is the earlier draft.

Real sessions ask for whole objects. Muse answered "we need a model of a toy
caboose" with a red cabin on a black chassis, end beams, an overhanging roof
and a cupola with windows. No set of section and size checks tells a caboose
from a boxcar or a shed on wheels, and checks written for one caboose would
grade one shape, which the fixture rules forbid. A new `complex` group is
graded instead by deterministic gates for what can be measured, and one
overall verdict for the rest, from a judge who reads a description written by
a model that never saw the request.

### Pipeline

For each run of a `complex` fixture:

1. The conversation runs as today. The fixture's `followUps` are sent in
   order after each turn ends, whatever the turn built, each through
   `buildMessages` with the prior turns as text, as in Part 1.
2. The final project is graded in a fresh executor (`gradeProject`) with the
   `bodies` probe, and the same executor is then asked for the mesh
   (Rendering below).
3. The gates run: the project builds to geometry, the geometry is watertight,
   and the fixture's own `gates` hold.
4. When it builds, the `run-eval` parent renders six views of the mesh.
5. The describer gets the views and the measured facts and writes a
   description. One call.
6. The judge gets every user message and the description and returns a
   verdict. Three calls; the majority wins.
7. Geometry points come from the gates and the verdict (Scoring below);
   discipline, recovery and conservation come from the transcript as today.

A project that does not build skips steps 4 to 6 and scores geometry 0.

The describer never sees the prompt, the transcript, the source, file names
or parameter names, since any of them can name the object (`cupolaHeight`).
The judge never sees the assistant's text, tool calls, source or renders. It
gets what the user asked and an independent account of what came out, so an
agent that writes "here is your caboose" over a box gains nothing.

### Fixture shape

```js
export const fixture = {
  name: 'toy-caboose',
  group: 'complex',
  prompt: 'we need a model of a toy caboose',
  requires: ['write'],
  maxTurns: 8,
  gates: (m, { solid, probe }) => [],
}
```

`gates` in place of `checks` marks a fixture for grading by description. The
harness adds `builds` and `watertight` to every such fixture; the fixture
lists only what its user messages state: a size ("my desk is 20mm thick") or
a count of separate parts ("a pawn and a knight", "a removable roof"). A gate
tests the stated value with a tolerance, using the existing probes, and never
something the user left open. `followUps: [{ message }]` holds later user
messages. They have no checks of their own; the judge reads them all.

### Rendering

Rendering needs WebGL, which the crt sandbox does not have and should not
get. It runs in the `run-eval` parent, in Playwright's bundled chromium
(swiftshader, `--use-gl=angle`, launched as `apps/jscad-web/e2e/render-all.mjs`
does; the system chromium cannot create a headless WebGL context). The page
is a local file, `eval/render/page.html`, drawing with three.js, which the
workspace already has for jscad-web. It loads no model code: it gets triangle
arrays and colors, and every network request it makes is refused. Model code
still runs only in the executor.

An offscreen renderer in Node (headless-gl, or a rasterizer in JS) was
considered and not chosen: the repo has neither, headless-gl needs a native
build on the CI host, and a rasterizer is a project of its own. `ci/render`
already installs the bundled chromium on the same host; `ci/eval` adds the
same `npx playwright install chromium` step.

A grade reply is capped at 1 MB, too small for a detailed mesh. After the
grade, the grade executor answers a new `mesh` request with each body's
color and its triangles as base64 Float32 positions, split across frames
under the 1 MB cap, up to 24 MB in all (about 700,000 triangles). The parent
checks the shape (finite numbers, a multiple of 9 per body) before drawing.
Model code shares that executor and can lie about the mesh as it can about
the grade (`packages/agent-loop/docs/architecture.md`, Sandbox), which only
changes how its own model looks. A mesh over the cap records `renderError`;
the run is left out of the verdict means like an `infraError` and reviewed.

Six views, each 768 x 768 PNG, framed to the model's bounding sphere with a
10% margin:

| view | camera |
|---|---|
| `iso-front` | perspective, from -X -Y (azimuth -45°), 30° above |
| `iso-back` | perspective, from +X +Y (azimuth 135°), 30° above |
| `front` | orthographic, from -Y |
| `side` | orthographic, from +X |
| `top` | orthographic, from +Z |
| `bottom` | orthographic, from -Z |

Each body is drawn in its own color (`colorize` in the model) or neutral
grey, lit from the camera, with dark lines on edges where faces meet at more
than 30°, on a light background. The two iso views show a floor grid of 10 mm
squares. At 768 px a cupola window on a toy-sized model is a few dozen pixels
across, and the image stays near one tile on most vision APIs. Close-ups are
left out of the first version (open question 11).

Each `run-eval` process starts one chromium and renders one view at a time,
one page per render. Render time is measured in rollout step 6; swiftshader
is expected to take under a few seconds per view.

The describer also gets, as text: the overall size in mm (x, y, z), the body
count, each body's size and centre (the largest 12, largest first), each
body's color when set, and the volume. Images carry no scale, so this is how
it tells a toy from a building.

### The describer

A vision model, one call per run, temperature 0, output capped at 500 tokens.
Its prompt, in outline:

- You see six rendered views of one 3D model someone designed for 3D
  printing, and its measured sizes. Z is up in the renders. The model may lie
  in any orientation, so the view names do not say which side is its front.
  Grid squares are 10 mm.
- Say first what the object is, in one sentence, and how sure you are. If
  unsure, say what it looks most like.
- Then describe it: its main parts, their shapes, rough proportions and sizes
  in mm, colors, openings and hollows, separate pieces and how they sit
  against each other, and anything that looks broken (floating parts, holes in
  surfaces, parts cutting through each other).
- Identify the object by its shape. Report any lettering as lettering, and do
  not name the object from lettering alone.
- 100 to 300 words of plain prose.

It is told nothing about the request, the eval, or what kinds of object to
expect.

### The judge

A text model, three calls per run, temperature 0 where the provider takes
it, output capped at 150 tokens. Its prompt, in outline:

- A user asked for a 3D model in the messages below; later messages revise
  earlier ones. Someone who never saw the messages looked at the result and
  wrote the description below.
- Decide one thing: would this user, reading the description, find the
  request met overall? It passes when the object is recognisably what they
  asked for and has the things they named (a removable roof, a saucer, a
  knight). Proportions, details, style, and colors they did not ask for do not
  fail it.
- Sizes the user stated are checked separately; ignore them. A size that
  makes it a different kind of thing (a toy 2 m long) still fails.
- Motion cannot be seen in still images: a visible hinge, pivot or separate
  part that could move counts.
- An object identified only by its lettering fails.
- Answer in JSON only.

### Verdict format

Each judge call returns:

```json
{ "success": true, "reason": "A red caboose with a cupola on a black wheeled chassis." }
```

`reason` is one line, cut at 200 characters. A reply that is not this JSON is
retried once; a second failure makes that vote `null`. The run's verdict is
the majority of the non-null votes. A tie, or no valid vote, sets
`graderError: true`, and the run is left out of the means like a
`providerError`.

### Scoring

The four 0-2 grades stay. Only geometry changes for a `complex` fixture:

- 2: the verdict is success and every gate passes;
- 1: the verdict is success and a gate fails (not watertight, a stated size
  missed);
- 0: the verdict is failure, or the project does not build.

A wrong object that happens to be watertight scores nothing, and a right one
that misses a stated size keeps a point (open question 16). `checkRate` is
the fraction passing over the gates plus the verdict as one more entry. The
summary adds `verdictRate` per fixture, the fraction of runs judged a
success. A turn that ends with a question and no model scores geometry 0, as
today; the group runs without the simulated user (open question 12).

### Variance

- One description per run, at temperature 0. It is the costly call, and
  judging several descriptions of one model would mix describer noise into
  the verdict.
- Three judge calls per run, majority. Every vote is stored, so a fixture
  whose votes often split shows up in review. If validation finds the three
  never disagree, the judge drops to one call (open question 10).
- Pinned describer and judge models and prompts. Result files record both
  model ids and both prompts' SHA-256, and `--compare` refuses two `complex`
  files that differ in any of them.
- 3 runs per fixture, as in the single-shot suite.

### Models

The judge must not be a model under test (`muse-spark-1.3-contributor` and
`deepseek-v4.1-flash` today), since it would share that model's idea of a
caboose. The describer should not be one either, for the same reason, and
should differ from the judge, so one model's blind spot is not counted twice.

The describer needs image input through a key the CI job already has,
opencode-go or Meta. Candidates to trial through opencode-go, in this order:
`qwen3.8-max`, `kimi-k3`, `gpt-6-luna`, `grok-4.7`, and
`deepseek-v4-flash-vision-exp` last, since it shares a family with
`deepseek-v4.1-flash`. On Meta, a Muse model that takes images, if the API
lists one. The catalog does not say which models take images, so each
candidate is first sent one known render; only one whose reply describes it
enters validation. The judge is a text model from the same list that is not
the describer: `kimi-k3` is proposed, or `qwen3.8-max` if `kimi-k3` becomes
the describer.

The provider adapters send text only today. The describer needs an image part
per API surface: `image_url` with a data URL for chat completions,
`input_image` for Responses, a base64 `image` block for Messages.
Configuration follows the user model's: `EVAL_DESCRIBER_PROVIDER` and
`EVAL_DESCRIBER_MODEL`, `EVAL_JUDGE_PROVIDER` and `EVAL_JUDGE_MODEL`,
defaulting to pinned `describer` and `judge` entries in `eval/models.json`,
with keys from the same lookup. Grader calls run in `run-eval`, never in an
executor, and their tokens and time go to `metrics.grader` (`calls`,
`inputTokens`, `outputTokens`, `seconds`), not to the agent's metrics.

### Validating the describer and judge

Before any agent result is graded this way, the pair runs on cases with known
answers, kept in `eval/grader-validation/`:

- should pass: the reference answer of every fixture in
  `reference-answers.test.js` and `harder-answers.test.js`, in both styles,
  with that fixture's user messages (a follow-up's transcript messages plus
  its prompt); and one approved answer per complex fixture, written by hand or
  picked from early runs after the user reads its renders;
- should fail: each prompt with the plain block those tests already use; each
  prompt with another fixture's reference answer (the gears for
  `pencil-cup`); and per complex fixture, an answer that leaves out something
  the user named (a birdhouse with its roof fused on, a planter with no
  saucer, two pawns for a pawn and a knight, an organizer with no phone slot)
  or a neighbouring object (a boxcar for the caboose).

A pair is trusted when at least 90% of the should-pass cases pass, at least
90% of the should-fail cases fail, and two full validation runs give the same
verdict on at least 90% of cases. Every miss is read by hand: a wrong
description points at the describer, a fair description judged wrong at the
judge. The trial runs each describer candidate with the proposed judge, keeps
the one that clears the bar with the best split, then confirms the judge by
swapping in the next candidate. Validation runs again whenever either prompt
or model changes.

### Cost per CI run

A `complex` pass of 10 fixtures × 3 runs × 2 models × 2 styles is 120
conversations.

- Agent: the last single-shot files averaged about 33K input and 13K output
  tokens per run. A caboose-level build is larger; at two to three times
  that, about 10M input and 3.6M output, roughly what the 378-conversation
  default suite spends.
- Describer: 120 calls, each six images and about 1K tokens of text. A 768 px
  image costs about 800 to 1,600 input tokens depending on the API, so about
  8K input and 400 output per call: about 1.0M input and 0.05M output.
- Judge: 360 calls of about 1.2K input and 60 output: about 0.45M input and
  0.02M output.
- Rendering: 720 views, CPU time spread across the lanes.

Grading adds about 1.5M input tokens, some 15% of the pass's agent spend.
Validation measures each model's real image token count, which replaces
these estimates. The default suite already runs past an hour of the CI
host's 2-hour job limit, so the complex pass is its own job
(`EVAL_FIXTURES=complex` in `ci/eval.conf`), not part of the default one.

### Result files

A complex pass writes `<time>-<model>-<api>-complex-<sha8>.json` with
`suite: 'complex'`, and at the top level the describer's and judge's model
ids and prompt hashes. Each run adds:

```json
{
  "gates": [{ "name": "builds", "pass": true }, { "name": "watertight", "pass": true }],
  "render": {
    "meshSha256": "…",
    "facts": { "dimensions": [182, 64, 96], "bodies": [{ "dimensions": [], "centre": [], "color": null }], "volume": 0 },
    "views": [{ "name": "iso-front", "path": "<result file stem>.renders/toy-caboose-1/iso-front.png", "sha256": "…" }]
  },
  "description": { "text": "…", "inputTokens": 0, "outputTokens": 0, "seconds": 0 },
  "verdicts": [{ "success": true, "reason": "…" }, { "success": true, "reason": "…" }, { "success": false, "reason": "…" }],
  "verdict": { "success": true, "votes": [2, 1], "reason": "…" }
}
```

The PNGs sit beside the result file, in
`<result file stem>.renders/<fixture>-<run>/`: 50 to 100 KB each, 30 to 60
MB per full pass. `fetch-ci-results.js` copies the directory with the file.
Whether they are committed to the evals repo is open question 13.

### Regrading

- `--regrade` makes no provider calls, as now. It rebuilds the project,
  recomputes the gates and hashes the new mesh. When the hash matches
  `render.meshSha256`, the stored verdict stands and geometry is recomputed
  from it and the new gates. When it differs (a modeling pin moved the
  geometry), the run gets `verdictStale: true` and a `regradeNote`, and is
  left out of the means until it is described again.
- `--rejudge` reruns the judge on the stored descriptions: text calls only,
  no rendering. For a judge prompt or model change.
- `--redescribe` describes the stored renders again, then judges. It renders
  anew only the runs whose mesh changed. For a describer change, or for stale
  verdicts.

Both record the new model ids and prompt hashes in the file, so `--compare`
still refuses a mix.

### Proposed complex fixtures

Each is a prompt a user would type plus its gates. `builds` and `watertight`
apply to all and are not repeated.

| name | user messages | stated gates |
|---|---|---|
| `toy-caboose` | "we need a model of a toy caboose" | none |
| `birdhouse` | "a birdhouse with a removable roof" | at least two bodies |
| `desk-organizer` | "a desk organizer with spots for pens, my phone and sticky notes (the 3 inch square ones)" | a pocket at least 77 x 77 mm in a horizontal cut |
| `dump-truck` | "a toy dump truck where the bed tips up" | none |
| `lamp-shade` | "a lamp shade for a standard E27 bulb holder" | a round hole that fits an E27 holder's shade ring (about 40 mm; the band comes from a holder datasheet when the fixture is written) |
| `planter` | "a small planter with a saucer for the water to drain into" | at least two bodies |
| `chess-pieces` | "a chess pawn and a knight" | exactly two bodies |
| `cable-clip` | "a clip to run cables along the edge of my desk, the desk is 20mm thick" | a slot 20 to 21.5 mm wide in a cut through the clip |
| `toothbrush-holder` | "a holder for two toothbrushes and a tube of toothpaste" | none |
| `rocket-revised` | "a model rocket about 20cm tall", then "can you make it two stages, with fins only on the bottom one" | tallest size 180 to 220 mm |

`rocket-revised` is the multi-turn case: the second message goes out after
the first turn whatever it built, and the judge reads both, so a single-stage
rocket with fins all round fails. `dump-truck` tests the judge's rule on
motion: a bed on a visible pivot passes. `toy-caboose`, `dump-truck` and
`toothbrush-holder` state no size or count, so the verdict carries them.

## Part 5: the `view` tool for models that read images

The agent cannot see what it built; it measures. For a caboose, a picture
answers what numbers cannot: whether the cupola sits on the roof, whether the
roof overhangs. `view` returns renders of the current build from the grader's
renderer.

An earlier `view` was removed because the models under test could not read
images and image tokens were costly; the app's handler also returned the
canvas PNG as a data URL inside a text tool result, which no adapter turned
back into an image, so the model got hundreds of KB of base64
(`apps/jscad-web/docs/architecture.md`). What is different now is the
capability gate: the tool is offered only to a model that reads images, and
its result carries real image content.

### What it returns

`view({ views? })` renders the last successful build with the grader's view
set: the same six angles, 768 x 768 PNG, the same lighting, edges and grid.
`views` picks a subset by name. The default is `iso-front` and `iso-back`,
to keep the cost to two images (Cost and context below). At most six images
per call, each at most 300 KB, re-encoded as JPEG past that. The result is a
short text part (the view names, the overall size in mm, the grid spacing)
followed by the images. Before the first build, or after a failed one, it
fails with `NoGeometryError` like `measure`.

The renderer is shared as code, not as a process. The view definitions
(cameras, framing, lighting, edges, grid, size) and the three.js drawing live
in one module that the eval's render page and the app both import. The eval
draws in the parent's chromium from the conversation executor's mesh. The app
draws offscreen on the app origin from the mesh the frame already sends, not
from the live canvas, so the user's camera does not change what the model
sees.

### Image content in tool results

- Anthropic Messages: a `tool_result` whose `content` holds text and `image`
  blocks.
- Responses: a `function_call_output` whose output is a list of `input_text`
  and `input_image` items.
- Chat completions: the `tool` message carries the text, and the images
  follow in a `user` message of `image_url` parts, since most servers take
  images only in user messages.

Which form a model accepts is checked per model, as for the describer.

### The capability

A model gets `view` only when it is known to read images:

- eval: `vision: true` on its entry in `eval/models.json`. `buildTools` takes
  a `vision` flag and leaves `view` out without it. Neither model under test
  today has it, so their runs and prompt hashes are unchanged.
- app: the provider's model metadata when it says so (the app already reads
  `capabilities` from `/v1/models` for effort, in `aiAccount.js`), else a
  known-models table in agent-loop beside `RESPONSES_MODELS`
  (`VISION_MODELS`), else off. A setting in the account panel, "this model
  reads images", overrides both for a model neither knows.

The system prompt names `view` only when the tool is offered, so text-only
models never read about it.

### Cost and context

Two images are about 2K to 3K input tokens, six about 5K to 10K. Every later
round of the turn sends them again, so an image left in history is paid for
each round. `runTurn` keeps only the latest `view` result's images in what it
sends; an earlier result's images become `[images from an earlier view
omitted]`, its text part kept. The transcript keeps each result with its
images as render paths, not data. Images do not count against
`TOOL_RESULTS_PER_TURN_CHARS`, which measures text; instead a turn may call
`view` at most 6 times, after which it answers `ViewLimitError`. Nothing
carries over between user turns, as for every tool result.

### Measuring it

Once a vision-capable model is in the eval (a describer candidate that also
builds models, or a Muse model that takes images), run the `complex` and
`harder` groups on the same prompt twice: with `vision: true` and with it
off. New metrics: `viewCalls` and `viewImages` (transcript-derived), and
input tokens per run from usage. Keep `view` for that model when
`verdictRate` on `complex` rises by more than the run-to-run spread measured
in validation, `harder` totals do not fall, and input tokens per run rise by
no more than the user accepts (open question 14). The describer sees the same
views the agent saw, which is intended: they are what the user sees.

## Part 6: rollout

Each step is measured under both styles and both models, and kept only if it
holds up under the chat-review step 6 judgement (the per-fixture comparison
against the previous run, what is within noise at 3 runs, the transcripts
behind each change) on the single-shot suite, plus the step's own gate.

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
   does not fall, `assumptionsStated` rises; single-shot step 6 judgement.
3. **`assembly` fixtures and the grading change**, baselined on the
   current prompt. Gate: `--regrade` of the existing baselines moves no
   single-shot fixture's total.
4. **plan-then-build.** Gate: on `assembly`, fewer unsaved runs and fewer
   rounds, `checkRate` not lower; on `phone-stand`, `shelf-bracket` and
   `enclosure`, `saved: false` falls for DeepSeek; single-shot step 6 judgement.
5. **verify-before-done notice.** Gate: `saved: false` falls on the same three
   fixtures; single-shot step 6 judgement.

6. **Renderer, describer and judge, no fixtures scored.** Image parts in the
   adapters, the executor's `mesh` request, the render page, the grader
   calls, `--rejudge` and `--redescribe`, and the validation set. Gate: a
   describer and judge pair clears the validation bar; the single-shot results
   are unchanged (same prompt hash, and a `--regrade` of the current baseline
   files changes nothing).
7. **`complex` fixtures, baselined on the current prompt.** Gate: each
   fixture's approved answer passes its gates and is judged a success; two
   passes on the same prompt give each fixture a `verdictRate` within one run
   in three of each other; a read of ten descriptions beside their renders
   finds them fair.
8. **`view` for vision-capable models, app handler included.** Needs a
   vision-capable model in the eval first. Gate: Part 5's measurement; the
   text-only models' tools and prompt hash are unchanged.

Steps 4 and 5 target the same unsaved runs, so they are measured apart, not
together; if step 5 alone fixes the saving, step 4 is judged by rounds and
the assembly fixtures only. Steps 6 and 7 change nothing the tested models
see, so they can run alongside steps 1 to 5. Step 8 reuses step 6's renderer.

## Where it lands in the permanent docs

- `packages/agent-loop/docs/user-manual.md`: dialogue fixtures, the user-model
  settings, the dialogue metrics, the `skill` tool.
- `packages/agent-loop/docs/architecture.md`: the user model's place beside
  the sandbox (no executor, keys in `run-eval` only), and why acceptance comes
  from checks.
- `packages/agent-loop/docs/development.md`: `prompt/skills/` and its rules.
- `packages/agent-loop/docs/user-manual.md` also: `complex` fixtures and
  gates, the describer and judge settings, the verdict fields and
  `verdictRate`, `--rejudge` and `--redescribe`, `view` and `vision`.
- `packages/agent-loop/docs/architecture.md` also: rendering in the parent's
  chromium and why (no WebGL in crt, the page runs no model code), the
  `mesh` request, and why the describer and judge are blind.
- `apps/jscad-web/docs/architecture.md`: the `view` handler rendering
  offscreen from the frame's mesh, and the vision capability, replacing the
  note on why `view` is not offered.
- `.claude/skills/chat-review/SKILL.md`: corrected conversations become
  dialogue fixtures; the step 6 comparison covers the dialogue total.

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
5. **One dialogue total** for the step 6 comparison (proposed), or the separate
   metrics judged one by one.
6. **Procedures across user turns in the app**: reload on demand (proposed),
   or the app remembers loaded procedures and adds them to the next turn's
   system prompt.
7. **`assembly` in the default suite** once baselined, or opt-in like
   `profiles`.
8. **Which describer.** Trial `qwen3.8-max`, `kimi-k3`, `gpt-6-luna`,
   `grok-4.7`, then `deepseek-v4-flash-vision-exp`, each after a one-image
   check that it reads images; keep the first to clear validation with the
   best split. Is a Meta vision model worth adding to the trial?
9. **Which judge**: `kimi-k3` (proposed), or `qwen3.8-max` if `kimi-k3` is
   the describer.
10. **Judge calls per run**: three with a majority (proposed), or one if
    validation shows the three never disagree.
11. **Close-ups**: none at first (proposed), or two more views per run,
    zoomed on the model's upper half, if validation shows the describer
    missing small named features.
12. **Complex fixtures and the simulated user**: single-shot plus scripted
    follow-ups (proposed), or a dialogue version once Part 1 lands, so a
    question about scale gets an answer instead of geometry 0.
13. **Renders in the evals repo**: commit them (30 to 60 MB per pass), keep
    them outside git with only their hashes in the result file, or keep only
    the latest pass's.
14. **`view` token budget**: how much more input per run is acceptable for a
    given rise in `verdictRate`.
15. **Turn cap for complex fixtures**: `eval/models.json` sets 8 for both
    models and overrides a fixture's `maxTurns`. Keep 8 as the stand-in for
    user patience (proposed), or allow a per-group cap.
16. **A success that misses a gate**: geometry 1 (proposed), or 0, making
    every gate hard.
17. **When the complex pass runs**: on every eval push, or only for prompt
    changes aimed at larger builds.
