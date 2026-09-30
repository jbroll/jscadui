# @jscadui/agent-loop architecture

## Modules

- `src/`: what the app ships, chiefly `loop.js` (`runTurn`), `providers.js` and
  `responses.js` (the provider adapters and their stream parsers), `tools.js`
  (`buildTools(api)`), `prompt.js` (`buildSystemPrompt(api)`), `context.js`
  (`buildMessages`), `project.js` (the file tools' operations and entry
  resolution), `projectUrl.js` (`PROJECT_BASE`, `RUN_FILE` and the loader's
  `createReadFile`), `dispatchTool.js` (tool routing), `buildReport.js` (the
  build report), `modelError.js` (`reportError`), `docs.js` (`docsTool`),
  `optionChecks.js` and `hints.js` (option warnings and error hints),
  `consoleCapture.js`.
- `api/`: the generated API index and option table, and their generator,
  which also writes the prompt's API reference sheets (`api/sheet.js`).
- `prompt.md`, `prompt/`: the system prompt prose, API reference sheets and
  examples ([development.md](development.md#system-prompt)).
- `log/`: the chat log reader and the data-dir lookup (`log-dir.js`).
- `eval/`: the live eval. Not shipped.

## Providers

`fetchWithRetry` in `providers.js` wraps the initial request for the Anthropic,
OpenAI chat-completions and Responses adapters alike: on a 429/5xx status, a
provider error code meaning overloaded or rate-limited (`service_overloaded`,
`overloaded_error`, `rate_limit_exceeded`, and similar), or a network error
(fetch rejecting), it retries up to 4 attempts total with backoff around 2s,
5s, 12s (jittered +/-20%, capped at 30s), honoring a `Retry-After` header when
present. A 4xx auth or invalid-request error never retries.

`streamWithRetry` wraps `fetchWithRetry` and the adapter's `parseXStream`, and
also retries a body that fails mid-stream with a network error: undici's
`TypeError: terminated` when the socket closes (Muse on the Responses API cuts
streams off this way, sometimes near 300 s), a connection reset, or a
browser's body-stream `TypeError`. It requests the whole call again only when
no `text` or `tool_use` event has reached the caller yet; metadata such as
`response.created`, `message_start` or a `usage` event does not count, and the
parsers yield a tool call only once its arguments are complete. Both kinds of
retry share the 4-attempt budget and backoff. A stream that fails after
content was yielded is not retried: the app has already appended that text
to the chat bubble and the eval to its live log, and neither can take it
back, so a second attempt would show the reply twice. It ends the call with
`<adapter>: stream terminated after the reply began (<cause>)`, and an
exhausted budget with `<adapter>: stream terminated before content on all 4
attempts (<cause>)`. An error event the provider sends inside the stream
(`error`, `response.failed`) is never retried. Each retry
yields a `{type: 'retry', attempt, maxAttempts, status, reason, delayMs}` event
(for a cut stream `status` is `null` and `reason` is
`stream terminated before content (<cause>)`)
into the provider's stream, the same way a `usage` event rides alongside
`text`/`tool_use`/`done`. A retry is yielded when it happens, before its
backoff sleep, not after the retried request answers. `runTurn` (`loop.js`)
reports it through `onStatus` as `{phase: 'retry', attempt, maxAttempts}`,
`attempt` being the one about to start, and ignores event types it doesn't
know. The eval's `withTurnCap` (`eval/run-eval.js`) counts these into
`metrics.providerRetries` and logs one live-log line per retry
([user-manual.md](user-manual.md#metrics)).

The parsers also yield `{type: 'reasoning', text}` for reasoning the provider
streams: Anthropic's `thinking_delta`, a chat-completions delta's
`reasoning_content` or `reasoning`, and the Responses API's
`response.reasoning_summary_text.delta` and `response.reasoning_text.delta`.
It is no content: it neither blocks a stream retry nor counts as a reply.
`runTurn` adds up its characters for `onStatus` and hands each delta to
`onReasoning`, but never puts it in the messages it returns, so no adapter
sends it back; token counts come only in the `usage` event at the end of a
stream.

OpenAI-style Responses endpoints stream reasoning only as a summary, and only
when asked, so the Responses adapter sends `reasoning: { effort, summary:
'auto' }` whenever an effort is set (no `reasoning` at all without one). A
provider that refuses the field answers 400 or 422 with a body naming
`summary`; the adapter then sends the same request once more without it, and
remembers that provider (kind, URL and model) for the rest of the page
session, so later requests leave it out. Any other refusal ends the call as
before. `streamWithRetry` gives the refusal's `status` and `body` on the
Error it throws, which is what the adapter reads.

## Tool protocol

All model interaction is a tool call (`list`, `read`, `write`, `edit`, `run`,
`measure`, `check`, `export`, `docs`, and the app's `view`): `runTurn` streams
`text` events as chat prose and never parses them for code, so model source
travels only in a `tool_use` input (`write.content`, `edit.newString`,
`run.source`). No markdown-fence extractor exists anywhere in the app or the
eval, and none is wanted — a model that wants to run code has to call a tool.

The app and the eval route a call the same way, through `dispatchTool` over
their own handlers: the app's run in the page and the compute frame, the
eval's in Node. What differs between the two is only how a model runs (the
frame worker against `require` in the executor process), so each keeps its
own handlers and shares the routing, the report assembly (`assembleReport`),
the error formatting (`reportError`), the loader's `createReadFile` and the
transform rule (`@jscadui/worker/src/shouldTransform.js`).

## Project model

The model works in a JavaScript project the way a coding agent does, with
tools named and shaped like the common coding-agent ones, so models use them
without teaching. `list` gives the paths and byte sizes, `read` a file
numbered like `cat -n` (`offset`, `limit` in lines), `write` a whole file,
and `edit` one exact replacement (`oldString` must occur once unless
`replaceAll`; a missing or repeated one fails with `EditError` and changes
nothing). Paths are project-relative and cannot leave the project. The
operations live in `src/project.js`, which the eval backend and the app both
call, so both refuse the same input with the same text.

A write is a save: every `write` and `edit` stores the file and builds the
project, with no separate save step. The build runs the entry
(`resolveEntry`): `package.json` `main` (also as `<main>.js` or
`<main>/index.js`), else `index.js`, else `index.ts`, else `main.js`.
`resolveEntry` is `pickEntry` over the project's text files, the rule the
app's folder drop and its launcher share (`src/project.js`); they also pass
the folder's name, which adds `<folder>.js` and `<folder>.ts` after
`main.js`, and `anyJs`, which falls back to the shallowest `.js` by name.
The project build passes neither, so a project with only helpers has no
entry rather than running one. Model code stays CommonJS
with `module.exports = { main }`. The result is the build report
(`src/buildReport.js` `buildReport`, the same shape in the app and the eval):

```
{ ok, entry, error?: { name, message, file, line, column },
  warnings, console, params: [{ name, type, default, min?, max?, step?, values? }],
  geometry?: { parts, boundingBox, dimensions, volume, watertight, manifold,
               selfIntersecting } }
```

`geometry` comes only with a build that succeeds, from model-tools' `measure`
and `check` on what `main()` returned, rounded to 1e-4 mm. A `write` or
`edit` answers the report headed by `saved`, the file written
(`writeReport`); when the build fails it adds `note: "main.js is saved; the
build of main.js failed"`, since models read a bare `ok: false` as a lost
write and rewrote the file from scratch. A project with no entry file builds
nothing and fails nothing: `{ ok: true, entry: null, note: "no entry yet
(main.js, index.js or package.json main)" }` (`noEntryReport`), and the write
that saved a helper first says `saved; no entry yet (…)`. A model error goes
into the report through `reportError` (`src/modelError.js`): the message
capped at 4,000 characters, the frame worker's `jscadMain failed: ` prefix
and the loader note dropped, an allocation failure worded as `out of memory`,
and the error hint for the API style added. `errorLocation` then
finds `file`, `line` and `column` (1-based) in a Babel error's `loc`, the
`<base><path>: … (line:column)` that ends the first line of a Babel message
whose `loc` a wrapper dropped, or the
first `<base><path>:<line>:<column>` frame of a stack. `measure`, `check` and
`export` work on the last build and fail with `NoGeometryError`
(`noGeometryError`) when it failed.
`run` is a scratch runner: the snippet runs beside the project's files as
`__run__.js` (`RUN_FILE`) and is never saved, and neither the project nor its build
changes. A project module the snippet requires hands back its `main` wrapped
(params-core `withProjectMains`), so `main({ width: 30 })` runs as a build
would with `width` set as a user's edit and every other parameter at its
default; a model's `params.width = { type: 'slider', … }` never overwrites
the value given. It answers its console output, a `geometry` summary of what
its `main()` returned, shaped like the build report's with `watertight`,
`manifold` and `selfIntersecting` from model-tools' `check`, so a run can
test a fix for open edges, or a `returned` preview of `module.exports`
(`summarizeRun`), and an error with its location, without the loader's
` / failed loading module …` note (`withoutLoaderNote`), which builds drop
too. The app's frame worker
answers `run` through the same `summarizeRun` and the same messages.

The per-turn header (`buildMessages`) sends the project files and then the
project's last build report, so each turn starts knowing whether the project
builds and what it produces, including breakage from the user's own editor
changes. It is sent every turn, an empty project included (`The project is
empty; no build yet.`), since without it models opened most runs with a
`list` and guessed at files to read. It ends saying that every message
carries it, so `list` is rarely needed (`PROJECT_NOTE`); the `list`
description says the same, since Muse still listed a project the header had
just called empty. The files and the report sit outside the 24,000-character history
budget.

## Model code in the eval

The eval runs model code through `@jscadui/require` with the compute frame's
transform rule (`shouldTransform`, imported from `@jscadui/worker`), project
base and CDN URL scheme. Its readFile is `createReadFile` with a fetch that
maps `https://cdn.jsdelivr.net/npm/<pkg>` to the package in local
`node_modules`, and a package that is not
installed fails with the frame's `failed to load module <name>` /
`file not found <url>` text. It imports the prebuilt `esm/` bundles of
`@jscadui/require` and `@jscadui/transform-babel`, since their sources use
extensionless relative imports that Node's ESM loader refuses, so a change to
either needs its `npm run build` before `npm run eval` sees it. Node built-ins (`fs`, `child_process`, `process`,
any name `isBuiltin` accepts) fail the same way, since the browser has none.
`@jscadui/jscad-text`, ESM-only, which Node's `require` cannot resolve, is
imported by `eval/backend.js` and handed over as a plain copy of its exports,
as the frame's `bundle.jscad_text.js` hands them. It is one module for every
run, so each build and each `run` starts with its `reset()`, as each frame
load does: an `init` a snippet made never reaches a later build. Model code's
first require of it in a run then initialises it with Node's own
`@jscad/modeling` (not the option-checked copy, whose warnings would name
jscad-text's internal calls), as the frame sets it up with the engine's, so
`text2d` needs no `init` and a model's own `init` changes nothing it would
notice. The frame loads the static
font map's fonts from jsDelivr URLs of pinned `@typopro/dtp-*` npm packages;
the backend registers the same files from `node_modules`
(`registerInstalledFonts`, a devDependency of this package), inside the
sandbox's read-only binds, and refuses to start when one is missing. A font
URL outside the map fails, since the eval has no network.
`@jbroll/jscad-anchors` (not installed) fails here though the app serves it.

The CDN stub hands model code a copy of `@jscad/modeling` and
`@jbroll/jscad-fluent` with the option checks (`src/optionChecks.js`,
`api/optionTable.js`), so build reports and `run` results carry the same
warnings as the app's. Node's modeling module object is never changed:
fluent and model-tools require the same one.

Builds and `run` capture the model run's console calls with
`src/consoleCapture.js`. The frame worker captures the same way for the app
(`apps/jscad-web/src_frame/consoleCapture.js`), always forwarding to the real
console too so the editor's own runs still log to devtools; a grid run
concatenates every member's console lines in member order under the same cap.

Fluent class methods that take options (`.extrudeLinear({...})`) or an angle
(`.rotateX`) are checked by wrapping them once on Node's fluent prototypes,
since fluent exports no classes; that reaches fluent's own calls too, which is
safe because fluent never calls those methods itself and passes modeling only
valid options.
`eval/fluent-guard.test.js` runs every fluent example in the repo with the
wraps on and fails on any warning.

Some checks come from no option table: clockwise points where a 2D outline
enters (`primitives.polygon`, `geometries.geom2.fromPoints`, `jf.polygon`),
which the check reverses when they form one flat outline, since no request
wants an inside-out extrusion (a list of paths may hold a hole wound
clockwise on purpose, and an explicit `orientation: 'clockwise'` is the
caller's choice, so both are left as given),
and the booleans (`booleans.*`, `jf.*`, the `FluentGeom3` and `FluentGeom2`
methods), which report `{ points, faces }` operands before the call and an
empty `subtract` or `intersect` result after it, and the `fix` specs of the
rounded primitives and `cylinderElliptic`, which change the arguments before
the call: a `roundRadius` past the limit modeling throws at becomes the
largest value in thousandths it accepts, and a number radius becomes
`[r, r]`, since each slip was the most common failed build with one sensible
reading and cost a round every time. `EXTRA_SPECS` and
`EXTRA_METHOD_SPECS` in `src/optionChecks.js` add them to the table's specs,
keyed by the table's prefix. The empty check asks a shape's `isEmpty()` first,
because a manifold shape converts its polygons only when they are read.

The prototypes outlive any one copy of `src/optionChecks.js`: the app's frame
bundles its own, and a test file's fresh import makes another. So the state
the wraps depend on is global. Each wrapped method carries
`Symbol.for('jscadui.optionChecks.wrapped')`, which stops a second copy from
wrapping it again. The wraps report to
`globalThis[Symbol.for('jscadui.optionChecks.methodWarn')]`, which each
`wrapFluentMethods` call sets through `setMethodWarn` to its own collector,
so a method wrapped by one copy reports to the collector of the run that
wrapped last.

## API index

`api/index.json` describes the public API of `@jscad/modeling`, from the
pinned checkout's JSDoc (every namespace, with `maths` and `geometries` last
so a bare name reaches the operation before the helper; `maths.constants`
lists its values), `@jbroll/jscad-fluent`, from its installed `dist/*.d.ts`, and
`@jscadui/jscad-text`, from its JSDoc. It has one entry per namespace, class
or function: `name` (`primitives.roundedCuboid`, `jf.cube`,
`FluentGeom2.extrudeLinear`, `jscadText.text2d`), `pkg`, `kind`, `signature`,
`description`, `example`, `params` (the positional parameters' name, type and
JSDoc text, left out for `maths`, where nearly all are `out`), and for a
function that takes an options object first, `optionsFirst` and `options`
(name, type, default, description). A
fluent entry whose options are a modeling function's names it in `sameAs`
instead of copying them, and the fluent array classes name their base class
in `extends`. A fluent class method takes its description, example and (with
no modeling counterpart, as `appendArc`) its options from its own JSDoc in
the `.d.ts`, and falls back to the summary of its type's `geometries`
function (`FluentGeom3.toPolygons` from `geometries.geom3.toPolygons`), then
the same-named modeling function's. `jf.maths.vec3` and its siblings are
namespaces with `sameAs: 'maths.vec3'` and no members of their own.

`api/optionTable.js` holds what the option checks need, leaving out `maths`
and `geometries`:
`options` for functions reached from the exports (`primitives.roundedCuboid`,
`cube` for `jf.cube`) and `methods` for the fluent class methods whose first
parameter is an options object, keyed by class (`FluentGeom2.extrudeLinear`);
`types` and `methodTypes` with each option's JSDoc type reduced to `number` or
`array` (other types are not checked); and `angles` and `methodAngles`, every
function or method whose first parameter is named `angle` or `angles`
(`transforms.rotateX`, `FluentGeom3.rotate`). All of it comes from the index,
so a new fluent method gets the checks on regeneration
([development.md](development.md#api-index)).

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

## Complex grading

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

### Rendering

Rendering needs WebGL, which the crt sandbox does not have and should not get,
so `eval/render.js` draws in the `run-eval` process, in Playwright's bundled
chromium on SwiftShader (`--use-gl=angle --use-angle=swiftshader`). With the
hardware default, a host with no display (the CI host) fails GPU process
startup, and the WebGL context the page created meanwhile is lost: the first
models rendered as an empty canvas and then a broken-image icon. SwiftShader
also makes a render the same on every host. The page, `eval/render/page.html`,
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

## Sandbox

The conversation loop and the provider calls run in the `run-eval` process,
which holds the key. Model code runs in executor processes
(`eval/executor-child.js`, started by `eval/sandbox.js` `startExecutor`) that
never receive the key or the parent's environment: every tool call (`list`,
`read`, `write`, `edit`, `run`, `measure`, `check`, `export`, `docs`), the
first reset that builds the fixture's files for the header, and every grade
goes to one as a request and comes back as a reply
(`eval/executor-protocol.js`), in length-prefixed JSON frames (`eval/frames.js`)
on a socket at the executor's fd 3. The parent refuses a frame over 1.06 MB
from its 4-byte header, before reading its body, and kills the executor, so
model code cannot make `run-eval` buffer more than that of one message. The
parent expects one `ready` and one reply per outstanding call; the first frame
that answers no request (model code writing to the channel) kills the executor,
which is then handled as a crash. Each conversation gets its own executor, since
the backend keeps module-level and `globalThis` state, and each grade runs in
another fresh one, so nothing model code left behind in the conversation's
executor reaches the grade.

Model code shares the executor's process and can send replies of its own, so
the parent trusts no reply's shape. A tool result must be a string of at most
256 KB, else the model gets an `EvaluatorError` or `ToolResultTooLarge` tool
error; an error reply becomes an `EvaluatorError` tool result capped at 4,000
characters; a grade must be plain JSON data shaped `{ measure, solid, params, probe? }`
under 1 MB (a `probe` that is not an object becomes `null`), else it grades nothing, and so does one the fixture's checks or
`geometryError` cannot read (a grade model code shaped): the transcript and
first-attempt failures are kept, and `--regrade` goes on. `providerError` is
set only by the
provider wrapper in `run-eval`, never from a tool result's text. Model code can
still answer its own tool calls, and can lie about the geometry of the grade
it is being measured in, since measuring runs beside it; a fresh executor per
grade stops it carrying anything over from the conversation or another run.

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

When model code ends the executor (`process.exit`, an out of memory kill, a
tool call running past 110 s), `eval/sandboxed-backend.js` starts a fresh one
holding the fixture's files and every write and edit so far (applied with the
same `src/project.js` operations the executor uses), without building them,
since that build could end it again, and the model gets
`{ ok: false, error: { name: "EvaluatorCrashed", message } }` and can go on;
the call counts as a failed call. Its message names the exit (`code 3`,
`ran past 110 s`), or `out of memory` for a V8 heap exit, whose heap log
tells the model nothing (`memoryMessage` in `src/buildReport.js`, which also
rewords an in-process allocation failure in the eval and the app alike). A
`run` gets 30 s (`RUN_TOOL_TIMEOUT_MS`, the frame's limit for a scratch run
too); past it the executor is replaced the same way, but the project is
built again, since the snippet never touched it and the app's frame reloads
the model, and the run answers `run stopped after 30 s; try a smaller case`.
After three restarts in a run every further
call gets `EvaluatorCrashed` and the run records `error: "model code ended the
evaluator 4 times"`, transcript kept. An executor that dies during the grade
grades nothing, scored as the model's failure. An executor that never becomes
ready (crt cannot start it, at the start, on a restart or for the grade) is
an infrastructure failure: the run gets `infraError: true` and, like a
`providerError` run, stays out of the means. `--regrade` grades each stored
run in its own executor, so a stored model that ends it grades nothing and the
file is still written.

The executor is `crt run` with `--net none --no-home --tmp private
--clean-env --ro-root`, a memory limit, `--keep-fd 3` for the channel, and
read-only binds,
at their host paths so absolute symlinks resolve, of `packages/`,
`node_modules/`, `.deps-cache/` and their symlink targets (in a linked worktree
also the targets of each package's linked `node_modules` and the main
checkout's `node_modules`). Nothing else of the host is in its mount tree:
not `$HOME`, not `~/.config`, not the repo's `apps/` (a `node_modules`
workspace link into `apps/` dangles), not the host `/tmp`. Inside, the rootfs's
`timeout --foreground -s KILL <lifetime>` runs node, so an executor ends by
itself even when `run-eval` is SIGKILLed and cannot kill it (lifetime: the run
limit plus 60 s for a conversation, the grade timeout plus 60 s for a grade).
Node runs with `--max-old-space-size` at three quarters of the memory limit
and under its permission model, reading only those binds, with no writes,
processes, worker threads or addons. A path that climbs out of a granted dir
through a symlink and `..`, which the permission model lets by, finds nothing
there. The environment inside is `PATH` and `HOME=/tmp`; crt itself gets only
a fixed `PATH` and `CRT_HOME`. Code-level blocks sit in front of that: the CDN
stub serves no built-ins, and a resolve hook in the executor refuses every
dynamic `import()` from model code with `failed to load module <name>`.

`ci/jscad-eval.crt` is a Void rootfs with the `nodejs` package (Node 24.18 as
of this writing), stored `root ro`. It needs a crt that keeps stored configs
outside the rootfs (`$CRT_HOME/.config/<name>`), marks a rootfs pristine at
create, and creates Void rootfs with the host's xbps keys (crt main, cff62c5 or
later). That crt reads a rootfs's config only from `$CRT_HOME/.config/<name>`,
moving a legacy `$CRT_HOME/<name>/config` there when it is absent; an older crt
reads the legacy file. crt merges a config's `mount` and `env` lines into every
run, so the eval refuses to start unless `.config/<name>` equals
`ci/jscad-eval.crt` byte for byte and no legacy `config` exists in the rootfs;
the tracked file itself has no `mount`, `env` or `keep-fd` line (a test checks).
A change to the tracked file means recreating the rootfs. Setup is in
[user-manual.md](user-manual.md#sandbox-setup).

`EVAL_SANDBOX_MEMORY` takes crt's grammar exactly: digits with an optional
`K`, `M` or `G` (a bare number is bytes), at least 512M. At startup a probe
container runs under that limit and reports its own cgroup; `run-eval` reads
that cgroup's `memory.max` on the host and counts the limit in force only when
it is a number no larger than the one asked for, whatever crt printed. Without
`sudo crt setup` it is not: `run-eval` prints a loud warning and goes on, and
`ci/eval` (`EVAL_REQUIRE_MEMORY_LIMIT=1`) refuses to start. crt sets
`memory.max` only, not `memory.swap.max`, so on a host with swap the limit
bounds resident memory. With it, the limit covers everything the executor's cgroup
is charged for, including tmpfs pages (`/tmp`, `/dev/shm`), which cgroup v2
charges to the writer's memory; the permission model already denies writes
there. `run-eval` also lowers `EVAL_CONCURRENCY` so that executors × memory
limit × `EVAL_PROCESSES` fit in three quarters of the host's memory, and says
so when it does.

The rootfs is part of the trusted base: the `node`, `timeout` and `setpriv`
inside it run before and around the sandboxed code. The eval and the setup
script only ever run it with `--ro-root`, and the setup script creates it when
absent and otherwise only checks it. crt refuses hardened runs of a rootfs
that `crt create` did not mark pristine, or that has run writable since.
Never run it writable (`crt run` or `crt enter`
without `--ro-root`, or installing into it); to change it, remove it
(`crt rm jscad-eval`) and recreate it with the setup script.

A grade the executor has not answered 10 s past its own timeout (model code
stuck in a synchronous loop never lets the executor's timer fire) kills the
executor's process group, which takes the whole container with it, and grades
nothing.
