# @jscadui/agent-loop user manual

## API style

The chat teaches exactly one modeling API, set by `api`: `'fluent'`
(`@jbroll/jscad-fluent`, the default, `DEFAULT_API`) or `'modeling'`
(`@jscad/modeling`). `@jscadui/jscad-text` is part of both. The setting picks
the system prompt (`buildSystemPrompt(api)`), the tool list
(`buildTools(api)`, via `runTurn({ api })`; only the `docs` description
differs) and the entries `docs` answers from (`docsTool(index, query, { api })`).
It does not change the runtime: model code may still require either package.
Each style's prompt carries an `## API reference` sheet of that style's
common calls with their option defaults
([development.md](development.md#system-prompt)).
Every function takes `api` as an option and defaults to `'fluent'`; an unknown
value throws. `APIS` lists both.

The fluent prompt names `@jscad/modeling` only to rule it out, with one
exception: jscad-text needs `jscadText.init(require('@jscad/modeling'))`, and
its outline becomes chainable as `new jf.FluentGeom2(outline)`. The modeling
prompt never mentions jscad-fluent.

## Conversation context

```js
buildMessages({ systemPrompt, transcript, files, message, budget = CONTEXT_BUDGET })
```

Returns the system prompt, the newest whole prior turns that fit in `budget`
characters (24,000 by default), a user message with every text file in
`files` under `### <path>` (outside the budget, omitted when empty), and the
new message. The app and the eval both use it.

`runTurn` caps each tool result it hands the provider at `TOOL_RESULT_CHARS`
(the same 24,000 characters) and ends a longer one with `… [tool result
truncated: N of M characters shown]`, in the app and the eval alike, so a few
oversized results (model code answering its own calls) cannot
overflow the provider's context. Past `TOOL_RESULTS_PER_TURN_CHARS` (120,000
characters) of results in one turn (an eval run is one turn), each further
result is replaced by `[tool result omitted: this turn's tool results passed
120000 characters]` and the turn goes on. A turn that rejects carries the
messages so far as `error.messages`. A provider round with neither text nor a
tool call (only reasoning, or a stop at the length limit) rejects the turn
with `EmptyReplyError`, whose `stopReason` is the provider's and whose message
is `the model stopped without answering (stop reason: length)`; the app shows
it in the chat as an error.

## docs tool

`docs({ query })` answers from the API index (`api/index.json`, see
[architecture.md](architecture.md#api-index)) with
`docsTool(index, query, { api })` (`src/docs.js`), the same pure function in
the page and in the eval. It searches only the chosen API's entries plus
`@jscadui/jscad-text`'s. A query is a qualified name
(`primitives.roundedCuboid`, `jf.polygon`, `FluentGeom2.extrudeLinear`), a
bare name (`roundedCuboid`) or a namespace or class (`primitives`,
`FluentGeom2`), or several of these separated by commas or plus signs (at
most 8, answered in order in up to 9,000 characters, a miss among them
answered by its closest names). A function answers with its signature,
description, positional parameters with their JSDoc text, options with type
and default, and example; a fluent entry whose options are a modeling
function's lists them without naming that function. Any function whose first
parameter is an angle (`rotate*`) adds that angles are radians and which way
a positive angle turns (right-hand rule: `rotateX(Math.PI / 2)` turns +Y into
+Z). `cylinder`, `cylinderElliptic` and `jf.cylinder` add a line on tapers and
which end is the start (-Z); `jf.polygon`, `primitives.polygon` and
`geometries.geom2.fromPoints` add that the points go counter-clockwise, since
clockwise points extrude inside out; and `cone`, `taper` or `frustum` (bare or
qualified) answers with the taper form, `jf.cylinder` under fluent and
`primitives.cylinderElliptic` under modeling. A namespace or class answers
with one line per member, `cylinder({ center = [0,0,0], height = 2, radius =
1, segments = 32 })`, a method's own call part, or a value's name, followed
by its one-line summary; when that passes the cap it drops the summaries,
then the positional parameters' types, then the option defaults, then the
call forms. `jf` answers a first model's lookups in one call: each shape
factory (a member returning one `FluentGeom3`, `FluentGeom2` or `FluentPath2`)
with its option defaults and untyped positional parameters, the other members
by name on an `Also:` line, the method names `FluentGeom3` and `FluentGeom2`
share and then each one's own, and a line saying to query `jf.<name>` or
`FluentGeom3.<method>` for descriptions, option types and examples. A class method missing from an
array class is looked up on the class it extends. A bare name
with several hits answers the preferred one with the others on an `Also:`
line (under fluent, the `jf.*` factory, then the `FluentGeom3`, `FluentGeom2`
and `FluentPath2` method, then the array classes and nested `jf.maths`-style
helpers; under modeling, the `namespace.function` operation before a `maths`
or `geometries` helper), or lists the candidates. A package name resolves to
that package's top entry, or, for `@jscad/modeling`, a listing of its
namespaces (`primitives`, `booleans`, `transforms`, …) with one-line
descriptions. Under fluent, each function of a namespace `jf.maths` points at
answers under its fluent name (`maths.vec3.add` answers as
`jf.maths.vec3.add`). A query of several words looks up its first.

Under fluent, `jf.rotateX` answers "jf.rotateX is a method, not a jf
function: call shape.rotateX(...)." with the `FluentGeom3.rotateX` entry, and
a method queried on a class that lacks it (`FluentGeom3.extrudeLinear`) names
the classes that have it. A query that is the start of names one segment
longer (`FluentGeom`) lists them.

A query only the other API answers never shows that API's entry. When the
chosen API has an equivalent (a `sameAs` link, the same function name, a
`geometries.<type>` function and the same-named method of that type's class,
or `EQUIVALENT` in `src/docs.js` for namespaces and renamed functions, such as
`geometries.geom2.reverse` and `FluentGeom2.invert`), the answer is `<name>
is not part of the <api> API; the <api> form is <entry>.` followed by that
entry; otherwise it is `<name> is not available in the <api> API.`, with the
reason for a name in `MISSING` (`maths.vec1`: modeling has no vec1
functions). Under fluent, what is left out is compact binary, `poly2` and
`poly3`, a few `geometries` accessors, and the internal `utils` helpers. A
miss in both is a failed result,
`{ ok: false, error: { name: 'NotFoundError', message: 'no entry <query>; closest: a, b, c' } }`,
with the three nearest names in the chosen API by edit distance. Answers are
cut at 3,000 characters.

## Option warnings and error hints

The checks (`src/optionChecks.js`) report facts; the run's warning collector
turns each into the warning the model sees, worded for the chat's API style
(`setApi`), by `explainWarning` in `src/hints.js`:

| fact | warning |
|---|---|
| unknown option | `{ fn, option, suggestions }`, plus `hint` when a sibling function takes it |
| number option given an array, or the reverse | `{ fn, option, hint }` naming the sibling that takes that type (`cube` size array → `cuboid`) |
| rotate angle with magnitude over 2π | `{ fn, option: 'angle', hint }`: "90 looks like degrees; angles are radians, so use 90 * Math.PI / 180" |
| clockwise points (negative signed area) to `jf.polygon`, `primitives.polygon` (after its `orientation`; not with `paths`) or `geometries.geom2.fromPoints` | `{ fn, option: 'points', hint }`: "points run clockwise (area -50), so an extrusion of this outline comes out inside out: list them counter-clockwise, e.g. jf.polygon([...points].reverse())" |
| a `subtract` or `intersect` (modeling `booleans`, `jf`, or a `FluentGeom3`/`FluentGeom2` method) that returns an empty shape from a non-empty first shape | `{ fn, hint }`: what emptied it, and the bounding-box measure to compare the shapes with |
| `{ points, faces }` data (what `jf.hullPoints3` returns) given to a boolean | `{ fn, hint }`: make it a shape with `jf.polyhedron(...)` or `primitives.polyhedron({ points, faces })` |

A hint names only the chosen API's forms, even when the model code called the
other package: `primitives.cube({ size: [x, y, z] })` under fluent reads
"jf.cube takes size as a number; for an array size use jf.cuboid". The `fn`
field still names what was called.

An unknown key's `suggestions` are known options within edit distance 3, plus
either name containing the other (`radius` → `roundRadius`, 5 edits apart,
matches by containment instead). A sibling is a function of the chosen API
whose name contains the other's or shares the first three letters of its last
word (`cube`, `cuboid`, `roundedCuboid`); it matches when it takes the option,
or the same words in another order (`radiusStart`, `startRadius`), which
clears the suggestions. A taper option on `cylinder` (`radiusStart`, `r1`,
`radiusTop`, ...) and an array `cylinder` radius get the taper form instead:
`jf.cylinder({ radius: [start, end], height })` in fluent,
`primitives.cylinderElliptic({ startRadius, endRadius, height })` in
modeling, with start at the -Z end.

When the wrapped call throws, its hints and the limit a `roundRadius` error
leaves out ("roundRadius 2 is too big: it must be under half the smallest
size, 2.4 / 2 = 1.2") go on new lines of the error's message. A "X is not a
function" error gets a hint from `withErrorHint`, applied where the error
result is built (`eval/backend.js`, the app's `createEvaluate`): in fluent, X
as a method of the named classes, called on a jf shape; in modeling, the
functional call from the index signature (`transforms.translate(offset,
shape)`). `cone` gets the taper form. An "X is not defined" error, X a
modeling function or namespace the code never took from its package, gets,
in modeling, the require that brings it in (`const { cuboid } =
require('@jscad/modeling').primitives`, `const { measurements } =
require('@jscad/modeling')`), and in fluent `jf.X(...)` or `shape.X(...)`.
The boolean hint for `{ points, faces }` data also lands on the error the
boolean throws ("only unions of the same type are supported"). `test/warningCases.js` holds the cases
both the eval backend and the app must answer alike.

## Chat log reader

The `jscad-chat` launcher's relay logs each chat request as one JSONL line
(see `apps/jscad-web/README.md`). Logs and eval results live in the private
`jscad-chat-evals` repo, cloned at `~/src/jscad-chat-evals` (or
`$JSCAD_CHAT_DATA`); `chatLogDir`/`evalResultsDir` (`log/log-dir.js`) resolve
to `<data>/logs` and `<data>/results` when that repo is present, else the XDG
fallback (logs) or nothing (results, see `EVAL_RESULTS_DIR` below). The reader
groups the lines by chat id, splits them into turns, and parses each response
with the adapters' own stream parsers.

```bash
npm run read-log -w @jscadui/agent-loop -- --since 2026-09-27T00:00:00Z
npm run read-log -w @jscadui/agent-loop -- --json
```

The summary prints one block per conversation: each user message, each tool
call as `ok`, `FAILED` or `no result`, the error message and source of each
failed call, and the final assistant text. `readConversations(dir, { since })`
in `log/read-log.js` returns
`[{ chatId, model, turns: [{ ts, user, steps: [{ name, input, result, ok, error? }], final, error? }] }]`.
It reads the directory the launcher writes (`JSCAD_CHAT_LOG` when set).

## Eval

The eval replays each fixture in `eval/fixtures/` against a live model and
grades the transcript. Model code runs in a sandboxed executor process, never
in `run-eval`'s own; [architecture.md](architecture.md#model-code-in-the-eval)
has how it loads modules and [architecture.md](architecture.md#sandbox) the
sandbox. `run-eval` refuses to start without the sandbox; set it up first
([Sandbox setup](#sandbox-setup)).

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
EVAL_API=modeling EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
npm run eval -w @jscadui/agent-loop -- --compare <data>/results/a.json <data>/results/b.json
npm run eval -w @jscadui/agent-loop -- --regrade <data>/results/a.json <data>/results/b.json
npm run eval:keyless -w @jscadui/agent-loop
```

`<data>` is the `jscad-chat-evals` clone (`JSCAD_CHAT_DATA`). Live runs write
their result files to `evalResultsDir()` (see [Result files](#result-files));
only `eval:keyless`, which runs scripted known-good sources with no provider,
writes to `eval/results/`.

### Tools in the eval

A project is every file `writeModel` has written, seeded with the fixture's
`files`. `writeModel` runs the project through `main.js`, or through the file
it just wrote when the project has no `main.js`, so a write to a helper file
re-runs the model that requires it. `eval` runs its source as its entry with
the project's other files beside it. The app's `writeModel` follows the same
rule over the open project's files.

`export` answers like the app: `{ ok, format, size }`, the byte size of the
model as STL text whatever `format` asks for, since the app's worker writes STL
only. The bytes never reach the model; the user downloads from the app.
`view` fails with `UnavailableError`.

`eval` and `writeModel` results carry
`warnings: [{ fn, option, suggestions, hint }]` like the app's, worded for the
backend's `api`, and `console: [lines]` when the model run logged anything
(`console.log/info/warn/error/debug`, formatted like Node's `util.format`,
objects via `JSON.stringify`, falling back to `String` on a circular one,
capped at 50 lines and 4,000 characters total with a trailing `… (N more
lines)` note).

`eval`, `measure` and `check` results, and scratch runs, also carry
`notSaved: "not saved (2 evals since the last save); call writeModel to keep it"`
(`withSaveState` in `src/saveState.js`) while the current geometry is not the
source of the last `writeModel`, and nothing when it is, so the model reads an
instruction rather than a flag. The count is of model evals (not scratch
runs) since the last `writeModel` that ran. A `check` that comes back clean
(`checksClean`: a solid that is watertight, manifold, not inside out, not
self-intersecting and fits the bed it was given) says instead
`"checks clean and not saved (2 evals since the last save): save it now with writeModel, then refine"`.
The app adds it the same way (`apps/jscad-web/src/aiDeps.js`), from the
agent's first eval on. An `eval`
of a script with no `main()` is a scratch run: it answers
`{ ok: true, scratch: true, console, message }` and leaves the current model
and geometry unchanged, rather than failing and dropping the console output
(`writeModel` still requires a runnable `main()`).

`check` takes a `bed` only when the user names a printer: without one it
reports watertight, manifold, inside out, self-intersecting and size, with no
`fitsBed`. `measure` gives a negative-volume solid `insideOut: true` and a
note, naming the part for an array (`@jscadui/model-tools`).

### Choosing fixtures and API style

A fixture may declare `group` (string), such as `'profiles'` for fixtures whose
correct answer requires computing a point-list profile (`gear`).
The default run, with no `EVAL_FIXTURES`, runs only ungrouped fixtures: the CSG
suite of primitives and boolean operations. `EVAL_FIXTURES` runs the union of
whatever it names, fixture names and group names both, e.g. `EVAL_FIXTURES=profiles`
runs every fixture in that group, `EVAL_FIXTURES=gear,fluent-chain` runs one named
fixture plus one grouped fixture, and `EVAL_FIXTURES=all` runs every fixture
regardless of group.

`EVAL_API` (`fluent` by default, or `modeling`) picks the API style a run
teaches: its prompt, tools and docs. A fixture may declare `api`; it then runs
only under that style, even when `EVAL_FIXTURES` names it. Give it `api` when
its checks test one style's code (`fluent-chain` checks method chaining);
leave it out when its checks judge only geometry, so it runs under both. A
fixture prompt never names the API: the setting does, as the chat's settings
will for a user.

### Regrading

`--regrade` rewrites each result file in place with no provider calls; the evals
repo's git history keeps the old version. It grades each file under the `api`
the file records, in a sandboxed executor per style; a file written before the
setting has no `api` and is graded as `fluent`. It recomputes `discipline`, `recovery`,
`conservation` and `firstAttemptFailures` from the stored `transcript`, rebuilds
the saved project from the transcript's `writeModel` calls and evaluates it in a
sandboxed executor to recompute `geometry`, `checkRate` and
`geometryError` against the current checks, recomputes each run's `total`, marks
a run that ended with no provider reply as `error: "empty provider reply"` with
`providerError: true`, and rebuilds the file's `summary` and `speed`.
Transcripts, speed metrics and every other stored field stay as they were, and the
file gets `regradedAt`. A run it cannot fully regrade keeps its stored grading and
gets a `regradeNote`: no `transcript` (the file is otherwise left alone), a fixture
that no longer exists, or a transcript whose prompt differs from the current
fixture's, whose checks then do not apply (stored `geometry` kept, unless the run
saved nothing). Use it after a grading-rule change to update old result files
without spending API budget.

### Environment variables

| Variable | Meaning |
|---|---|
| `EVAL_PROVIDER` | provider kind: `anthropic`, `openai`, `opencode-go`, `meta` |
| `EVAL_MODEL` | model id |
| `EVAL_API` | API style to teach: `fluent` (default) or `modeling`; anything else exits with an error |
| `EVAL_API_KEY` | provider key; overrides everything below |
| `EVAL_BASE_URL` | provider base URL, without `/v1` |
| `EVAL_RUNS` | runs per fixture, default 3 |
| `EVAL_CONCURRENCY` | conversations run at once, each with its own sandboxed executor, default 6 |
| `EVAL_MAX_TURNS` | turn cap for every conversation; overrides `eval/models.json` and the fixture's `maxTurns` |
| `EVAL_FIXTURES` | comma-separated fixture and/or group names to run; default: ungrouped fixtures only; `all` runs everything |
| `EVAL_VERBOSE` | `1` also prints the live log's lines to stdout, turn by turn: the header and prompt, tool calls with full input, tool results, and streamed assistant text |
| `JSCAD_CHAT_DATA` | path to the `jscad-chat-evals` clone, default `~/src/jscad-chat-evals` |
| `EVAL_RESULTS_DIR` | overrides where results are written, regardless of `JSCAD_CHAT_DATA` |
| `JSCAD_CHAT_KEYS` | overrides the path to `keys.json` below |
| `EVAL_LIVE_LOG` | overrides the live log path; `0` disables it |
| `EVAL_CRT` | absolute path of the crt binary; default: `crt` on `PATH` |
| `CRT_HOME` | where crt keeps its rootfs dirs, passed to crt; when unset, the eval asks `crt home` for its resolved default (`/data/crt/home/$USER` if it exists, else `/home/crt`); must be outside `$HOME`, `/tmp` and the repo |
| `EVAL_SANDBOX_ROOTFS` | crt rootfs the executor runs in, default `jscad-eval` |
| `EVAL_SANDBOX_MEMORY` | executor memory limit in crt's grammar (`2G`, `1536M`, a bare number is bytes), at least 512M, default `2G`; V8's heap gets three quarters of it |
| `EVAL_SANDBOX` | `crt` (default); anything else is refused by `run-eval` |
| `EVAL_REQUIRE_MEMORY_LIMIT` | `1` refuses to start when crt cannot enforce the memory limit (`ci/eval` sets it); otherwise a loud warning |
| `EVAL_PROCESSES` | run-eval processes sharing the host (`ci/eval` sets the model count), for the concurrency cap in [architecture.md](architecture.md#sandbox); default 1 |
| `EVAL_RUN_TIMEOUT` | seconds a conversation may run before it is stopped and graded, default 1200 |

### Turn cap

A conversation's turn cap (provider calls) is `EVAL_MAX_TURNS` when set, else
`maxTurns` from the model's entry in `eval/models.json`
(`{ "<model id>": { "maxTurns": 8 } }`), else the fixture's own `maxTurns`.
The cap a model gets is a budget for fixing its own mistakes across turns, so
set it per model rather than tuning it to one-shot answers. Each result records
its effective cap as `maxTurns`; the result file's top-level `maxTurns` is the
model-level cap, or `null` when every fixture kept its own.

### Concurrent runs

Each fixture × run is one conversation with its own provider instance and its
own sandboxed executors. `eval/parallel.js` keeps up to
`EVAL_CONCURRENCY` conversations going. It collects each result as it
finishes, prints its per-run line, and rewrites the result file with every
finished run ordered by fixture then run, whatever order they finished in. An
error stays on its run's `error`; a run that throws outright records
`error: "run crashed: …"` with its `api`, and the suite goes on. A
conversation stops at
`EVAL_RUN_TIMEOUT` seconds (default 1200) with `error: "run time limit of …
reached"` and is graded on what it saved. A rejected turn (a tool timeout, the
run limit) keeps the transcript up to that point.

### Live log

Every run appends the same conversation lines `EVAL_VERBOSE` prints — run
headers, prompts, tool calls with source, tool results, provider retries,
per-run summaries, and the final tables and speed line — to
`~/.local/state/jscad-chat/eval-live.log` (`eval/live-log.js`), whether or not
`EVAL_VERBOSE` is set; that variable only controls stdout. A conversation's
lines, on stdout and in the log, are prefixed `[<model>/<api> <fixture>#<run>] ` so
concurrent conversations stay legible; the header, summary tables and speed
line are prefixed `[<model>/<api>] `. A multi-line block (a model source, a
multi-line error) gets the prefix on every line. The file starts with one header line: time, provider,
model and api (`model=<model>/<api>`), the prompt hash's first 8 characters, the fixture names, the run
count, the model turn cap (`maxTurns=fixture` when there is none) and the
result file path. Past 10 MB the file rotates to
`eval-live.log.1` (replacing an older one) before the next write, so
`tail -F ~/.local/state/jscad-chat/eval-live.log` in a second terminal
follows a run live across the rotation. The log never receives anything
beyond this text, so no key material reaches it.

### Provider keys

Without `EVAL_API_KEY`, the key for `EVAL_PROVIDER` is looked up in order:

1. `~/.config/jscad-chat/keys.json` (or `JSCAD_CHAT_KEYS`), shape `{ "<provider>": "<key>" }`, mode 600.
   This holds the dedicated `jscad-chat` service account key and is the preferred source for
   `opencode-go`; use it instead of a personal key.
2. The provider's own auth file: `EVAL_PROVIDER=meta` reads `providers.meta.api_key` and
   `api_base_url` from `~/.config/muse/auth.json`; `EVAL_PROVIDER=opencode-go` reads
   `["opencode-go"].key` from `~/.local/share/opencode/auth.json`.

A missing or unreadable `keys.json` falls through silently to the provider auth file. When
`opencode-go` falls back to the opencode auth file, `run-eval` prints one warning to stderr
telling you to add the key to `keys.json` instead.

### Grading

Each run is graded on discipline, recovery, geometry and conservation (0-2
each, total 8) and on `firstAttemptFailures`: the failed tool results before the first
successful `eval`, or before the end of the run if none succeeds.

Discipline asks whether the model checked its model. Verification is a
`measure` or `check` call, or an `eval` whose source calls a `measure*`
function (`shape.measureDimensions()`, `measureVolume()`, as `fluent.md`
teaches) and whose result carries console output. A run with an `eval` gets 2
when the fixture has no `verifyBeforeWrite`, when it never writes, or when it
verifies before or after its first `writeModel`, else 1; `writeModel` runs the
model, so measuring after the save counts. A run with no `eval` gets 2 when it
verifies after a `writeModel`, else 0. Recovery is 2 when no tool call failed
or a success followed the last failure, else 0; a run the turn cap ended
(its last round's results got no reply) leaves that round's failures out,
since it had no turn left to recover in. Conservation is 2 for at most 12 tool
calls, 1 for at most 24, else 0, counting every call except `writeModel`, so
saving often never costs a point.

Geometry grades the project the run saved, since that is what the app's user
keeps: every file written, evaluated again through its entry in a fresh backend
state after the run ends, so a probe `eval` after the save changes nothing. A
model that has not finished after 120 s at grading time gets no geometry. A fixture
whose `requires` lists `writeModel` gives a run that never called it geometry 0
and `checkRate` 0 without running its checks, and marks the report
`saved: false`; the other three grades still count, so such a run scores at
most 6. A fixture that does not require `writeModel` is graded on the saved
project, else the last `eval`.

A provider call that streams neither text nor a tool call is an empty reply,
even when it streamed reasoning and a `usage` event; the run records
`error: "empty provider reply"`. The turn cap's own closing round is not one.
Each run records its provider calls' stop reasons in order as `stopReasons`
(`end_turn`, `tool_use`, `length`, ...). An empty reply and any error the provider's stream
throws (HTTP, network, auth, rate limit) also set `providerError: true`. A
transient overload or rate limit retries first ([architecture.md](architecture.md#providers)
metrics under `providerRetries`); only an error that survives every retry
reaches the run as a `providerError`.

The summary gives, per fixture, the mean `firstAttemptFailures`, the pass rate
of its geometry checks, the mean total and the count of runs with an `error`.
A `providerError` or `infraError` run has no answer to score, so those three
means leave it out; they are `null` (printed `-`) when every run had one.
Errors the model caused (a tool timeout from a model that never finishes, an
executor its code ended) score like any other run. The metric means below include every run.

### Metrics

Each result also carries `metrics`, degrading gradually where the 0-2 grades
tend to max out once a prompt clears the bar:

- `rounds`: provider calls in the run (one per `send()` on the wrapped
  provider, capped at the run's `maxTurns`).
- `toolCalls` / `failedCalls`: every tool call and every failed tool result in
  the run, not just the ones before the first success. Transcript-derived, so
  `--regrade` recomputes them from the stored transcript.
- `warnings`: unknown-option warnings returned on the run's `eval` and
  `writeModel` results, summed. Transcript-derived.
- `docsCalls`: `docs` calls in the run. Transcript-derived.
- `inputTokens` / `outputTokens`: summed over the run's provider calls from a
  `usage` stream event (Anthropic's `message_start`/`message_delta`, OpenAI's
  `stream_options.include_usage` final chunk, or the Responses API's
  `response.completed`); `null` when the provider never reports usage.
- `reasoningTokens`: summed the same way, from OpenAI chat completions'
  `usage.completion_tokens_details.reasoning_tokens` or the Responses API's
  `usage.output_tokens_details.reasoning_tokens`; `null` when the provider
  never reports it (Anthropic never does).
- `providerRetries`: retries the provider wrapper made across the run's calls
  (see [architecture.md](architecture.md#providers)); 0 when none happened.
  Transcript-independent, so `--regrade` leaves it as stored.
- `seconds`: wall time of the run.
- `geometryError`: relative error against an optional fixture `target`
  (`{ volume?, dimensions? }`): the max of `|volume - target| / target` and,
  for `dimensions`, the max per-axis relative error comparing both sides
  sorted ascending (so orientation doesn't matter); `null` when the fixture
  has no `target` or no geometry was produced.
- `providerSeconds`: sum, over the run's provider calls, of the time from
  starting `send()` to the end of its stream. Model/provider speed, not
  score; a slow model doesn't lose points.
- `firstTokenSeconds`: mean, over the run's provider calls, of the time from
  starting `send()` to the first streamed `text` or `tool_use` event (not
  `usage`/`done`); `null` when no call produced one.
- `outputTokensPerSecond`: the run's `outputTokens` divided by `providerSeconds`,
  an effective rate that includes time spent before the first visible token
  (e.g. reasoning); `null` when `outputTokens` is `null` or `providerSeconds`
  is zero.

`summarize` means each of these per fixture (over non-null values; `null`
when none exist), and `formatSummary`/`formatComparison` print them in a
second and third table alongside the existing one, showing `-` for a result
file written before `metrics` existed. `reasoningTokens` appears only in
`formatSummary`'s third table, not in `formatComparison`. `--regrade` fills
only `toolCalls`, `failedCalls`, `warnings`, `docsCalls` and `geometryError`;
the rest, including the speed fields, are left as stored, since they need the
original provider run.

Each result file also carries a top-level `speed` object, summed/medianed
over every run in the file: `{ wallSeconds, providerSeconds, toolSeconds,
medianFirstTokenSeconds, medianOutputTokensPerSecond, runs }`. `wallSeconds`
is the elapsed suite time, less than the sum of the runs' `seconds` when
conversations overlap. `toolSeconds` is `seconds - providerSeconds` per run,
summed: wall time not spent waiting on the provider. `saveResults` and
`--regrade` recompute it from the file's results on every write; `--regrade`
keeps the stored `wallSeconds`. `formatSummary` prints one line from it, e.g.
`speed: model muse-spark-1.3 via meta  wall 812s  provider 640s  tools 172s
first token 1.8s (median)  94 tok/s (median)`; `formatComparison` prints one
such line per file.

### Result files

Each result file, `<YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>-<sha8>.json` in the
result dir, records its `api` (also on each run) and the SHA-256 of that
style's assembled system prompt, so `--compare` can set two prompt versions
side by side. The two styles' prompts hash differently, and `--compare`
refuses two files of different styles; a file written before the setting has
no `api`, and comparing it prints a warning and goes on. The result dir is
`evalResultsDir()`: `EVAL_RESULTS_DIR` when set, else `<data>/results` when
the evals repo is present; with neither, `run-eval` exits 1 before calling any
provider. `--compare` always takes explicit paths. The file is rewritten after
every run, so an interrupted eval keeps every run that finished. Each result
also carries `transcript`, the run's messages minus the system prompt, for
tracing a stumble back to the tool calls that caused it. The eval prints one
line per run as each finishes. The key is never printed or written.

### Fixtures

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid, probe }), api?, transcript?, files?, target?, probe? }`.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses. `target` (`{ volume?, dimensions? }`) feeds
`geometryError` for a fixture whose prompt fixes the geometry. `measure`,
`params`, `source` and `solid` all describe the graded project (`gradedModel` in
`eval/grade.js`; `source` is every file joined), so a check can inspect the code the model saved as well as
the geometry it produced (a style check on a fluent chain, for example).
`solid` is the parsed result of the backend's `check` tool on that model
(`eval/backend.js`, `@jscadui/model-tools`), or `null` when it produced no
geometry; checks use it for `watertight` since `measure` alone doesn't report
it. `check` reports `watertight: false` and `insideOut: true` for a
negative-volume (inside-out) solid.

`probe` asks the grader for facts `measure` does not give (`eval/probe.js`),
computed on the same geometry and passed to `checks` as `probe`, `null` when
there is no geometry:

- `sections: [{ axis, at?, above? }]` cuts the model normal to `axis` at each
  fraction `at` of its extent and each distance `above` (mm) over its minimum,
  and splits each cut into loops: `{ axis, at | above, offset, loopCount,
  loops: [{ area, boundingBox, dimensions }] }`, largest first, with outer
  loops' `area` positive and holes' negative. `outerLoops`, `holeLoops` and
  `footprint` (a loop's two in-plane sizes, smaller first) read them.
- `bodies: { sections? }` lists the separate solids, each array item split into
  the parts that share no vertex: `{ boundingBox, dimensions, volume,
  sections? }`, with `sections` cut through that body alone.

`followup-edit`, `pencil-cup`, `hook-rack`, `nameplate` and `box-with-lid` use
it for a slot, wall thickness, an open top, a hook count, lettering and a lid's
fit. `eval/reference-answers.test.js` grades a reference answer for each of
those fixtures in both API styles through the backend, and a plain block that
must fail.

A fixture's `prompt` is a request a real user would type: casual and often
underspecified, never a specification written to be graded, and never phrased
to steer the model toward a particular answer. `checks` test properties any
reasonable answer has (plausible size, hollow where the object should be
hollow, watertight, a size the prompt actually states) rather than one exact
shape; an exact-volume band is only for a fixture whose prompt pins the
geometry precisely.

### Sandbox setup

`run-eval` resolves the crt binary once at startup (`EVAL_CRT`, else the first
`crt` in an absolute `PATH` entry) and refuses to start, live or `--regrade`,
until an executor starts in the sandbox: the error names what is missing (the
crt binary, the rootfs, a stored config equal to `ci/jscad-eval.crt`, Node
22.15 or later in the rootfs, a CRT_HOME in an allowed place) and how to set
it up. `EVAL_SANDBOX=none` or
`child` is refused for both. Set up the rootfs once, as the user the eval runs
as:

```bash
sudo crt install                       # once per host
sudo crt setup s-ci                    # once per job user, so crt can enforce the memory limit
crt doctor --limits                    # check the install and cgroup delegation
scripts/eval-sandbox-setup.sh          # crt create jscad-eval ci/jscad-eval.crt if absent, then check it
scripts/eval-sandbox-setup.sh --check  # check only
```

`CRT_HOME`, when unset, resolves to whatever `crt home` prints: on the
`/data/crt` layout that's `/data/crt/home/<user>`, else `/home/crt`. It must
lie outside `$HOME`, `/tmp` and the repo dirs the eval binds; crt refuses
hardened runs otherwise, and the setup script and `run-eval` say so first
(`crt doctor --limits` diagnoses a failed check).

What the rootfs holds, how the memory limit is checked, and why the rootfs must
never run writable are in [architecture.md](architecture.md#sandbox).

### Running on CI

`sci push jscadui/eval` (`ci/eval`, `ci/eval.conf`) runs this eval against
live models on the CI host instead of locally, one process per model in
`EVAL_MODELS` and style in `EVAL_APIS`: models run concurrently, each model's
styles one after the other. Provider keys come from the job user's
`$HOME/.config/jscad-chat/keys.json` (for the `s-ci` host user under the
`/data/crt` layout, `/data/ci/.config/jscad-chat/keys.json`, mode 600), placed
there by hand; a model whose provider has no key there fails on its own. The job runs
`scripts/eval-sandbox-setup.sh --check` first and fails when the host has no
crt, no rootfs or no cgroup delegation for the memory limit; host setup is in
`ci/README.md`. Results land in the job's
`eval-results/`; fetch them into `$JSCAD_CHAT_DATA/results` with
`node eval/fetch-ci-results.js JOB-ID`. Details: `ci/README.md`.

## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and keep the change only when it passes the keep rule in step 6 of that
skill.
