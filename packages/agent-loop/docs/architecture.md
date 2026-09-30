# @jscadui/agent-loop architecture

## Modules

- `src/`: what the app ships, chiefly `loop.js` (`runTurn`), `providers.js` and
  `responses.js` (the provider adapters and their stream parsers), `tools.js`
  (`buildTools(api)`), `prompt.js` (`buildSystemPrompt(api)`), `context.js`
  (`buildMessages`), `project.js` (the file tools' operations and entry
  resolution), `buildReport.js` (the build report), `docs.js` (`docsTool`),
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
present. A 4xx auth or invalid-request error never retries. Retrying happens
only before the response body starts streaming, so a retry can never duplicate
output already sent to the caller — an error surfacing while `parseXStream` is
reading the SSE body ends the call immediately, retried or not. Each retry
yields a `{type: 'retry', attempt, maxAttempts, status, reason, delayMs}` event
into the provider's stream, the same way a `usage` event rides alongside
`text`/`tool_use`/`done`; `runTurn` (`loop.js`) ignores event types it doesn't
know, so the app sees nothing beyond the eventual success or the final error.
The eval's `withTurnCap` (`eval/run-eval.js`) counts these into
`metrics.providerRetries` and logs one live-log line per retry
([user-manual.md](user-manual.md#metrics)).

## Tool protocol

All model interaction is a tool call (`list`, `read`, `write`, `edit`, `run`,
`measure`, `check`, `export`, `docs`, and the app's `view`): `runTurn` streams
`text` events as chat prose and never parses them for code, so model source
travels only in a `tool_use` input (`write.content`, `edit.newString`,
`run.source`). No markdown-fence extractor exists anywhere in the app or the
eval, and none is wanted — a model that wants to run code has to call a tool.

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
project, with no separate save step. The build runs the entry, resolved as
Node does (`resolveEntry`): `package.json` `main` (also as `<main>.js` or
`<main>/index.js`), else `index.js`, else `main.js`. Model code stays CommonJS
with `module.exports = { main }`. The result is the build report
(`src/buildReport.js` `buildReport`, the same shape in the app and the eval):

```
{ ok, entry, error?: { name, message, file, line, column },
  warnings, console, params: [{ name, type, default, min?, max?, step?, values? }],
  geometry?: { parts, boundingBox, dimensions, volume, watertight } }
```

`geometry` comes only with a build that succeeds, from model-tools' `measure`
and `check` on what `main()` returned, rounded to 1e-4 mm. `errorLocation`
finds `file`, `line` and `column` (1-based) in a Babel error's `loc` or the
first `<base><path>:<line>:<column>` frame of a stack. `measure`, `check` and
`export` work on the last build and fail with `NoGeometryError`
(`noGeometryError`) when it failed.
`run` is a scratch runner: the snippet runs beside the project's files as
`__run__.js` and is never saved, and neither the project nor its build
changes; it answers its console output, a `geometry` summary of what its
`main()` returned or a `returned` preview of `module.exports`
(`summarizeRun`), and an error with its location. The app's frame worker
answers `run` through the same `summarizeRun` and the same messages.

The per-turn header (`buildMessages`) sends the project files and then the
project's last build report, so each turn starts knowing whether the project
builds and what it produces, including breakage from the user's own editor
changes. The files and the report sit outside the 24,000-character history
budget.

## Model code in the eval

The eval runs model code through `@jscadui/require` with the compute frame's
transform rule and CDN URL scheme; `https://cdn.jsdelivr.net/npm/<pkg>`
maps to the package in local `node_modules`, and a package that is not
installed fails with the frame's `failed to load module <name>` /
`file not found <url>` text. Node built-ins (`fs`, `child_process`, `process`,
any name `isBuiltin` accepts) fail the same way, since the browser has none.
`@jscadui/jscad-text`, ESM-only, which Node's `require` cannot resolve, is
imported by `eval/backend.js` and handed over as a plain copy of its exports,
as the frame's `bundle.jscad_text.js` hands them. The frame loads the static
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
empty `subtract` or `intersect` result after it. `EXTRA_SPECS` and
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

When model code ends the executor (`process.exit`, an out of memory kill, a
tool call running past 110 s), `eval/sandboxed-backend.js` starts a fresh one
holding the fixture's files and every write and edit so far (applied with the
same `src/project.js` operations the executor uses), without building them,
since that build could end it again, and the model gets
`{ ok: false, error: { name: "EvaluatorCrashed", message } }` and can go on;
the call counts as a failed call. After three restarts in a run every further
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
