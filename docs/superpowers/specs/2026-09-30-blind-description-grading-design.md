# Grading complex requests by blind description

Status: approved design, working document on `grading-spec`. Fold into the
permanent docs and delete before merge. Replaces Part 4 of
`2026-09-29-conversational-eval-and-skills-design.md`.

## Goal

Real sessions ask for whole objects: "we need a model of a toy caboose". No
set of section and size checks tells a caboose from a boxcar, and checks
written for one caboose grade one shape. A new `complex` fixture group is
graded by deterministic gates for what can be measured, plus one overall
verdict: a vision model describes renders of the result without seeing the
request, and a text model judges that description against the user's
messages. The judge decides overall success, not details.

## Evidence from the trials (2026-09-30)

Subjects: the chat-built toy caboose (chat 554c84a4, 111 x 41 x 67 mm, 62
parts), a delivery truck as control, and three near misses: the red body on
wheels only (`plain-box`), the caboose with its roof removed (`no-roof`), and
the caboose with roof, cupola, chimney and wheels moved 15 to 30 mm apart
(`exploded`). Renders at 768 px, three views.

| describer on the CI host's RTX 4070 | per model (3 views) | names caboose | control | near-miss defects named |
|---|---|---|---|---|
| moondream2 (Ollama) | ~10 s | once in many runs | "truck", "urn" | – |
| qwen3.5:9b (Ollama) | ~60 s | yes, with cupola and couplers | delivery truck | – |
| Moondream 3.1 (Photon) | 1.4 to 3.4 s | yes | delivery truck | box: yes; roof, exploded: no |

- Moondream 3.1 is deterministic at temperature 0 (38 of 38 repeat pairs
  identical) and needs the whole 12 GB card (peak 11.7 GB).
- Asking Moondream about missing or floating parts made it state that broken
  models were intact. The describer cannot see those defects, so floating
  parts become a measured gate, and an open top stays a known blind spot.
- Judges, 3 runs each: DeepSeek v4.1 flash and qwen3.5:9b both passed the
  control 0 times in 70. With the first judge prompt DeepSeek passed
  `plain-box`; with the strict prompt below neither judge did, and the real
  caboose still passed on Moondream's per-view `long` descriptions (6 of 6).
- DeepSeek failed the real caboose on Moondream `caption` output ("views
  inconsistent"), so the describer uses the per-view `long` prompt.

Trial scripts and results: the session scratchpad's `describer-trial/` and
`moondream3-trial/` (not in the repo).

## Pipeline

A `complex` run is graded in three stages. Stage A runs in each eval lane;
stages B and C run once over the finished result files.

**A. Conversation, gates and renders** (`run-eval`, per run):

1. The conversation runs as today. The fixture's `followUps` are sent in
   order after each turn ends, whatever the turn built, each through
   `buildMessages` with the prior turns as text, as the app builds them.
2. The final project is graded in a fresh executor (`gradeProject`) with the
   `bodies` probe. The same executor then answers a `mesh` request.
3. The gates run (Gates below).
4. When the project builds, the parent renders three views of the mesh.
5. The run is stored with `description: null` and `verdict: null`, and its
   geometry is provisional (Scoring).

**B. Describe** (`npm run describe -w @jscadui/agent-loop -- <result files>`):
one Python process loads Moondream 3.1 once, describes every run with renders
and no description, and writes the descriptions back into the files.

**C. Judge** (`npm run judge -w @jscadui/agent-loop -- <result files>`):
for every run with a description and no verdict, three judge calls, the
majority verdict, then geometry and the summary are recomputed.

A project that does not build skips B and C and scores geometry 0.

The describer never sees the prompt, transcript, source, file names or
parameter names, since any of them can name the object (`cupolaHeight`). The
judge never sees the assistant's text, tool calls, source or renders. An
agent that writes "here is your caboose" over a box gains nothing.

Splitting B from A keeps the GPU out of the lanes: the model loads once per
pass, and a lane never waits on it. It also makes redescribing and rejudging
the same commands run on older files.

## Fixture shape

```js
export const fixture = {
  name: 'toy-caboose',
  group: 'complex',
  prompt: 'we need a model of a toy caboose',
  requires: ['write'],
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m, { solid, probe }) => [],
}
```

- `gates` in place of `checks` marks a fixture for grading by description.
- `gates` lists only what the user's messages state: a size ("my desk is
  20mm thick") or a count of separate parts. A gate tests the stated value
  with a tolerance, using the existing probes, and never something the user
  left open.
- `pieces` (default 1) is how many separate pieces the request calls for.
- `followUps: [{ message }]` holds later user messages. They have no checks of
  their own; the judge reads them all.

## Gates

Every `complex` fixture gets three harness gates, then its own:

- `builds`: the project builds to geometry.
- `watertight`: from the grade's `solid`.
- `connected`: the bodies from the `bodies` probe, grouped so two bodies
  share a group when their bounding boxes, each grown by 0.5 mm on every
  side, overlap. The gate passes when there are at most `pieces` groups.
  A roof lifted 15 mm off its walls, or wheels hanging below the axles, makes
  a second group. The test is by bounding box, so it can pass a part that
  sits inside another's box without touching it; it is a gate for parts that
  float clear, not a contact check.

## Rendering

Rendering needs WebGL, which the crt sandbox does not have and should not
get. It runs in the `run-eval` parent, in Playwright's bundled chromium
(`--use-gl=angle --ignore-gpu-blocklist`, launched as
`apps/jscad-web/e2e/render-all.mjs` does). The page is a local file,
`eval/render/page.html`, drawing with the workspace's three.js. It gets
triangle arrays and colors, loads no model code, and every network request it
makes is refused. Model code still runs only in the executor.

### The mesh request

A grade reply is capped at 1 MB, too small for a detailed mesh. After the
grade, the grade executor answers a `mesh` request with each body's color
(`[r, g, b]` in 0 to 1, or null) and its triangles as base64 Float32
positions, split across frames under the 1 MB cap, up to 24 MB in all (about
700,000 triangles). The parent checks the shape (finite numbers, a multiple
of 9 per body) before drawing. Model code shares that executor and can lie
about the mesh as it can about the grade, which only changes how its own
model looks. A mesh over the cap or of the wrong shape records `renderError`
and the run is left out of the verdict means, like an `infraError`.

### Views

Three orthographic views, 768 x 768 PNG, framed to the model's bounding box
with a 6% margin:

| view | camera direction (toward the model's centre from) | up |
|---|---|---|
| `iso-front` | (1, -1, 0.7) | +Z |
| `iso-back` | (-1, 1, 0.7) | +Z |
| `side` | (0, -1, 0.05) | +Z |

The top view is left out: in the trial Moondream read the caboose's top view
as "an electronic module" and it flipped the judge. Background `#ececec`,
hemisphere light plus a key light above-left of the camera, each body in its
own color (unset: neutral grey `#b0b0b0`), flat shading, dark lines at 35%
opacity on edges where faces meet at more than 30°. Each `run-eval` process
starts one chromium and reuses one page.

## The describer

Moondream 3.1 9B A2B (`moondream/moondream3.1-9B-A2B`, the 10.5 GB fp8 build)
through Photon: `moondream==2.6.1` and `kestrel==0.9.1`, pinned, in a venv on
the CI host.

### Install

`scripts/describer-setup.sh` installs the venv and the weights under
`DESCRIBER_HOME` (default `/data/moondream3`: `venv/`, `hf/`), fetching the
model and its tokenizer (`moondream/starmie-v1`) once. `--check` verifies the
install without changing anything, like `scripts/eval-sandbox-setup.sh
--check`. The CI job user must be able to read `DESCRIBER_HOME`.

### The process

`packages/agent-loop/eval/describer/describe.py` runs in the venv, loads the
model once, then reads one JSON request per line on stdin and writes one JSON
reply per line on stdout:

```json
{ "id": "toy-caboose-1/iso-front", "image": "/abs/path/iso-front.png", "prompt": "..." }
{ "id": "toy-caboose-1/iso-front", "text": "...", "ms": 480, "inputTokens": 791, "outputTokens": 47 }
```

or `{ "id": ..., "error": "..." }` for one image that failed. The Node side
(`eval/describe.js`) starts it, sends every pending view, and writes the
results into the files.

Kestrel 0.9.1 does not fit the 12 GB card as shipped. `describe.py` applies
the trial's runtime patches (from `run_md31.py`): no bf16 placeholders for
the MoE experts before the fp8 weights load, per-layer up-projection weights
instead of the padded slab, `decode_path="native"`, `kv_cache_pages=4096`,
`max_batch_size=1`, prefix cache off. It refuses to start on any other
kestrel version, naming the pin, since the patches reach into its internals.

### No outside connections

Kestrel posts telemetry (instance id, model, hostname, token counts, GPU) to
`api.moondream.ai` at start, every 60 s and at shutdown, with no setting to
turn it off. `describe.py` replaces the reporter's start and flush with
no-ops, skips the Hugging Face config probe, runs with `HF_HUB_OFFLINE=1`,
and refuses any socket connection to an address other than loopback. It
reports the number of refused connections on exit; the Node side records it
as `describer.blockedConnections` and fails the stage when it is not 0.

### GPU

Moondream needs about 11.8 GB of the 12 GB card. Before loading, `describe.js`
asks Ollama on `127.0.0.1:11434` to unload any loaded model (`keep_alive: 0`),
then reads free memory from `nvidia-smi`. Below 11,800 MiB free it stops
with the free amount and the processes holding the card, and leaves the runs
undescribed; `npm run describe` on the same files finishes them later.
Freeing the card from other services (chatterbox-tts today) is outside this
work: see the backlog's GPU item.

### The prompt

Per view, reasoning off, temperature 0, at most 300 output tokens:

> This is the {front three-quarter view | back three-quarter view | side
> view}. Overall size {W}×{D}×{H} mm, {N} parts.
>
> Describe the object in these renders: what it most likely is, its main
> parts and how they're arranged, colours, and anything that looks broken or
> odd. Plain text, under 150 words. Do not guess a purpose you can't see.

`N` is the body count from the `bodies` probe. The description is the three
replies joined, one line each, `{view name}: {text}`.

## The judge

DeepSeek v4.1 flash through opencode-go, the path `openaiProvider` in
`src/providers.js` already takes for it, with `reasoning_effort: "none"`,
`temperature: 0` and at most 150 output tokens. It runs in the Node process,
with the key from the same `keys.json` lookup as the eval's providers, never
in an executor.

DeepSeek is also a model under test. It judges only the user's messages and a
blind description of the result, never the other model's text or code, so it
cannot favour its own habits beyond its idea of the object, and the trial
showed that idea agrees with qwen3.5:9b's on every case with a clear answer.

Its message:

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

The user's messages are the fixture's prompt and each follow-up's message.
The vote is the first of `SUCCESS` or `FAILURE` in the reply; the rest,
trimmed to 200 characters, is its reason. A reply with neither word is
retried up to twice; after that the vote is null. The verdict is the
majority of three non-null votes; with fewer than two agreeing votes the run
gets `graderError: true` and is left out of the verdict means.

## Scoring

The four 0 to 2 grades stay. Geometry for a `complex` fixture:

- 2: the verdict is success and every gate passes;
- 1: the verdict is success and a gate fails;
- 0: the verdict is failure, or the project does not build.

Until stage C runs, geometry is 0 and the run carries `verdictPending: true`;
`summarize` leaves pending runs out of the geometry and total means and
reports how many are pending. `checkRate` counts the gates plus the verdict
as one entry. The summary adds `verdictRate` per fixture, the fraction of
judged runs that succeeded.

## Result files

A complex pass writes `<time>-<model>-<api>-complex-<sha8>.json` with
`suite: 'complex'`. Stages B and C add at the top level:

```json
{
  "describer": { "model": "moondream3.1-9B-A2B", "kestrel": "0.9.1", "promptSha256": "…", "blockedConnections": 0 },
  "judge": { "provider": "opencode-go", "model": "deepseek-v4.1-flash", "promptSha256": "…" }
}
```

Each run adds:

```json
{
  "gates": [{ "name": "builds", "pass": true }, { "name": "watertight", "pass": true }, { "name": "connected", "pass": true, "groups": 1 }],
  "render": {
    "meshSha256": "…",
    "facts": { "dimensions": [111, 41, 67], "bodies": 62 },
    "views": [{ "name": "iso-front", "path": "<file stem>.renders/toy-caboose-1/iso-front.png", "sha256": "…" }]
  },
  "description": { "text": "…", "views": [{ "name": "iso-front", "text": "…", "ms": 480, "inputTokens": 791, "outputTokens": 47 }] },
  "votes": [{ "success": true, "reason": "…", "ms": 1800 }],
  "verdict": { "success": true, "votes": [3, 0] }
}
```

The PNGs sit beside the result file in `<file stem>.renders/<fixture>-<run>/`.
`fetch-ci-results.js` copies the directory with the file. The evals repo
keeps only the newest complex pass's render directories: committing a new
pass removes the older ones in the same commit (history keeps them).
`--compare` refuses two complex files whose describer or judge model or
prompt hash differ, and a complex file against a single-shot one.

## Regrading

- `--regrade` makes no provider calls and starts no describer, as now. It
  rebuilds the project, recomputes the gates and hashes the new mesh. When
  the hash matches `render.meshSha256`, the stored verdict stands and geometry
  is recomputed from it and the new gates. When it differs, the run's
  description and verdict are cleared, it is marked `verdictPending`, and a
  `regradeNote` says why; rendering again happens with `--redescribe`.
- `npm run judge -- --all <files>` rejudges every described run (a judge
  prompt or model change).
- `npm run describe -- --all <files>` redescribes every rendered run, then the
  judge stage is run on the same files. `--rerender` renders runs whose mesh
  changed first.

Each records the new model ids and prompt hashes in the file.

## Validating the describer and judge

`eval/grader-validation/` holds known cases as model source plus user
messages plus the expected verdict:

- pass: the chat-built caboose;
- fail: the delivery truck, `plain-box`;
- gate: `exploded` (fails `connected`, whatever the verdict);
- known miss: `no-roof`, recorded, not scored;
- per complex fixture, one approved answer once the first runs exist, picked
  after the user reads its renders.

`npm run grader-validate -w @jscadui/agent-loop` builds, renders, describes
and judges each case (three judge calls) and prints the expected against the
actual. It must match on every scored case before a change to either prompt,
either model or the renderer is kept. It needs the GPU, so it runs on the CI
host.

## CI

`ci/eval-complex` runs the eval lanes as `ci/eval` does with
`EVAL_FIXTURES=complex`, then stage B once over all the pass's result files,
then stage C. It is its own job, pushed on demand (`sci push
jscadui/eval-complex`), and does not run with `ci/eval`. It runs
`scripts/describer-setup.sh --check` before any provider call and installs
Playwright's chromium (`npx playwright install chromium`) as `ci/render`
does. Settings come from `ci/eval-complex.conf` in the shape of
`ci/eval.conf`.

## Complex fixtures

`builds`, `watertight` and `connected` apply to all and are not repeated.

| name | user messages | pieces | stated gates |
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
`dump-truck` has no gate for motion; the judge's rule is overall success.

## Cost per complex pass

10 fixtures x 3 runs x 2 models x 2 styles is 120 conversations.

- Agent: at two to three times the single-shot spend per run, about 10M input
  and 3.6M output tokens, roughly what the 378-conversation default suite
  spends.
- Describer: local, 360 views at about 0.5 s each plus a 5 s load.
- Judge: 360 calls of about 600 input and 40 output tokens.
- Rendering: 360 views of CPU time in the lanes.

## Rollout

Each step lands with its tests and docs. None changes what the tested models
see, so the single-shot results and prompt hashes stay the same; each step's
gate includes a `--regrade` of the current baseline files changing nothing.

1. **Mesh request, gates and renderer.** The executor's `mesh` request, the
   `connected` gate, the render page and the render step in `run-eval` for
   `complex` fixtures. Gate: the five validation models render as in the
   trial, read by eye.
2. **Describer.** `describer-setup.sh`, `describe.py`, `describe.js`, the GPU
   check. Gate: the validation models' descriptions on the CI host match the
   trial's texts.
3. **Judge, scoring, regrading.** Judge calls, verdicts, provisional
   geometry, `verdictRate`, `--compare` refusals, `--all`, `--rerender`.
   Gate: `grader-validate` matches every scored case.
4. **Complex fixtures and `ci/eval-complex`.** Gate: one pass on the current
   prompt; a read of ten descriptions beside their renders finds them fair;
   the approved answers join the validation set.

## Where it lands in the permanent docs

- `packages/agent-loop/docs/user-manual.md`: `complex` fixtures, `gates` and
  `pieces`, the describe and judge commands, verdict fields, `verdictRate`,
  `grader-validate`.
- `packages/agent-loop/docs/architecture.md`: the three stages and why they
  are split, rendering in the parent's chromium, the `mesh` request, why the
  describer and judge are blind, the describer's patches and connection
  block.
- `docs/install.md` or `ci/README.md`: the describer install on the CI host.
- `docs/backlog.md`: GPU sharing on the CI host (a lease so the describer,
  Ollama, chatterbox-tts and CI jobs take turns), and the describer's blind
  spot for open or missing tops.
