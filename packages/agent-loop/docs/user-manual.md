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

The fluent prompt names `@jscad/modeling` only to rule it out; a jscad-text
outline becomes chainable as `new jf.FluentGeom2(outline)`. The modeling
prompt never mentions jscad-fluent. Both say `jscadText.text2d` needs no
`init`: the app and the eval set jscad-text up with the `@jscad/modeling` they
serve before model code sees it
([architecture.md](architecture.md#model-code-in-the-eval)).

## Conversation context

```js
buildMessages({ systemPrompt, transcript, files, build, message, budget = CONTEXT_BUDGET })
```

Returns the system prompt, the newest whole prior turns that fit in `budget`
characters (24,000 by default), a user message with every text file in
`files` under `### <path>` followed by `build`, the project's last build
report, under `Last build of the project:` (both outside the budget), and the
new message. The project message is always sent: an empty project with no
build is `The project is empty; no build yet.`, and a missing part says
`The project has no files.` or `The project has not been built yet.`, so the
model needs no `list` to learn the project's state. Every header ends with
`PROJECT_NOTE`: "Every message comes with this note on the project: its text
files and its last build, so list is rarely needed." The app and the eval both
use it.

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
it in the chat as an error. A round the provider refused instead rejects with
`RefusalError`, whose `refusal` is the provider's text and whose message is
`the provider refused: <text>` (`the provider refused to answer` when it gave
none). The adapters read a refusal from Responses `response.refusal.delta`
events or, when none streamed, the `refusal` content of the completed output
(Meta's safety filter answers that way, in about 2 s), from chat-completions
`delta.refusal`, and from Anthropic's `refusal` stop reason. A tool call whose arguments are not JSON (a
stream cut off mid-arguments, or two calls run together) does not end the
turn: the provider adapters hand it on with `badArguments`, its first 300
characters, and `runTurn` answers it without running the tool, as
`{ ok: false, error: { name: 'ArgumentsError', message: 'arguments for
measure were not valid JSON (finish_reason length); call it again with a JSON
object: {"parts":…' } }`, which the transcript keeps.

## Turn status

```js
runTurn({ conversation, provider, requestTool, onText, onReasoning, onStatus, signal, toolTimeoutMs, api })
```

`onText(delta)` hears each chunk of reply text and `onReasoning(delta)` each
chunk of reasoning the provider streams, in the order they arrive. Reasoning
never enters the returned messages, so it is never sent back to the model.
A step's reasoning ends when its text starts (`text` phase), its tool runs
(`tool` phase), the next request starts (`thinking` with no
`reasoningChars`), or the turn ends (`done`); the app's chat closes its
reasoning block on each of these.

`onStatus`, when given, hears where the turn is:

| Status | When |
|---|---|
| `{ phase: 'thinking' }` | each provider request starts |
| `{ phase: 'thinking', reasoningChars }` | each `reasoning` event, with the characters of reasoning so far in this request, just before `onReasoning` hears it |
| `{ phase: 'text' }` | text starts streaming (once per run of text, not per chunk) |
| `{ phase: 'tool', tool, detail? }` | before a tool runs; `detail` is its `path`, `query` or `format`, cut to 40 characters |
| `{ phase: 'retry', attempt, maxAttempts }` | the provider is retried; `attempt` is the one about to start |
| `{ phase: 'done' }` | the turn has ended, resolved or rejected |

A call whose arguments are not JSON reports no `tool` phase, since it does not
run. An `onStatus` that throws does not end the turn. The app's chat draws its
status line and Stop button from it
(`apps/jscad-web/docs/architecture.md`, Chat UI states); the eval leaves it
out. Aborting `signal` rejects the turn with `AbortError`.

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
`primitives.cylinderElliptic` under modeling. `text` answers with
`jscadText.text2d` in both APIs, with how to extrude its outline, and under
modeling a pointer to `@jscad/modeling`'s stroke-only `text` namespace; the
`text2d` entry says it needs no `init`. `params` or `parameters`
(also `params.<name>`) answers with the prompt's parameter conventions
(`PARAMS_ANSWER`): the proxy assignment, the types params-core keeps and
their fields, `_type` sections with how a section's parameter is defined and
read back (`params.lid.height`), and hidden names. `jf.cylinder`'s `outer` has
no default in the index, since fluent reads it only with `inner` or `wall`,
and a lone `outer` warns. A namespace or class answers
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
| clockwise points (negative signed area) in one flat outline to `jf.polygon`, `primitives.polygon` (no `paths`, no `orientation: 'clockwise'`) or `geometries.geom2.fromPoints`: the check reverses them before the call | `{ fn, option: 'points', hint }`: "points ran clockwise (area -50); reversed them so extrusions come out right side out" |
| clockwise points it leaves alone: `primitives.polygon` with `orientation: 'clockwise'` turning counter-clockwise points clockwise | "points run clockwise (area -50), so an extrusion of this outline comes out inside out: list them counter-clockwise, e.g. jf.polygon([...points].reverse())" |
| a `subtract` or `intersect` (modeling `booleans`, `jf`, or a `FluentGeom3`/`FluentGeom2` method) that returns an empty shape from a non-empty first shape | `{ fn, hint }`: what emptied it, and the bounding-box measure to compare the shapes with |
| `{ points, faces }` data (what `jf.hullPoints3` returns) given to a boolean | `{ fn, hint }`: make it a shape with `jf.polyhedron(...)` or `primitives.polyhedron({ points, faces })` |
| `jf.cylinder` given `outer` with neither `inner` nor `wall`, which fluent ignores | `{ fn, option: 'outer', hint }`: "outer takes effect only with inner or wall; use radius for a solid cylinder" |
| a `roundRadius` to `roundedCuboid`, `roundedRectangle` or `roundedCylinder` (modeling or `jf`) past the limit modeling throws at (half the smallest size; for a cylinder half the height or the radius): the check lowers it to the largest value in thousandths modeling accepts before the call | `{ fn, option: 'roundRadius', hint }`: "roundRadius 2 is too big: it must be under half the smallest size, 2.4 / 2 = 1.2; used 1.199" |
| a number `startRadius` or `endRadius` to `cylinderElliptic` (modeling or `jf`), which takes an `[x, y]` pair: the check makes it `[r, r]` before the call | `{ fn, option, hint }`: "startRadius takes an [x, y] pair of radii; used [5, 5] for 5" |

Each warning also names the `file` and `line` of the model's call, taken
from the stack when the collector has the project base, as the eval and the
frame give it. The collector keeps one warning per function, option and call
site, so a slip made at three calls lists all three.

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

When the wrapped call throws, its hints go on new lines of the error's
message, and so does the cause of a number or array option that is NaN or an object ("height is
NaN: a parameter read back as NaN or an object often causes this; docs params
shows how to define and read one"), since modeling's own error ("height must
be greater then zero") hides it. params-core defines a section assigned as
one object (`params.box = { wall: { default: 3 } }`) member by member, and
throws for one that mixes definitions with plain values, naming the
parameter and the per-member form. A "X is not a
function" error gets a hint from `withErrorHint`, applied where the error
result is built (`eval/backend.js`, the app's `reportError` in `src/projectBuild.js`): in fluent, X
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

The summary prints one block per conversation, headed by its chat id, model
and API style, then each user message, each tool call as `ok`, `FAILED` or
`no result`, the error message and code of each failed call (a `write`'s path
and content, an `edit`'s path and its `-`/`+` strings, a `run`'s source), and
the final assistant text. The style comes from the system prompt's own
heading (`## jscad-fluent style` or `## @jscad/modeling style`, wherever the
provider carries it — `request.system` for Anthropic, `request.instructions`
or a leading `input` item for Responses, a leading message for chat
completions); a log from before the two-style split, whose prompt taught
both, reports `unknown`. `readConversations(dir, { since })` in
`log/read-log.js` returns
`[{ chatId, model, api, turns: [{ ts, user, steps: [{ name, input, result, ok, error? }], final, error? }] }]`.
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

The eval backend (`eval/backend.js`) answers the chat's tools the way the app
does ([architecture.md](architecture.md#project-model) has the tools, the
entry rule and the build report). A run's project starts as the fixture's
`files`; when there are any, the backend builds them before the first
message, and that build report goes into the header with the files.

`write` and `edit` answer with the build report, headed by `saved`, the
file written, and with a `note` saying it is saved when the build failed. A
project with no entry file builds nothing and answers `ok: true, entry: null`
with `note: "saved; no entry yet (main.js, index.js or package.json main)"`.
A build fails with `NoMainError` when the
entry exports no `main()` (`<entry> exports no main()`), `NoGeometryError`
when `main()` returns something `measure` cannot read (`main() returned
something that is not geometry; ...`), and otherwise with the model code's own
error. The app words the first two the same (`noMainError`,
`notGeometryError` in `src/buildReport.js`), with no API hint. One part is
measured, checked and exported as itself, more as an array, as the frame
does (`asGeometry`). A syntax
error is located by parsing each project file with Babel, entry first, since
the eval's `SyntaxError` carries no location. `measure`, `check` and `export`
fail with `NoGeometryError` before the first build (`no geometry: write the
model first`) and after a failed one (`no geometry: the last build failed
(<message>); fix it first`). `run` answers
`{ ok, warnings, console, geometry? | returned? }`, or
`{ ok: false, error, warnings, console }`; its `geometry` has the build
report's fields, `watertight`, `manifold` and `selfIntersecting` included. A
`run` stops after 30 s with `{ ok: false, error: { name: "TimeoutError",
message: "run stopped after 30 s; try a smaller case" } }`, in the app and the
live eval alike, and an allocation failure in a run or a build reads `out of
memory; try a smaller case`.

`export` answers like the app: `{ ok, format, size }`, the byte size of the
model as the frame's `@jscad/io` serializer for that format writes it
(`exportConfig` in `src/exportFormat.js`; `stl` is binary STL). A format with
no serializer fails with `ExportFormatError` in both. The bytes never reach
the model; the user downloads from the app. Under the local launcher, where
the project is a directory on disk, the app also writes the file there and
adds its `path` (`main.stl` for `main.js`); the eval writes nothing and
answers no `path`. `read` of a binary project file
fails with `BinaryFileError`.
`view` fails with `UnavailableError`, and any other name, `eval`,
`writeModel` and `params` included, with `UnknownToolError`.

Build reports and `run` results carry
`warnings: [{ fn, option, suggestions, hint, file, line }]` like the app's, worded for the
backend's `api`, and `console: [lines]` with what the model run logged
(`console.log/info/warn/error/debug`, formatted like Node's `util.format`,
objects via `JSON.stringify`, falling back to `String` on a circular one,
capped at 50 lines and 4,000 characters total with a trailing `… (N more
lines)` note).

`measure` and `check` results carry `units: "mm"` (`withUnits`,
`src/units.js`; the app's `aiDeps.js` adds it the same way), and both tool
descriptions say their sizes are millimetres. A `measure` with `section`
gives each loop's outline as points in the section plane, holes marked
(`@jscadui/model-tools`' README has the caps), since models otherwise sliced
the model with thin slabs in `run` to see a profile.

`check` takes a `bed` only when the user names a printer: without one it
reports watertight, manifold, inside out, self-intersecting and size, with no
`fitsBed`. A solid with open edges gets `openEdgeSamples`, the midpoints of up
to five of them, so the model can find where the gap is. No result names a
tool the model cannot run. `measure` gives a negative-volume solid `insideOut: true` and a
note, naming the part for an array (`@jscadui/model-tools`).

### Choosing fixtures and API style

A fixture may declare `group` (string), such as `'profiles'`, an opt-in group
kept for experiments (`gear`).
The default run, with no `EVAL_FIXTURES`, runs the ungrouped fixtures, the CSG
suite of primitives and boolean operations, and the `harder` group
(`DEFAULT_GROUPS` in `eval/run-eval.js`): one message asking for several
changes to a saved model (`stand-bigger-slots`, `box-thicker-lid`,
`bracket-m5`), a correction mid-conversation (`holes-through-side`),
assemblies of parts that fit (`sliding-lid-box`, `hinge`, `stacking-trays`),
parameters the user names (`bracket-params`), a name cut through a part
(`luggage-tag`), a real part the model must know the sizes of
(`pi-enclosure`, `bottle-cap`), a stated opening and clearance (`drawer`), and
computed shapes (`spur-gears`, `twisted-vase`, `bottle-cap`'s helix).
`profiles` stays opt-in. `EVAL_FIXTURES` runs the union of
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
the project from the transcript's `write` and `edit` calls, or an older file's
`writeModel` calls, and builds it in a
sandboxed executor to recompute `geometry`, `checkRate` and
`geometryError` against the current checks, recomputes each run's `total`,
renames an older report's `saved: false` to `wrote: false` (dropping it from a
provider-error run), marks
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
| `EVAL_FIXTURES` | comma-separated fixture and/or group names to run; default: ungrouped fixtures and the `harder` group; `all` runs everything |
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
| `EVAL_PROCESSES` | run-eval processes sharing the host (`ci/eval` sets the model × API lane count), for the concurrency cap in [architecture.md](architecture.md#sandbox); default 1 |
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
each, total 8) and on `firstAttemptFailures`: the failed tool results before the
first successful build (a `write` or `edit` whose report is `ok`, or an older
file's successful `eval`), or before the end of the run if none succeeds.

Grading reads result files from before the file tools too: there `eval` was a
trial run and `writeModel` a save of `source` to `entry` (`main.js` by
default), and each counts below where `run` and `write` do.

Discipline asks whether the model checked its model. Verification is a
`measure` or `check` call, a `write` or `edit` whose build report came back
`ok` with `geometry` and no error (the report already carries the measured
geometry), or a `run` whose source calls a `measure*`
function (`shape.measureDimensions()`, `measureVolume()`, as `fluent.md`
teaches) and whose result carries console output. A run with a `run` gets 2
when the fixture has no `verifyBeforeWrite`, when it never writes, or when it
verifies before or after its first `write` or `edit`, else 1; a save builds the
model, so measuring after it counts. A run with no `run` gets 2 when it
verifies after a save, else 0. Recovery is 2 when no tool call failed
or a success followed the last failure, else 0, counting every call but a
scratch `run`, which neither breaks nor fixes the project (a failed `run`
still counts toward conservation); a run the turn cap ended
(its last round's results got no reply) leaves that round's failures out,
since it had no turn left to recover in. Conservation is 2 for at most 12
counted calls, 1 for at most 24, else 0. It counts every call except a
successful `write`, `edit`, `read` or `list` (and an older file's
`writeModel`), so failed builds and failed calls count, and saving often or
reading before editing never costs a point.

Geometry grades the project's final state, since that is what the app's user
keeps: the fixture's files with every `write` and `edit` replayed (one the
backend refused changes nothing), built through its entry in a fresh backend
state after the run ends, so a scratch `run` changes nothing. A project with
no entry file, or whose final state does not build, gets geometry 0 (an older
file with no entry file builds the file its last `writeModel` wrote). A
model that has not finished after 120 s at grading time gets no geometry. A
fixture whose `requires` lists `write` gives a run that neither wrote nor
edited a file geometry 0 and `checkRate` 0 without running its checks, and
marks the report `wrote: false`, unless the provider ended the run
(`providerError`); the other three grades still count, so such a run scores
at most 6. A fixture that does not require `write` is graded on
the saved project, else an older file's last `eval`, else its own files.

A provider call that streams neither text nor a tool call is an empty reply,
even when it streamed reasoning and a `usage` event; the run records
`error: "empty provider reply"`. The turn cap's own closing round is not one.
Each run records its provider calls' stop reasons in order as `stopReasons`
(`end_turn`, `tool_use`, `length`, ...). An empty reply and any error the provider's stream
throws (HTTP, network, auth, rate limit) also set `providerError: true`. A
transient overload, a rate limit, or a stream cut off before any text or tool
call retries first ([architecture.md](architecture.md#providers), counted in
`providerRetries`); only an error that survives every retry reaches the run as
a `providerError`. A stream cut off after the reply began is not retried and
ends the run with `error: "<adapter>: stream terminated after the reply began (terminated)"`.

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
- `warnings`: unknown-option warnings returned on the run's tool results
  (build reports and `run` results), summed. Transcript-derived.
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
  (see [architecture.md](architecture.md#providers)): after a 429/5xx or
  overload status, a failed connection, or a stream cut off before any text
  or tool call. 0 when none happened. The live log prints each one, for
  example `retry 1/4 after network error: stream terminated before content
  (terminated) (waiting 2000ms)`. A cut-off attempt's `usage` events still
  count toward the token metrics. Transcript-independent, so `--regrade`
  leaves it as stored.
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
`formatSummary`'s third table, not in `formatComparison`, which compares mean
`inputTokens` and `outputTokens` and ends with the suite total: the sum of
mean totals over the fixtures both files scored. `--regrade` fills
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
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid, probe }), api?, transcript?, files?, apiFiles?, target?, probe? }`.
`requires` names tools the task needs (`['write']`, `['measure', 'write']`;
`write` is satisfied by a `write` or an `edit`); only `write` changes grading.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses. A follow-up whose starting project is written in
one API style gives each style its own instead, as
`apiFiles: { fluent: files, modeling: files }` (`followup-edit`): a run, and
`--regrade` of a result file, start from the files of their API
(`fixtureForApi` in `eval/run-eval.js`). `target` (`{ volume?, dimensions? }`) feeds
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
  `footprint` (a loop's two in-plane sizes, smaller first) read them. With
  `groupGap` (mm), each cut also has `groups`: the loops whose bounding boxes
  lie within that distance of each other, each group `{ loopCount, area,
  hullArea }`, where `hullArea` is its convex hull's area, so a hull larger
  than the area shows material cut out of a part. With `outline: true`, each
  cut also has `centre`, the centroid of its largest loop, and each loop adds
  `centroid` (in-plane), `perimeter`, `radius: [nearest, farthest]` from
  `centre`, `lobes`, the bumps around its own centroid (teeth, star points;
  0 for a round loop), and `harmonics: [{ k, magnitude, angle }]` for k = 1 to
  12, the mean of (z − centre)^k over the loop's region, z = u + iv, with
  `magnitude` its size over farthest^k and `angle` its argument over k in
  degrees. `turnOf(loops)` reads one loop per cut, in order: it picks the
  lowest harmonic at least half as strong as the strongest in every loop and
  unwraps its angle from cut to cut, `{ k, magnitude, degrees }`, so a twisted
  outline or a helical thread shows as steadily growing degrees.
- `bodies: { sections?, overlaps? }` lists the separate solids, each array
  item split into the parts that share no vertex: `{ boundingBox, dimensions,
  volume, polygonCount, sections? }`, with `sections` cut through that body
  alone. With `overlaps: true` the probe also has `overlaps: [{ a, b, volume
  }]`, the volume bodies `a` and `b` (indexes into `bodies`) share, for each
  pair whose bounding boxes overlap, at most 45 pairs; touching parts share
  none. `nesting(upper, lower, axis)` reads two bodies cut densely along
  `axis`: `{ depth, play }`, how far `upper`'s bottom goes into `lower`'s top
  with every cut of `upper` inside `lower`'s largest hole at that height (a
  foot) or around `lower`'s outline in a hole of its own (a skirt), and the
  least gap across each footprint dimension over that depth, `play: null`
  when it does not go in.
- `paramVariants: true` rebuilds the model once per number parameter (up to
  12, each started only while twice the slowest build so far fits in the
  grade's time limit) with that one parameter set 20% above
  its initial value, else 20% below, else to the far end of its range, as the
  user's form would, and lists `{ name, label, from, to, dimensions, volume,
  changed }` for each, `changed` when the size or volume moved, or `{ ...,
  error, changed: false }` when the rebuild failed.

`followup-edit`, `pencil-cup`, `hook-rack`, `nameplate` and `box-with-lid` use
it for a slot, wall thickness, an open top, a hook count, lettering and a lid's
fit. In the `harder` group, `stand-bigger-slots` counts slots as runs of cuts
across the width whose area falls 5% below the median and takes rounded edges
from a polygon count at least three times the starting stand's;
`holes-through-side` wants no hole in any horizontal cut and two 8 mm holes in
a cut across x or y; `sliding-lid-box` and `hinge` read `overlaps`, and
`hinge` wants the pin's narrowest round cut 0.02 to 1 mm per side inside a
round bore in both leaves; `bracket-params` reads `paramVariants` for a width,
a height and a hole-size parameter that each change the model; `luggage-tag`
wants three holes (the letters) in every cut across its thickness, and a
fourth, near an end, for the strap. `box-with-lid` passes a lid whose footprint reaches from 2 mm inside the
box's opening to the box's outer size plus twice (its wall + 1 mm), and at
least 6 mm more, so a skirt lid as thick as the box wall fits.
`followup-edit` finds the slot in the saved model's own sections: a group of
loops within 20 mm of each other whose area falls short of its convex hull by
at least 25 mm² and 2% of the hull, since every part of the starting stand
fills its hull. It never compares with the starting model's areas, so an
edit that also resizes the base is judged the same.
`eval/reference-answers.test.js` grades a reference answer for each of
those fixtures in both API styles through the backend, and a plain block that
must fail, plus cases a past run misgraded (a 3 mm skirt lid with 0.3 mm
clearance, a 12 mm slot through a base widened from 70 to 80 mm).
`eval/harder-answers.test.js` does the same for the `harder` group, plus a
wrong answer for each check: a follow-up's starting model, one of several
changes left out, overlapping or fused parts, a pin with no clearance, a
parameter the model never reads, raised lettering.
`eval/harder-fit-answers.test.js` covers the fixtures that need outline facts
or `nesting`, with wrong answers such as half the twist, a round vase, 20 and
30 teeth, mixed modules, gears meshed 3.5 mm too far apart, a drawer with no
clearance, a tray foot too big or too loose, rings in place of a helix, a
thread sized for a 30 mm neck, ports in the wrong end wall, and holes the
size of the bolt.

In those fixtures, `twisted-vase` takes the height axis as the size nearest
120 mm, the wall as ring area over mean perimeter in cuts from 30% to 80% up,
and the twist from `turnOf` on the outer loops of cuts from 2% to 98%, scaled
to the full height (80 to 100 degrees). `spur-gears` counts teeth as `lobes`
on each body's cut across its thinnest size, takes the module from the tip
diameters' difference over 20 (so any addendum both gears share passes, from
0.5 to 1.5 module), and, when the gears are engaged (centres closer than the
tip radii's sum), wants the centre distance within 5% of 30 module and no
overlap; a pair laid out apart passes. `drawer` finds the slide axis as one
whose middle cut is two of 100, 80 and 50 less 0.3 to 1.2 mm each (0.5 mm a
side, or 0.5 mm in all), a handle as a cut past one end under half the
cross-section or a 100 mm² notch in the front wall, and an open top as a
middle hole covered on one side only. `stacking-trays` wants `nesting` at
least 1 mm deep with 0 to 1 mm of play, either tray into the other along any
axis. `bottle-cap` takes the cap's axis from a round ring at mid-height, the
thread from the longest run of cuts whose hole reaches in and out by 0.4 mm,
its crest and root diameters (medians, 24.8 to 27.2 mm and 27.3 to 30.5 mm
for a PCO neck with a 27.4 mm thread), and a helix from `turnOf` on those
holes: at least 180 degrees, 80% of steps one way, 45 to 200 degrees per mm.
`pi-enclosure` finds four post-sized islands in one cut whose six distances
match 49, 49, 58, 58 and the diagonals (1 mm, 1.5 mm on diagonals), places
the 85 x 56 board on them with its ports toward either short end, wants a
placement inside the smallest hole around the posts (0.3 mm tolerance, the
hole at least 0.5 mm larger than the board), and 150 mm² missing from a cut
through that end's wall past the cavity. `bracket-m5` wants every hole up to
15 mm across, narrowest over the cuts through it, 5.15 to 6.1 mm (an inscribed
5.3 mm polygon reads 5.2), at least two holes, and the height 60 mm or less.

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
`EVAL_MODELS` × style in `EVAL_APIS` pair: every pair is its own lane, all
running concurrently. Provider keys come from the job user's
`$HOME/.config/jscad-chat/keys.json` (for the `s-ci` host user under the
`/data/crt` layout, `/data/ci/.config/jscad-chat/keys.json`, mode 600), placed
there by hand; a model whose provider has no key there fails on its own. The job runs
`scripts/eval-sandbox-setup.sh --check` first and fails when the host has no
crt, no rootfs or no cgroup delegation for the memory limit; host setup is in
`ci/README.md`. Results land in the job's
`eval-results/`; fetch them into `$JSCAD_CHAT_DATA/results` with
`node eval/fetch-ci-results.js JOB-ID`. Details: `ci/README.md`.
Files fetched before simple-ci served artifacts as UTF-8 hold mojibake
(`→` as `â\u0086\u0092`); `node eval/fix-mojibake.js PATH...` repairs them in
place and leaves clean files alone.

## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and decide in step 6 of that skill, from each fixture's comparison against
the previous run and the transcripts behind any change, whether to keep,
revert or revise it.
