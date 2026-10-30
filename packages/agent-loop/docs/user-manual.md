# @jscadui/agent-loop user manual

## API style

The chat teaches exactly one modeling API, set by `api`: `'fluent'`
(`@jbroll/jscad-fluent`, the default, `DEFAULT_API`) or `'modeling'`
(`@jscad/modeling`). `@jscadui/jscad-text` is part of both. The setting picks
the system prompt (`buildSystemPrompt(api)`), the tool list
(`buildTools(api)`, via `runTurn({ api })`; only the `docs` description
differs) and the entries `docs` answers from (`docsTool(index, query, { api })`).
Apart from `.scad` parts (below), it does not change the runtime: model code
may still require either package.
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

Under `'fluent'`, a project file that requires a `.scad` file gets a copy of
its exports whose modules and functions return fluent shapes: a 3D result is a
`jf.FluentGeom3`, a 2D one a `jf.FluentGeom2`, a same-dimension list is a
`jf.FluentGeom3Array`/`jf.FluentGeom2Array`, and any other list is mapped item
by item, so `require('BOSL2/ball_bearings.scad').ball_bearing('608').translate([0, 0, 5])`
chains. Other results (a number, `undefined`), variables, `main`, `fn`, `vars`
and `$meta` are unchanged. Under `'modeling'` the exports are the plain
transpiled ones, and a `.scad` file that requires another gets them plain in
either style. `createScadExportsWrapper({ getApi, getFluent })` in
`src/scadFluent.js` builds the wrapper; the frame worker and the eval register
it with `@jscadui/require`'s `setScadExportsWrapper` and read the style from
the run's warning collector (`getApi()`).

## Conversation context

```js
buildMessages({ systemPrompt, transcript, files, build, message, images = [], budget = CONTEXT_BUDGET, projectBudget = PROJECT_BUDGET, summary = '' })
```

Returns the system prompt, the summary of earlier turns when given, the
newest whole prior turns that fit in `budget` characters (24,000 by default), a user message with the text files in
`files` under `### <path>` followed by `build`, the project's last build
report, under `Last build of the project:` (both outside the history budget),
and the new message. The files have their own `projectBudget` (24,000 by
default); when they exceed it the oldest-mentioned go first, ranked by the
paths in the transcript's `mentions` (or `toolCalls[].input.path`), and binary
files are skipped. The
project message is always sent: an empty project with no build, or one whose
files are all blank (a new project's empty `main.js`, whatever its build
said), is `The project is empty; no build yet.`, and a missing part says
`The project has no files.` or `The project has not been built yet.`, so the
model needs no `glob` to learn the project's state. Every header ends with
`PROJECT_NOTE`: "Every message comes with this note on the project: its text
files and its last build, so glob is rarely needed." The app and the eval both
use it.

`partitionTranscript(transcript, budget)` splits the transcript into whole
turns that fit the budget (`kept`) and the older ones (`evicted`); it is what
`buildMessages` keeps on. Before a turn is evicted, the oldest tool results
are pruned to `[Old tool result content cleared]` (their `tool_use` record
stays), oldest first, keeping the newest three full; only then do whole turns
go. Pruning copies the messages, never mutating the transcript. `summary` is a user message,
`Summary of earlier work in this chat:` followed by the summary text, sent
directly after the system prompt. The chat builds it from the evicted turns
with `summarize.js`: `buildSummaryPrompt(turns, priorSummary)` renders each
turn as `User:`/`Assistant:` lines with its tool calls and the files its
`mentions` touched (each message cut at `MAX_SUMMARY_CHARS`, 2,000
characters), `summarizeTranscript({ turns, priorSummary }, callModel)` folds
them into the running summary through an injected model call, and
`summarizeWithProvider(provider)` adapts a provider to that call. The summary
persists in the stored transcript as a `{ role: 'system', text, basis }`
message (`basis` counts the leading messages already folded in), so a resumed
chat keeps summarizing where it left off; a summarizer failure leaves the
transcript to plain truncation, as before.

### Images

A user message may carry `images: [{ mime, dataUrl, width?, height? }]`
beside its `content`, the shape a `view` tool message uses; `buildMessages`
puts its `images` argument on the new message. A message without images, or
with an empty list, goes out exactly as before: plain string content on every
wire. Each adapter sends a user message's images as that provider's parts:

| Wire | User message content |
|---|---|
| Anthropic messages | `image` blocks (`source: { type: 'base64', media_type, data }`) and then the `text` block |
| Chat completions | a `text` part and then `image_url` parts (`image_url: { url: dataUrl }`) |
| Responses | an `input_text` part and then `input_image` parts (`image_url: dataUrl`) |

An images-only message (empty `content`) sends no text part, since Anthropic
refuses an empty text block. Images never count toward the character budgets.
`buildMessages` runs `pruneUserImages` (`src/userImages.js`) over the kept
history and the new message: only the newest user message with images keeps
them, and only while it is one of the last `USER_IMAGE_TURNS` (3) user
messages, the new one included. Every other image becomes a line in its
message's text, `[earlier image, no longer attached: image/jpeg, 1200x900]`
(`imageNote`), so the model knows one was there; an images-only message
becomes just those lines. An image without a `dataUrl` (one a caller stored
without its bytes) is always a note. The summary prompt names a summarized
message's images as `[image: image/jpeg, 1200x900]` (`imageLabel`).

In a turn, `runTurn` keeps the caller's user images untouched, and only the
newest `view` result keeps its renders. `MAX_VIEW_IMAGE_CHARS` (700,000) bounds
the image data URLs one request carries: the user images in the conversation
come first, and a view's renders get what they leave, oldest dropped first,
the newest always kept.

`createProvider({ maxBodyBytes })` refuses a request body larger than that
many bytes before posting it, with `RequestTooLargeError` (`bytes`, `limit`,
and the message `the request is N bytes, over the L-byte limit; send fewer or
smaller images, or start a new chat`). The app sets it to the relay's 1 MB
when it goes through the relay; without it nothing is checked.

### Model spec

`notes/model-spec.md` is the project's durable instructions: design intent,
units, printer, fits and clearances, style and conventions. The agent creates
it from the first spec-worthy instruction and merges later corrections into it
with `write`/`edit` (a `read` first only when the inlined copy is truncated),
one line per rule under `Intent`,
`Constraints & preferences`, `Decisions` (newest wins, retractions delete the
line). The whole file inlines in every project message under `Model spec:`
(4,000 characters; over that the newest lines survive with a `[truncated]`
note), ahead of code files when the project budget binds, so every turn and
every chat knows it without a `read` call. One-off sizes and turn-local
choices stay out. The user can edit the file directly; the agent merges
minimally around hand-edits and never re-imposes the section schema.
Deleting the file resets the memory.

`runTurn` caps each tool result it hands the provider at `TOOL_RESULT_CHARS`
(the same 24,000 characters) and ends a longer one with `… [tool result
truncated: N of M characters shown]`, in the app and the eval alike, so a few
oversized results (model code answering its own calls) cannot
overflow the provider's context. Past `TOOL_RESULTS_PER_TURN_CHARS` (120,000
characters) of results in one turn (an eval run is one turn), each further
result is replaced by `[tool result omitted: this turn's tool results passed
120000 characters]` and the turn goes on. A turn that rejects carries the
messages so far as `error.messages`. A provider round with neither text nor a
tool call (only reasoning, or a stop at the length limit) is sent once more
unchanged, uncounted against `maxRounds`, unless it stopped at the length
limit (`length`, `max_tokens`); a second such round in a row rejects the turn
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
object: {"parts":…' } }`, which the transcript keeps. A tool call that has not
answered after `toolTimeoutMs` (120,000 ms by default) rejects the turn with
`ToolTimeoutError`. Calls in `AWAITS_USER` (`question`) have no time limit,
since they wait on the user, and end only with an answer or an abort through
`signal`.

### Printability skills

`prompt/skills/` holds 9 design-for-printing skills the loop loads through
the `skill` tool, on top of the 5 starter skills: `fit-clearance` (ladders,
compensation, coupon-first — load before any mating parts),
`printability-design`, `box-lid`, `snap-fit`, `boss-insert-thread`,
`gears-meshing`, `pip-hinge`, `dovetail-slider`, `living-hinge`. Each states
its numbers and a small test coupon first; printer operation (bed, temps,
flow, slicer tuning) is explicitly out. Bodies stay under 250 words and
`SKILL_BUDGET` (2000 chars) so nothing truncates on load
(`test/skills-content.test.js`).

## Turn status

```js
runTurn({ conversation, provider, requestTool, onText, onReasoning, onUsage, onStatus, beforeToolCall, afterToolCall, signal, toolTimeoutMs, maxRounds, capFinalAnswer, toolChoice, api })
```

`runTurn` makes one provider request per round and repeats while the reply
carries tool calls. It stops after `maxRounds` requests (`DEFAULT_MAX_ROUNDS`,
32, by default) and resolves `{ messages, rounds, stopped }`, with `stopped:
'max_rounds'` on a capped turn so the caller can tell it from an answered
one. At the cap it asks once more with tools off (`toolChoice: 'none'`) and
keeps the answer as the turn's last message, so a capped turn still answers
instead of stopping silent; an empty or failed answer resolves without one.
`capFinalAnswer: false` skips that call (the eval does, since it counts every
send as a round). A turn whose model repeats one (tool, arguments) a third
time (`DOOM_LOOP_THRESHOLD`, 3) stops instead with `stopped: 'doom_loop'`: the
repeat is answered `DoomLoopError` and never runs. The eval passes each
fixture's `maxTurns` as `maxRounds`.

`onText(delta)` hears each chunk of reply text, `onReasoning(delta)` each
chunk of reasoning the provider streams, and `onUsage(usage)` each usage
report (`inputTokens`, `outputTokens`, `reasoningTokens`), in the order they arrive. Reasoning
and usage never enter the returned messages, so neither is sent back to the model.
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
| `{ phase: 'usage', inputTokens, outputTokens, reasoningTokens }` | the provider reports use |
| `{ phase: 'done' }` | the turn has ended, resolved or rejected; a capped turn carries `stopped: 'max_rounds'`, a triple repeat `stopped: 'doom_loop'` |

A call whose arguments are not JSON reports no `tool` phase, since it does not
run. Read-only tools (`glob`, `read`, `grep`, `measure`, `check`, `docs`, `execute`,
`question`, `websearch`,
`view`; `READ_ONLY` in `src/tools.js`) run concurrently and the saving tools
(`write`, `edit`, `delete`, `export`) serially after them, so one round's
`tool` phases all arrive before any of its results; every result is committed
in the order the model called it. An `onStatus` that throws does not end the
turn. `beforeToolCall(name, input)` runs before each call and may deny it
(`{ decision: 'deny', reason? }`, answered `DeniedError`) or rewrite its
arguments (`{ updatedInput }`); `afterToolCall(name, input, result)` runs
after and may replace the result (`{ result }` or a string). A throwing hook
becomes a tool error. `toolFilter(name)`, when given, hides tools from the
offered set before the turn starts (the app uses it to remove `websearch`
when the user pins search off). Denials, rewrites and hook failures are results the
model sees, never turn failures, so side-effecting calls can be gated without
touching the loop. The app's chat draws its
status line and Stop button from it
(`apps/jscad-web/docs/architecture.md`, Chat UI states); the eval leaves it
out. Aborting `signal` rejects the turn with `AbortError`.

## docs tool

`docs({ query })` answers from the API index (`api/index.json`, see
[architecture.md](architecture.md#api-index)) with
`docsTool(index, query, { api })` (`src/docs.js`), the same pure function in
the page and in the eval. The app's menu API Help… panel calls it too, for a
user's own lookups in the chat's current API style. It searches only the
chosen API's entries plus
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
read back (`params.lid.height`), and hidden names. `reference`,
`interference`, `overlap` or `overlaps` answers in both APIs with
`REFERENCE_ANSWER`: separate parts must not share volume and fail the build
with `InterferenceError`, there is no allowance for press fits, the two tag
forms (`part.reference = 'M3 screw'` and `{ reason, allow }`), that `allow`
exempts only overlaps between the reference part and the parts it names, that
an `allow` entry naming no part that shares volume with the reference part is
a `PartTagError`, that each part has one color and parts may touch, that a
detail in another color is its own part subtracted from the part around it,
that pieces of one color are unioned and then colored, that the tag is set last on the object
`main()` returns (one on a nested object or on an object transformed after the
tag is set is lost), `PartTagError` for a malformed tag, and that every build
report lists the allowed overlaps under `references`. `jf.cylinder`'s `outer` has
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

A catalog part's family or call name (`nut`, `NEMA`), matched
case-insensitively, answers every library's entry for it, the one marked
`preferred` first; an entry's own name (`parts.nopscadlib.nut`) answers just
that one. Each (`renderPart` in `src/docs.js`) gives its license, `require`
and `include` lines, signature, sizes, options, measured dimensions and
example. The entries come from `api/parts.json`, appended to the index by
`buildIndex` and generated, with the `## Parts` prompt block, by
`packages/parts/bin/build.js` from the admitted catalog.

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
| `jf.polygon` given modeling's `{ points }` options object instead of the points array, with no other option: the check passes `points` itself before the call | `{ fn, option: 'points', hint }`: "jf.polygon takes the points array itself, jf.polygon([[x, y], ...]); used the object's points" |
| a 2D shape turned about X or Y by anything but a multiple of π: `rotateX`, `rotateY` or `rotate` on a `FluentGeom2`, or `transforms.rotateX`, `rotateY` or `rotate` given a 2D shape. The shape stays in the XY plane, squashed to its shadow, and a quarter turn leaves a line | `{ fn, option: 'angle', hint }`: "rotateX only squashes a 2D shape, which stays flat in the XY plane; extrude it first and rotate the 3D shape: shape.extrudeLinear({ height }).rotateX(...)" |

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
word (`cube`, `cuboid`, `roundedCuboid`), or a listed alias (`square` →
`rectangle`, `circle` → `ellipse`, `sphere` → `ellipsoid`); it matches when it takes the option,
or the same words in another order (`radiusStart`, `startRadius`), which
clears the suggestions. A taper option on `cylinder` (`radiusStart`, `r1`,
`radiusTop`, ...) and an array `cylinder` radius get the taper form instead:
`jf.cylinder({ radius: [start, end], height })` in fluent,
`primitives.cylinderElliptic({ startRadius, endRadius, height })` in
modeling, with start at the -Z end.

When the wrapped call throws, its hints go on new lines of the error's
message, and so does the cause of a number or array option that is NaN or an
object, since modeling's own error ("height must be greater then zero") hides
it. A NaN names each element (`center[1], center[2] are NaN`) and the usual
cause, an undefined value in the arithmetic: a property the object does not
have, a misspelled name, or a parameter read back as an object. An object
names its keys, and one with `default`, `initial`, `type`, `min`, `max` or
`step` among them is called a parameter definition passed instead of its value. params-core defines a section assigned as
one object (`params.box = { wall: { default: 3 } }`) member by member, and
throws for one that mixes definitions with plain values, naming the
parameter and the per-member form. A "X is not a
function" error gets a hint from `withErrorHint`, applied where the error
result is built (`reportError`, [Tool routing and build reports](#tool-routing-and-build-reports)): in fluent, X
as a method of the named classes, called on a jf shape; in modeling, the
functional call from the index signature (`transforms.translate(offset,
shape)`). `cone` gets the taper form. An "X is not defined" error, X a
modeling function or namespace the code never took from its package, gets,
in modeling, the require that brings it in (`const { cuboid } =
require('@jscad/modeling').primitives`, `const { measurements } =
require('@jscad/modeling')`), and in fluent `jf.X(...)` or `shape.X(...)`.
"Class constructor t cannot be invoked without 'new'", whose class name the
frame's minified bundles shorten, gets in fluent the `new jf.FluentGeom3(shape)`
form, since the jf wrappers are the classes a model calls. "'return' outside
of function" gets the module form: `console.log` the value or export a
`main`, in both styles. "EOF is not defined" says the line is left from a
shell heredoc. In fluent, "FluentGeom2 expected a geom2 …, got
an array" says the constructor takes a geom2 or three or more `[x, y]`
points, as `jf.polygon(points)` does. The boolean hint for `{ points, faces }` data also lands on the error the
boolean throws ("only unions of the same type are supported"). `test/warningCases.js` holds the cases
both the eval backend and the app must answer alike.

## Tool routing and build reports

The app and the eval answer tool calls through the same functions, each over
its own way of running the model.

```js
dispatchTool(name, input, { list, read, search, write, edit, deleteFile, run, measure, check, exportModel, view, docs, skill, askUser })
```

Calls the handler for `name` and returns what it answers. Most exposed names
are the handler's `deps` key too; these differ: `glob` uses `list`, `grep`
uses `search`, `delete` uses `deleteFile`, `execute` uses `run` (called as
`run(args.source)`), `export` uses `exportModel`, and `question` uses
`askUser`. The rest call their own key: `read(args)`, `write(args)`,
`edit(args)`, `measure(args)`, `check(args)`, `view(args)`, `docs(args.query)`,
`skill(args)` and `websearch(args)`, with `input` defaulting to `{}`. A name
outside that list answers `toolError('UnknownToolError', 'unknown tool
<name>')`, and a shell name (`bash`, `sh`, `shell`, `terminal`,
`run_command` and the like) adds that there is no shell and which tools change
files and run code; a handler that throws or rejects answers `toolError(error.name,
error.message)` (`Error` and the thrown value's text for a non-error). It
never throws. `toolError(name, message)` is `{ ok: false, error: { name,
message } }`. The eval sends each answer on as JSON text; the app's chat
stringifies it.

Every file tool reads its path through `projectPath`, which answers a
`PathError` for a path that leaves the project, names no file, or holds a
line break or a double quote. The last is a mangled call that put the file
text in `path`; the error names only the path's first line.

```js
assembleReport({ entry, error, warnings, console, params, measure, check })
```

The build report (`buildReport`) of a build that ran. With `error` it is the
failed report and `measure` and `check` are not called; otherwise both are
called (sync or async) for the geometry `main()` returned, and a throw from
either gives the `notGeometryError()` report. `params` are params-core
definitions.

When `check` reports bad reference tags (`tagErrors`) or parts that share
volume (`interference`), the report is `ok: false` with `error.name`
`PartTagError` or `InterferenceError` (tag errors win), and it still carries
`geometry`, `params`, `warnings` and `console`. `InterferenceError` names the
largest pair and counts the other overlapping pairs; the report also carries
`interference: { pairs, total, volume }`. `references` from `check` ride on passing and
failing reports alike. `interferenceUnchecked > 0` adds a `check` warning
that many overlapping pairs were not checked for shared volume. `summarizeRun`
calls `check(items, { interference: false })`, so a scratch `run` never fails
on overlap. The eval backend keeps the geometry of such a failed build, so
`measure`, `check`, `view` and `gradeProject` still read it.

An `InterferenceError` message reads, to 0.1 mm: `parts 0 and 1 share 273.7
mm³ (a 29.4 x 44.6 x 14.5 mm region); 4 more pairs overlap. Each item
main() returns is a separate part in one color; parts may touch but not share
volume. Assembly parts that share volume collide: move or resize one. A detail
in another color is its own part: subtract it from the part around it so the
two touch. Pieces of one color that print as one part are one solid: union
them, then color the result. Purchased hardware is a reference part and is
checked too (docs reference).`
A `PartTagError` message joins `check`'s `tagErrors` with `; `. An `allow`
selector that names no part sharing volume with the reference part is a tag
error (`part 2: allow 1 shares no volume with it; remove it from allow`), unless
its pair went unchecked. The `check`
tool description names `interference`, `references` and `tagErrors`; the
`measure` `overlaps` description says it lists every pair of parts that share
volume, with the shared mm³ and the region size, allowed reference overlaps
marked; the prompt says in one line that items in
`main()`'s array are separate parts that must not share volume and points at
`docs reference`.

```js
reportError(error, { api, index, files })
```

A model error as a report or `execute` result carries it:
`{ name, message, file?, line?, column?, calledFrom? }`, the name cut to 200 characters
and the message to 4,000, without the frame worker's `jscadMain failed: `
prefix or the loader's ` / failed loading module …` note, `out of memory;
try a smaller case` for an allocation failure, and the error hint for `api`
when `index` (the API index) is given. The location comes from `errorLocation`
with `PROJECT_BASE`, or from a Babel message whose first line names
`<PROJECT_BASE><path>:` and ends with `(line:column)`. `calledFrom` lists the
project-file frames below the first, as `path:line`, once each and at most
four: a throw inside a shared helper is usually a caller's bad argument, and
the first frame alone names only the helper.

With the project's `files`, a relative require that names no project file
gets `missingModuleHint`'s line: the files that require it, the file of the
same name it likely meant with the require that reaches it, or else to change
the require or write the file. The loader stops at the first miss, so a model
told only about one file fixes the rest one build at a time. A NaN option
gets `nanSourceHint`'s line (`src/nanSource.js`): the expression written for
each NaN element at the line the error names, and the names it reads, as in
`size[0] is c.length - 4 at main.js:2; c.length is undefined or NaN there`.
It reads up to ten lines from that line for the option, and adds nothing
when the option is not written out there (`{ size }`). A name Babel refuses
as already declared gets `duplicateDeclarationHint`'s line, every line of the
file that declares it (`const`, `let`, `var`, `function`, `class` or a
destructured binding), since Babel names only the second and a model's edit
usually left the old one in place. The app passes the files from its file
cache, the eval its own, each with an `execute` snippet as `__run__.js`.

`PROJECT_BASE` (`http://project.local/`) is the URL base project files load
under, and `RUN_FILE` (`__run__.js`) the file an `execute` snippet runs as beside
them. `createReadFile(files, fetchFile)` is the readFile `@jscadui/require`
gets: a URL under `PROJECT_BASE` answers from `files`, or throws `file not
found <url>`; a key of `files` answers as given; any other path goes to
`fetchFile(path, options)`. The frame's fetch reads the CDN, the eval's
serves the frame's package allowlist from installed packages.

## Chat log reader

The `jscad-chat` launcher's relay logs each chat request as one JSONL line
(see `apps/jscad-web/README.md`). Logs and eval results live in the private
`jscad-chat-evals` repo, cloned at `~/src/jscad-chat-evals` (or
`$JSCAD_CHAT_DATA`); `chatLogDir`/`evalResultsDir` (`log/log-dir.js`) resolve
to `<data>/logs` and `<data>/results` when that repo is present, else the XDG
fallback (logs) or nothing (results, see `EVAL_RESULTS_DIR` below). The reader
groups the lines by chat id, splits them into turns, and parses each response
with the adapters' own stream parsers. The log holds no image bytes: both
relays write each inline image part as a text part `[image: image/jpeg,
1200x900]` (`toLogRequest` in `apps/jscad-web/server/src/relay/chatLog.js`;
the size is read from the PNG, GIF or JPEG header and left out when it cannot
be). The reader joins a user message's text parts, placeholders included,
into its `user` text; the images a `view` result sends as a user message after
the tool result stay parts, so they never start a turn.

```bash
npm run read-log -w @jscadui/agent-loop -- --since 2026-09-27T00:00:00Z
npm run read-log -w @jscadui/agent-loop -- --json
npm run read-log -w @jscadui/agent-loop -- --batch 2026-10-19-a
```

`--batch <id>` reads one synthetic batch, `<logs>/synthetic/<id>/`, and cannot
be combined with `--since`. Plain reads skip `logs/synthetic/`. Each
conversation in a batch is labeled from the batch's `manifest.json`; one whose
chat id is not in the manifest has `label: null`. A missing manifest is an
error naming its path.

Every header carries `failed:<n> unbuilt:<n>`: the count of failed tool calls
and of turns that did not end on a successful `write` or `edit`. A labeled
conversation adds `<scenario> <builder>#<run>` after it.

The summary prints one block per conversation, headed by its chat id, model
and API style, then each user message, each tool call as `ok`, `FAILED` or
`no result`, the error message and code of each failed call (a `write`'s path
and content, an `edit`'s path and its `-`/`+` strings, an `execute`'s source), and
the final assistant text. The style comes from the system prompt's own
heading (`## jscad-fluent style` or `## @jscad/modeling style`, wherever the
provider carries it — `request.system` for Anthropic, `request.instructions`
or a leading `input` item for Responses, a leading message for chat
completions); a log from before the two-style split, whose prompt taught
both, reports `unknown`. `readConversations(dir, { since })` in
`log/read-log.js` returns
`[{ chatId, model, api, turns: [{ ts, user, steps: [{ name, input, result, ok, error? }], final, error? }], stumbles: { failedCalls, unbuiltTurns } }]`.
`readBatch(dir, batchId)` returns the same plus `label: { scenario, builder, simUser, run } | null`.
It reads the directory the launcher writes (`JSCAD_CHAT_LOG` when set) and
the day files one directory below it, such as the production logs
`apps/jscad-web/scripts/pull-chat-logs.sh` pulls into `logs/prod/`.

## Synthetic sessions

A batch drives the real app through every scenario and builder model, with a
simulated user playing the person on the scenario's fact card. Its relay logs
and `manifest.json` go to `<logs>/synthetic/<batch>/`.

`runSession` (`synth/session.js`) runs one session against a page driver:
send the scenario's prompt, answer each question the builder asks through the
simulated user, then render `iso-front`, `iso-back` and `top` (one `view` call
each, so a failed view drops only its own image), take the build report and
the final assistant text, and ask the simulated user to judge. It ends on
`ACCEPT`, after 3 user turns (the prompt included), on a turn that times out,
or on the first error. A builder turn that ends with an error row in the chat
(a failed model request) is an error, `builder: <row text>`, and is not
judged; a turn that hits the step cap and closes with its summary is not. A
timed-out turn is stopped, and so is one whose wait failed or whose question
the simulated user could not answer. The verdict counts as `ACCEPT` when the
reply's first non-empty line is `ACCEPT`, ignoring case, markdown emphasis,
backticks, quotes and trailing `.` or `!`. An empty reply from the simulated
user is an error and is never sent. The simulated user asks at temperature 0
with `reasoning_effort: "low"` and its model's `SIM_USER_MAX_TOKENS` cap
(`synth/roles.js`). A reply that ran out of tokens before any answer
(`LengthError`), passed the client's 120 s timeout (`TimeoutError`), or was
answered 429 or 5xx is asked again, up to 3 attempts: a cut-off one with the
token cap doubled, the others after 5 s times the attempt number. A model
that still fails that way after 3 attempts hands over, for the rest of the
session, to the role's next simulated user (`synth/roles.js`), since a free
model can pass the batch's probe and then go down; the manifest's `simUser`
names the first. Any other failure ends the session at once. Scenario `checks` then run
on the final build, after a timeout too but not after an error. The simulated
user sees only the user's messages and answers, the questions asked and each
turn's final text. Its model calls go straight to the Go endpoint and time out
after 120 s.

`manifest.json` holds `batch`, `jscaduiCommit`, `scenarioSetCommit`, `probe`
(per model `{ available, vision }`) and one entry per session:

| Field | Meaning |
|---|---|
| `chatId`, `scenario`, `builder`, `simUser`, `run` | Which session; `run` counts from 1 per scenario and builder |
| `userTurns` | Messages sent from the user, the prompt included; answers to questions are not counted |
| `accepted` | The simulated user replied `ACCEPT` |
| `checks` | `{ passed, total, failed: [names] }`; `{ passed: 0, total: null, failed: [], noGeometry: true }` when the final build has no geometry; `null` for a scenario without checks or a session that ended in error |
| `stumbles` | `failedCalls` and `unbuiltTurns` as `read-log` counts them, and `corrections` |
| `simUserCalls` | `{ ms, inputTokens, outputTokens }` per simulated-user call |
| `rounds` | Builder model requests in the session |
| `timedOut`, `error` | A turn hit the turn timeout; the message that ended the session, or `null` |

`corrections` is `userTurns - 1`: every simulated-user message after the
prompt is a critique, since an accepted turn ends the session. A session that
never ran, such as one for a builder the probe rejected, has `skipped: true`.

### Running a batch

```bash
npm run synth -w @jscadui/jscad-web
SYNTH_BUILDERS=beam-free SYNTH_SCENARIOS=nameplate SYNTH_RUNS=1 npm run synth -w @jscadui/jscad-web
```

`apps/jscad-web/synth/run-batch.mjs` reads the `opencode-go` key from
`$JSCAD_CHAT_KEYS` or `~/.config/jscad-chat/keys.json`, probes every model the
chosen roles use, and refuses to start unless each model it will call is a
free model the probe found available. The probe tries a model three times
unless it answers 4xx. A builder whose simulated user fails the probe takes the
next one in its role, and the manifest's `simUser` names the one that ran. A
builder whose model, or every simulated user, fails the probe is skipped; its
sessions are recorded with `skipped: true`. A
simulated user that fails the image probe critiques from text only. Then it
runs one lane per builder, the lanes at the same time and the sessions in a
lane one after another. Each session gets a fresh model directory, seeded with
the scenario's `files` or, without them, the two-cars pair a new production
project starts with, and its own launcher (`scripts/jscad.mjs`) on the lane's
port with `JSCAD_CHAT_LOG` set to the batch directory. Headless chromium opens
the app with the ToS consent, the key, the builder selection (`opencode-go`,
fluent, no effort, so the app's own default applies), the harness flag and,
for a builder that reads images, the vision override seeded in localStorage. A
`view` that fails is logged to stderr; the simulated user then judges without
images.

| Variable | Default | Meaning |
|---|---|---|
| `SYNTH_OUT` | `<logs>/synthetic` | Where batch directories go |
| `SYNTH_BUILDERS` | every builder in `synth/roles.js` | Comma list of builder models |
| `SYNTH_SCENARIOS` | all | Comma list of scenario names |
| `SYNTH_RUNS` | `2` | Runs per scenario and builder |
| `SYNTH_DEADLINE_S` | `6600` | A lane starts no session that its longest session so far would carry past this many seconds after the batch started; the rest are recorded with `skipped: true`, since a session the CI job timeout (7200 s) kills is never recorded |
| `SYNTH_TURN_TIMEOUT_MS` | `1800000` | Wait per builder turn before it is stopped |
| `SYNTH_PORT` | `5170` | First lane's app port; lane *n* (from 0) uses `SYNTH_PORT + 10n` and the port above it for the frame |

The batch id is the start time in ISO form with `:` replaced by `-`, and
`<SYNTH_OUT>/latest` holds the newest id. `<SYNTH_OUT>/<batch>/` holds the
relay day files, `manifest.json`, `views/<chatId>-t<turn>-<name>.png` for each
rendered view, and `index.txt`, the list of every file in it, rewritten after
each session. Each lane builds its own bundle into
`apps/jscad-web/build_local-<port>/` (the launcher's `JSCAD_LOCAL_OUT`), since
a bundle bakes its app and frame origins. The page aborts every relay POST
whose body names a `model` other than the session's builder, and the session
ends with the error `builder request used <model>`. A session that saw no
chat id on its relay requests ends with the error `no chat id seen`. A failure while
recording a session becomes that session's error and the lane goes on. Every
launcher still running is stopped when the script exits or gets SIGINT or
SIGTERM. The script exits 1 when the probe gate refuses, or when no lane
finished a session without error.

Compare two batches of the same scenario set:

```bash
npm run synth:compare -w @jscadui/agent-loop -- <batchA> <batchB>
```

Each id resolves under `<logs>/synthetic/`. One row per scenario and builder
shows `a -> b` for the session count, errored and timed-out sessions, check
pass rate (the mean of each session's `passed / total`, a session without
geometry counting 0), accepted sessions, and the mean user turns, rounds,
failed calls, unbuilt turns and corrections. Errored sessions are left out of
the pass rate, the accepted count and the means. A row absent from one batch
shows `-` on that side; skipped entries are ignored. `compareBatches(a, b)` in `synth/compare.js` returns the
rows as `{ scenario, builder, a: stats | null, b: stats | null }`.

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
`delete` answers the same report headed by `deleted`, the file removed:
the file leaves the project's files and the project builds again, so a
delete of the entry answers the no-entry report (`note: "deleted; no entry
yet (…)"`) and a delete that breaks the build says the file is deleted but
the build failed. A delete of a file that is not there answers `{ ok: true }`
and builds nothing, so a stale path from the project note never fails the
model. A build fails with `NoMainError` when the
entry exports no `main()` (`<entry> exports no main()`), `NoGeometryError`
when `main()` returns something `measure` cannot read (`main() returned
something that is not geometry; ...`), and otherwise with the model code's own
error. The app words the first two the same (`noMainError`,
`notGeometryError` in `src/buildReport.js`), with no API hint. One part is
measured, checked and exported as itself, more as an array, as the frame
does (`asGeometry`). A syntax
error is located by parsing each project file with Babel, entry first, since
the eval's `SyntaxError` carries no location; `reportError` reads the file,
line and column from the first parse error's message, as it does for the frame's.
The static lint's own syntax diagnostic, which gates a write in the app before
the frame sees it, quotes the line it stopped on (`Syntax error in: <line>`,
up to 60 characters) or says `Syntax error: unexpected end of file`, once per
line, since the parser recovers token by token. `measure`, `check` and `export`
fail with `NoGeometryError` before the first build (`no geometry: write the
model first`) and after a failed one (`no geometry: the last build failed
(<message>); fix it first`). `execute` answers
`{ ok, warnings, console, geometry? | returned? }`, or
`{ ok: false, error, warnings, console }`; its `geometry` has the build
report's fields, `watertight`, `manifold` and `selfIntersecting` included. An
`execute` stops after 30 s with `{ ok: false, error: { name: "TimeoutError",
message: "run stopped after 30 s; try a smaller case" } }`, in the app and the
live eval alike, and an allocation failure in a run or a build reads `out of
memory; try a smaller case`.

A build that fails with `InterferenceError` or `PartTagError` keeps its
geometry, so `measure`, `check` and `export` still answer on it. Items marked
`previewOnly` (ghosts) are dropped from the eval's geometry: they are not
parts, so they are not measured, checked or exported.

`export` answers like the app: `{ ok, format, size }`, the byte size of the
model, without parts tagged `reference` and without ghosts, as the frame's
`@jscad/io` serializer for that format writes it
(`exportConfig` in `src/exportFormat.js`; `stl` is binary STL). A format with
no serializer fails with `ExportFormatError` in both. The bytes never reach
the model; the user downloads from the app. Under the local launcher, where
the project is a directory on disk, the app also writes the file there and
adds its `path` (`main.stl` for `main.js`); the eval writes nothing and
answers no `path`. `read` of a binary project file
fails with `BinaryFileError`.
`view` fails with `UnavailableError`, and any other name, `eval`,
`writeModel` and `params` included, with `UnknownToolError`.

Build reports and `execute` results carry
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
the model with thin slabs in `execute` to see a profile.

`check` takes a `bed` only when the user names a printer: without one it
reports watertight, manifold, inside out, self-intersecting and size, with no
`fitsBed`. A solid with open edges gets `openEdgeSamples`, the midpoints of up
to five of them, so the model can find where the gap is. No result names a
tool the model cannot run. `measure` gives a negative-volume solid `insideOut: true` and a
note, naming the part for an array (`@jscadui/model-tools`).

Model code may `require()` or `include <...>` a library `.scad` file, the way
the app resolves one from its deployed `/libs/` tree (`createScadHandler`,
shared with the frame). The eval has no app server, so library files are read
straight from `apps/jscad-web/libs` on disk — each of its subdirectories
becomes a library prefix, e.g. `require('NopSCADlib/core.scad')`. Set
`JSCAD_LIBS_DIR` to point the eval at a different libs tree.

### Choosing fixtures and API style

A fixture may declare `group` (string), such as `'profiles'`, an opt-in group
kept for experiments (`gear`).
The default run, with no `EVAL_FIXTURES`, runs the ungrouped fixtures
(`nameplate`, `pipe-tee`, `fluent-chain`) and the `harder` group
(`DEFAULT_GROUPS` in `eval/run-eval.js`): several changes to a saved model in
one message (`box-thicker-lid`), assemblies of parts that fit
(`sliding-lid-box`, `hinge`, `stacking-trays`), parameters the user names
(`bracket-params`), a name cut through a part (`luggage-tag`), a real part the
model must know the sizes of (`pi-enclosure`, `bottle-cap`), a stated opening
and clearance (`drawer`), and computed shapes (`spur-gears`, `twisted-vase`,
`bottle-cap`'s helix). These are the fixtures that still lose points, plus
`box-thicker-lid`, `fluent-chain` and `bracket-params`, kept as the only
default tests of editing a saved project, of the fluent style and of
parameters.

The opt-in `regression` group holds the fixtures that scored 8 in nearly every
run of the 2026-09-30 passes (at most 1 run in 24 below 8, across both models
and styles): the CSG primitives and booleans, the other follow-up edits and
the mid-conversation correction. They add cost without separating one prompt
from another; run them (`EVAL_FIXTURES=regression`) after a change to the
tools, the runtime or the build report, where a basic request could break.
`nema17-mount` and `bearing-holder-608` check that the model requires a
catalog part; both run in the default suite now that the parts catalog has
admitted entries (`packages/parts/docs/user-manual.md`, "Admission").
`profiles` stays opt-in too. `EVAL_FIXTURES` runs the union of
whatever it names, fixture names and group names both, e.g. `EVAL_FIXTURES=profiles`
runs every fixture in that group, `EVAL_FIXTURES=gear,fluent-chain` runs one named
fixture plus one grouped fixture, and `EVAL_FIXTURES=all` runs every fixture
regardless of group except `complex`, which runs only when named, in a pass of
its own ([Complex fixtures](#complex-fixtures)).

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

A complex run is rebuilt with the `bodies` probe and its mesh: the gates are
recomputed and the mesh hashed. When the hash matches `render.meshSha256`, the
stored verdict stands and geometry is recomputed from it and the new gates.
When it differs, the description, votes and verdict are cleared and the run
gets `renderStale: true`, `verdictPending: true` and a `regradeNote`; a project
that no longer builds loses them too and scores geometry 0. A run stored with a
`renderError` that now builds is marked the same way, with a note that it was
never rendered. A stale run stays stale through later regrades until
`npm run describe -- --rerender` draws it again. A complex run's prompt is its
stored `userMessages`, so a changed follow-up also counts as a different
prompt; that note is joined to any other with `; `. `--regrade` makes no
provider call, starts no describer and renders nothing:
`npm run describe -- --rerender <files>` builds each `renderStale` run again
in the sandbox, renders it and describes it, and `npm run judge` on the same
files judges it.

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
| `EVAL_FIXTURES` | comma-separated fixture and/or group names to run; default: ungrouped fixtures and the `harder` group; `all` runs everything but the `complex` group |
| `EVAL_VERBOSE` | `1` also prints the live log's lines to stdout, turn by turn: the header and prompt, tool calls with full input, tool results, and streamed assistant text |
| `JSCAD_CHAT_DATA` | path to the `jscad-chat-evals` clone, default `~/src/jscad-chat-evals` |
| `EVAL_RESULTS_DIR` | overrides where results are written, regardless of `JSCAD_CHAT_DATA` |
| `JSCAD_CHAT_KEYS` | overrides the path to `keys.json` below |
| `EVAL_LIVE_LOG` | overrides the live log path; `0` disables it |
| `EVAL_CRT` | absolute path of the crt binary; default: `crt` on `PATH` |
| `CRT_HOME` | where crt keeps its rootfs dirs, passed to crt; when unset, the eval asks `crt home` for its resolved default (`/data/crt/home/$USER` if it exists, else `/home/crt`); must be outside `$HOME`, `/tmp` and the repo |
| `EVAL_SANDBOX_ROOTFS` | crt rootfs the executor runs in, default `jscad-eval` |
| `EVAL_SANDBOX_MEMORY` | executor memory limit in crt's grammar (`2G`, `1536M`, a bare number is bytes), at least 512M, default `2G`; V8's heap gets three quarters of it. A requested limit the host cannot enforce refuses to start |
| `EVAL_SANDBOX_CPUS` | executor cpu limit in crt's cpus grammar (a positive number, `2` or `1.5`), default `2` |
| `EVAL_SANDBOX` | `crt` (default); anything else is refused by `run-eval` |
| `EVAL_PROCESSES` | run-eval processes sharing the host (`ci/eval` sets the model × API lane count), for the concurrency cap in [architecture.md](architecture.md#sandbox); default 1 |
| `EVAL_RUN_TIMEOUT` | seconds a conversation may run before it is stopped and graded, default 1200 |
| `GRADER_VALIDATION_DIR` | where `grader-validate` writes its file and renders, default `~/.local/state/jscad-chat/grader-validation` |
| `DESCRIBER_HOME` | the describer's venv (`venv/`) and weights (`hf/`), default `/data/moondream3` |

### Turn cap

A conversation's turn cap (provider calls for each user message) is `EVAL_MAX_TURNS` when set, else
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
`$XDG_STATE_HOME/jscad-chat/eval-live.log` (default `~/.local/state`;
`eval/live-log.js`), whether or not
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
default), and each counts below where `execute` and `write` do.

Discipline asks whether the model checked its model. Verification is a
`measure` or `check` call, a `write` or `edit` whose build report came back
`ok` with `geometry` and no error (the report already carries the measured
geometry), or an `execute` whose source calls a `measure*`
function (`shape.measureDimensions()`, `measureVolume()`, as `fluent.md`
teaches) and whose result carries console output. A run with an `execute` gets 2
when the fixture has no `verifyBeforeWrite`, when it never writes, or when it
verifies before or after its first save (`write`, `edit` or `delete`), else 1; a save builds the
model, so measuring after it counts. A run with no `execute` gets 2 when it
verifies after a save, else 0. Recovery is 2 when no tool call failed
or a success followed the last failure, else 0, counting every call but a
scratch `execute`, which neither breaks nor fixes the project (a failed `execute`
still counts toward conservation); a run the turn cap ended
(its last round's results got no reply) leaves that round's failures out,
since it had no turn left to recover in. Conservation is 2 for at most 6
counted calls, 1 for at most 12, else 0. It counts every call except a
successful `write`, `edit`, `delete`, `read` or `glob` (and an older file's
`writeModel`), so failed builds and failed calls count, and saving often or
reading before editing never costs a point.

Geometry grades the project's final state, since that is what the app's user
keeps: the fixture's files with every `write`, `edit` and `delete` replayed
(one the backend refused changes nothing), built through its entry in a fresh
backend
state after the run ends, so a scratch `execute` changes nothing. A project with
no entry file, or whose final state does not build, gets geometry 0 (an older
file with no entry file builds the file its last `writeModel` wrote). A
model that has not finished after 120 s at grading time gets no geometry. A
fixture whose `requires` lists `write` gives a run that neither wrote nor
edited a file geometry 0 and `checkRate` 0 without running its checks, and
marks the report `wrote: false`, unless the provider ended the run
(`providerError`); the other three grades still count, so such a run scores
at most 6; a `delete` alone is not a write, so it never satisfies that
`requires`. A fixture that does not require `write` is graded on
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
of its geometry checks, the mean total, the count of runs with an `error` and
`interfering`, the mean number of interfering pairs (`interference.total`, 0 for
a run without any). `--compare` shows it as `interfering a → b`.
A `providerError` or `infraError` run has no answer to score, so those four
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
  (build reports and `execute` results), summed. Transcript-derived.
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
- `roundsToFirstBuild`, `maxBuildGap`, `outputTokensToFirstBuild`: how early
  and how steadily the user sees a new model. A round is one assistant reply
  in the transcript, numbered from 1 across every turn of the run; replies in
  the fixture's prior `transcript` don't count. A build is a `write`, `edit`
  or `delete` result with `ok: true` and a `geometry`; it is visible when its
  `geometry` `parts`, `dimensions` or `volume` differ from the last visible
  build. `roundsToFirstBuild` is the round of the first build, `null` when
  none. `maxBuildGap` is the most rounds from the start to the first visible
  build, between two visible builds, or from the last one to the run's last
  round; the whole run's round count when nothing builds. `outputTokensToFirstBuild`
  sums each round's `usage` output tokens through the round of the first
  build; `null` without a build or when a round in that span reported no
  usage. The means leave out `providerError` and `infraError` runs.

`summarize` means each of these per fixture (over non-null values; `null`
when none exist), and `formatSummary`/`formatComparison` print them in a
second and third table alongside the existing one, and the cadence in a
fourth (`rounds  firstBuild  buildGap  tokensToFirstBuild`), showing `-` for a
result file written before a field existed. `reasoningTokens` appears only in
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

A complex pass's file is `<YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>-complex-<sha8>.json`
and records `suite: 'complex'`. `--compare` refuses a complex file against a
single-shot one, and two complex files whose describer or judge model or
prompt hash differ.

### Fixtures

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid, probe }), api?, transcript?, files?, apiFiles?, target?, probe?, followUps? }`.
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

Whenever `solid` is not `null`, grading appends two checks to the fixture's own,
and they count like any other: `parts do not share volume` (fails when `solid`
has `interference`) and `reference tags are valid` (fails when it has
`tagErrors`). A project with no geometry gets neither. The grade report copies
`interference` (`{ pairs, total, volume }`), `references`, `tagErrors` and
`interferenceUnchecked` from `solid` when present, so the result file's
per-run `report` records them. Complex fixtures get the same two as gates after
`connected`, and the same fields.

`followUps: [{ message }]` sends later user messages in order, each after the
turn before it ends, whatever that turn built, through `buildMessages` as the
app sends a later message: the earlier messages and the text of each reply,
each carrying the paths its tools touched as `mentions`, then the project's
files and its build, after the
backend is reset to the project as it stands and built. The turn cap applies
to each message, and grading reads it that way: whether a run was capped or
ended without a reply counts only the rounds after the last user message. An
error (provider, empty reply, run time limit, sandbox)
ends the conversation, and no later follow-up is sent. The stored `transcript`
keeps the first turn whole and, for each later turn, its project note, its
message and its reply, so the grade replays every write and edit in order.

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
  alone. The list stops at 64 bodies; `bodyCount` is the true number and
  `bodiesCapped` marks a list that was cut, so a many-body model keeps its
  grade instead of blowing the executor's 1 MiB reply cap. With `overlaps:
  true` the probe also has `overlaps: [{ a, b, volume }]`, the volume bodies
  `a` and `b` (indexes into `bodies`) share, for each
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
fit. In the `harder` and `regression` groups, `stand-bigger-slots` counts slots as runs of cuts
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
`turret-lower` replays a logged conversation (2026-09-30, chat 8d3c5d92): two
turns of transcript, the 229 mm water turret as it stood, and the user's
request to lower it with a single-reduction azimuth drive. It wants the model
at least 5% lower, 1 to 3 gears lying flat (a horizontal cut with 18 or more
lobes; the starting model has 4), both pose sliders kept, and a watertight
result. The provider refused the request three times in the log, so it sits
in `regression` until a run shows the current prompt failing it.
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

### Complex fixtures

A `complex` fixture asks for a whole object ("we need a model of a toy
caboose"), which no set of checks can grade. It declares `gates` in place of
`checks`, and its geometry grade comes from a verdict: a vision model
describes renders of the result without seeing the request, and a text model
judges that description against the user's messages
([architecture.md](architecture.md#complex-grading)). The grader is not yet
calibrated: the first pass failed most runs that meet their request
(`docs/backlog.md`, Calibrate the complex grader), so treat `verdictRate` as
provisional.

```js
export const fixture = {
  name: 'toy-caboose',
  group: 'complex',
  prompt: 'we need a model of a toy caboose',
  requires: ['write'],
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m, { solid, probe, params }) => [],
}
```

`gates` lists only what the user's messages state, a size ("my desk is 20mm
thick") or a count of separate parts, tested with a tolerance through the
probes, never something the user left open. `pieces` (default 1) is how many
separate pieces the request calls for. `followUps: [{ message }]` holds later
user messages; they have no checks of their own, and the judge reads them
all. A complex fixture is graded with the `bodies` probe added to its own
`probe`, and gets harness gates before its own (five, three when `solid` is `null`):

- `builds`: the project builds to geometry.
- `watertight`: from `solid`.
- `connected`: the probe's bodies, grouped so two bodies share a group when
  their bounding boxes, each grown by 0.5 mm on every side, overlap. It passes
  with at most `pieces` groups and reports `groups`. A roof lifted off its
  walls or wheels hanging below their axles make a second group. It tests for
  parts that float clear, not for contact: a part inside another's box joins
  it without touching it. When the probe capped the body list, the listed
  bodies cannot show the whole model's grouping, so `connected` fails rather
  than pass on the listed bodies alone; `groups` still counts only the listed
  bodies, so it never claims more groups than they support.
- `parts do not share volume` and `reference tags are valid`: the two automatic
  checks, from `solid`. A grade with no `solid` has only the first three.

Geometry is 2 when the verdict is success and every gate passes, 1 when the
verdict is success and a gate fails, and 0 when the verdict is failure or the
project does not build. `checkRate` counts the gates plus the verdict as one
entry. Until the judge has run, geometry is 0 and the run carries
`verdictPending: true`. A run with `verdictPending`, a `renderError` or a
`graderError` stays out of the `total` and `checkPassRate` means; its
`firstAttemptFailures` still counts. The summary adds, per complex fixture,
`pending` (runs waiting for a verdict) and `verdictRate` (the fraction of
scored, non-pending runs that succeeded); a run whose `builds` gate failed has
no verdict and never will, so it counts in `verdictRate` as a failure rather
than being left out with the pending, render-error and grader-error runs.
`formatSummary` prints them in a `fixture  verdictRate  pending` table and
`formatComparison` compares them. A project that does not build is not
rendered, described or judged, and scores geometry 0.

A complex pass runs with `EVAL_FIXTURES=complex` (or complex fixture names)
and nothing else: a selection that mixes complex and other fixtures exits
with an error. It starts Playwright's chromium before any provider call
(`npx playwright install chromium` in `apps/jscad-web` installs it). After
each run's grade, the grade executor sends the model's mesh and `run-eval`
renders the four views (`eval/views.js`) into
`<file stem>.renders/<fixture>-<run>/` beside the result file. Each complex
run adds:

- `userMessages`: the prompt and each follow-up, what the judge reads.
- `gates`: `[{ name, pass }]`, with `groups` on `connected`.
- `render`: `{ meshSha256, facts: { dimensions, bodies }, views: [{ name, path, sha256 }] }`,
  each `path` relative to the result file's directory; or `renderError` when
  the mesh was refused or the render failed. If chromium dies partway through
  a pass, every run rendered after it also gets `renderError`; recover with
  `--regrade` (marks a run that still builds `renderStale`), then
  `npm run describe -- --rerender`.
- `description: null` and `verdict: null`, filled in by the describe and
  judge stages.

The complex group; `builds`, `watertight` and `connected` apply to all:

| fixture | user messages | pieces | stated gates |
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
`dump-truck` has no gate for motion; the judge rules on the whole object. The
pocket gate wants a hole loop at least 77 mm both ways in a horizontal cut (a
3 inch pad is 76 mm); the lamp-shade gate a hole loop 40 to 44 mm across,
within 1 mm of round; the clip gate two loops of one cut, in any of the three
directions, 20 to 21.5 mm apart along one in-plane axis while facing each
other along the other. `eval/complex-fixtures.test.js` passes and fails a
simple model against each stated gate.

### Describe and judge

A complex pass's runs are described and judged after the lanes finish, once
over every result file:

```bash
npm run describe -w @jscadui/agent-loop -- [--all] <result files>
```

npm runs it in `packages/agent-loop`, so give absolute paths. It frees the
GPU first: it asks Ollama on `127.0.0.1:11434` to unload every model it holds
(`keep_alive: 0`), then reads the card's free memory from `nvidia-smi`. Below
11,800 MiB it stops, naming the free amount and the processes holding the
card, and leaves the runs undescribed; running it again on the same files
finishes them. Then one describer process (`DESCRIBER_HOME/venv`, default
`/data/moondream3`; setup in `ci/README.md`) loads Moondream 3.1 once and
describes each view of every rendered run with no description:

> This is the {front three-quarter view | back three-quarter view | side view
> | top view}. Overall size {W}×{D}×{H} mm, {N} parts.
>
> Describe the object in these renders: what it most likely is, its main
> parts and how they're arranged, every opening, hole, slot or hollow and
> roughly how big it is next to the whole, colours, and anything that looks
> broken or odd. Plain text, under 150 words. Do not guess a purpose you
> can't see.

`N` is the `bodies` probe's count. The run's `description` is `{ text, views:
[{ name, text, ms, inputTokens, outputTokens }] }`, `text` the four replies
one per line as `{view label}: {reply}`. A run with a view that failed gets
`describeError` naming it and no description; the judge skips it, and the
next `npm run describe` on the file tries it again. The file records
`describer: { model, kestrel, promptSha256, blockedConnections }`; the
describer refuses every outside connection. `--all` describes every rendered
run again and clears its votes and verdict, so run the judge on the same
files after it. `--rerender` first builds and renders again each run
`--regrade` marked `renderStale`, which needs the crt sandbox and chromium as
`run-eval` does. `--rerender --all` together build and render again every
rendered or stale run, not only the stale ones, then (with `--all`) describe
every run; used to recalibrate a whole pass (`ci/README.md`, Regrade check
(complex)). The describer never sees the prompt, the transcript, the source,
file names or parameter names, since any of them can name the object.

It exits 0 when every pending run was described, and 1 when it finished but
a view failed; the judge can run after either. It exits 2 when it stopped in
a way the judge must not run after: no files given, less than 11,800 MiB
free, a describer that did not start or died before it finished (its
refused-connection count is then unknown, `blockedConnections: null`), or any
refused outside connection. The descriptions already written are kept.

```bash
npm run judge -w @jscadui/agent-loop -- [--all] <result files>
```

makes three calls per described run with no verdict to DeepSeek v4.1 flash
through opencode-go (`reasoning_effort: "none"`, temperature 0, at most 150
output tokens), with the key from the same `keys.json` lookup as the eval's
providers ([Provider keys](#provider-keys)):

> The user's message(s):
> "{message 1}"
> "{message 2}"
>
> Measured result: overall size {W} x {D} x {H} mm; {B} separate solid(s), in
> {G} group(s) not touching each other.
>
> A describer looked at four renders of the result (front three-quarter, back
> three-quarter, a raised side view and a view from above) and described each
> view on its own, without seeing the request. It can misread a single view,
> so the views may disagree; judge the object they describe together. The
> describer does not know what the object is for and often names it by its
> shape alone ("a box with holes", "a U-shaped bracket"); judge whether the
> shapes and parts it describes would do what the user asked for, not whether
> it uses the user's words.
> {description}
>
> Did the result succeed at what the user asked for? Answer SUCCESS if the
> user who made the request would accept the model as what they asked for. A
> generic shape, missing major parts, or parts floating apart are FAILURE.
> Still renders cannot show motion or removal: a visible hinge, pivot, or
> separate piece counts for a part that moves or comes off, and a fitting
> counts when its opening or shape is there. Do not fail it for colours,
> style, or details the user did not ask for. Answer SUCCESS or FAILURE, then
> one line why.

The user's messages are the run's `userMessages`. `{W} x {D} x {H}` comes from
the run's `render.facts.dimensions`, rounded to whole mm; `{B}` from
`render.facts.bodies` (the bodies-probe count, the true `bodyCount` when the
list was capped, only when it is a positive integer); `{G}` from the `connected`
gate's `groups`, which merges bodies
whose bounding boxes touch — a removable lid resting on a box is 2 bodies in
1 group. Each clause is left out independently when its value is missing
(the `in` before `{G}` goes with it), and the whole `Measured result` line
when all three are. `judgePrompt` takes the run itself (or
`{ messages, description, facts, groups, bodies }`), so `JUDGE_PROMPT_SHA256`
hashes the template with those names as placeholders. A
vote is the first `SUCCESS` or `FAILURE` in the reply and the rest, trimmed to
200 characters, its reason; a reply with neither word, or a provider error, is
asked again up to twice, then the vote is null. The run gets `votes: [{
success, reason, ms }]` and `verdict: { success, votes: [for, against] }`, the
majority of three non-null votes; with fewer than two agreeing votes it gets
`graderError: true` and `verdict: null`, and stays out of the means. Geometry,
`checkRate`, the total and the file's summary are recomputed, and the file
records `judge: { provider, model, promptSha256 }`. `--all` judges every
described run again, after a change to the judge's prompt or model. The judge
never sees the assistant's text, tool calls, source or renders: a model that
writes "here is your caboose" over a box gains nothing. It exits 1 when it
cannot run (no `opencode-go` key, a file it cannot read) and 0 otherwise; a
run with no majority is a `graderError`, not a failed stage.

### Grader agreement

```bash
node eval/grader-agreement.js <labels.json> <result files…>
```

Checks a run's outcome against a reviewed label set:
`[{ file, fixture, run, expected: 'success' | 'failure', note }]`, `file` the
result file's name (not a path), `run` the run number. A run's outcome is
`success` only when its verdict is `success` and every gate passed (the same
test as geometry 2, `eval/complex.js`); a passing verdict with a failed gate
is a `failure` outcome. A run labeled `success` whose model interferes counts
as a disagreement after a regrade. For each label it finds the matching file and run
among the given result files and prints the run's verdict, its failed gates
(if any), and whether the outcome agrees with `expected`, or why it has no
verdict (no majority, not described, not rendered, `renderStale`, or the file
or run was missing); a missing file or run is reported, never a crash. It
then prints the agreement as `agree/labelled` and lists the disagreements.
It exits 0 after reporting — a report, not a gate — and 1 only on bad usage
(missing arguments). `graderAgreement` is exported for tests and other
callers.

### Grader validation

`eval/grader-validation/cases.js` holds known answers for the describer and
judge: model source, the user's messages and the expected result.

| case | expected |
|---|---|
| `caboose`, the chat-built toy caboose | pass |
| `delivery-truck` | fail |
| `plain-box`, the caboose's red body on its wheels only | fail |
| `exploded`, the caboose's roof, cupola, chimney and wheels moved 15 to 30 mm apart | fails `connected`, whatever the verdict |
| `no-roof`, the caboose with its roofs removed | a known miss: recorded, not scored |

```bash
npm run grader-validate -w @jscadui/agent-loop
```

builds each case in the crt sandbox with the `bodies` probe, renders it,
describes and judges it (three judge calls), and prints each case's failed
gates, verdict and votes against the expected result, then its description;
it exits 1 when a scored case does not match or a view fails to describe. When
the describe stage stops (a crash or a refused connection, which it prints) it
exits 1 without judging. `--until render` or `--until describe` stops early.
It needs the GPU, so it runs on the CI host (`sci push
jscadui/grader-validate`, `ci/README.md`). Every scored case must match before
a change to either prompt, either model or the renderer is kept.
It writes
`<time>-grader-validation.json` and its renders to `GRADER_VALIDATION_DIR`
(default `~/.local/state/jscad-chat/grader-validation/`). A case may give
`files` and `entry` in place of `source`, and `api` (default `fluent`).

Once a complex pass exists, one approved answer per complex fixture joins the
cases: after the user reads a run's renders and accepts it,
`npm run grader-validate -w @jscadui/agent-loop -- --case-from <result file>
<fixture> <run>` prints the case (the run's saved project, messages, api and
pieces, `expected: 'pass'`) to add to `CASES`.

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
`sci push jscadui/eval-complex` (`ci/eval-complex`, `ci/eval-complex.conf`)
runs the complex group the same way, then describes and judges every result
file on the host, skipping the judge when the describe stage stops (exit 2,
[Describe and judge](#describe-and-judge)); `fetch-ci-results.js` copies each
file's renders beside it and removes an older complex pass's renders from the
results dir.
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
