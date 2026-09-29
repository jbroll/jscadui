# @jscadui/agent-loop

The browser-local agent loop behind jscad-web's AI Chat: provider adapters
for Anthropic Messages, OpenAI chat completions and the OpenAI Responses API,
the tool list, and the system prompt. It also holds the tools that improve
the prompt from real sessions: a reader for the launcher's chat log and a
live eval.

```js
import { createProvider, runTurn, SYSTEM_PROMPT } from '@jscadui/agent-loop'
```

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

## System prompt

`prompt.md` is the only copy of the prose. Example models live in
`prompt/examples/*.js`, each opening with a one-line comment naming the
request it answers, and are listed in `prompt/index.js`. `SYSTEM_PROMPT` is
`prompt.md` followed by an `## Examples` section with each example fenced, in
file-name order. Tests check the order and that every example evaluates.

The files are imported as `?raw` text. Vitest reads that natively, jscad-web's
esbuild build uses `src_build/rawImport.js`, and a Node script that imports
`index.js` needs the loader hook:

```bash
node --import ./text-loader.js eval/run-eval.js
```

## Conversation context

```js
buildMessages({ systemPrompt, transcript, files, message, budget = CONTEXT_BUDGET })
```

Returns the system prompt, the newest whole prior turns that fit in `budget`
characters (24,000 by default), a user message with every text file in
`files` under `### <path>` (outside the budget, omitted when empty), and the
new message. The app and the eval both use it.

## API index

`api/index.json` describes the public API of `@jscad/modeling`, from the
pinned checkout's JSDoc (every namespace but `maths` and `geometries`),
`@jbroll/jscad-fluent`, from its installed `dist/*.d.ts`, and
`@jscadui/jscad-text`, from its JSDoc. It has one entry per namespace, class
or function: `name` (`primitives.roundedCuboid`, `jf.cube`,
`FluentGeom2.extrudeLinear`, `jscadText.text2d`), `pkg`, `kind`, `signature`,
`description`, `example`, and for a function that takes an options object
first, `optionsFirst` and `options` (name, type, default, description). A
fluent entry whose options are a modeling function's names it in `sameAs`
instead of copying them, and the fluent array classes name their base class
in `extends`. `api/optionTable.js` holds only the option names, for the
unknown-option checks: `options` for functions reached from the exports
(`primitives.roundedCuboid`, `cube` for `jf.cube`), and `methods` for the
fluent class methods whose first parameter is an options object, keyed by
class (`FluentGeom2.extrudeLinear`).

An unknown key's `suggestions` are known options within edit distance 3, plus
either name containing the other (`radius` → `roundRadius`, 5 edits apart,
matches by containment instead).

Both files are generated and committed:

    npm run api-index -w @jscadui/agent-loop

A test fails when either differs from a fresh generation, so a
`@jscad/modeling` pin update or a fluent upgrade needs a regeneration in the
same commit. Where JSDoc misses an option the generator adds it: a function's
`defaults` literal keys (`extrudeLinear`'s `repair`), and the options
`PASS_THROUGH` in `api/build-index.js` names (`extrudeRectangular` hands its
options to `expand` and `extrudeLinear`).

## docs tool

`docs({ query })` answers from the index with `docsTool(index, query)`
(`src/docs.js`), the same pure function in the page and in the eval. A query
is a qualified name (`primitives.roundedCuboid`, `jf.polygon`,
`FluentGeom2.extrudeLinear`), a bare name (`roundedCuboid`) or a namespace or
class (`primitives`, `FluentGeom2`). A function answers with its signature,
description, options with type and default, and example; a fluent entry adds
`Same options as <modeling name>`. A namespace or class answers with its
members and one-line summaries, and a class method missing from an array
class is looked up on the class it extends. A bare name that matches in
several packages answers the `@jscad/modeling` entry with the others on an
`Also:` line, or lists the candidates. A package name (`@jbroll/jscad-fluent`,
`@jscadui/jscad-text`, `@jscad/modeling`) resolves to that package's top entry,
or, for `@jscad/modeling`, a listing of its namespaces (`primitives`,
`booleans`, `transforms`, …) with one-line descriptions. A miss is a failed result,
`{ ok: false, error: { name: 'NotFoundError', message: 'no entry <query>; closest: a, b, c' } }`,
with the three nearest names by edit distance. Answers are cut at 3,000
characters.

## Eval

The eval replays each fixture in `eval/fixtures/` against a live model and
grades the transcript. Model code runs through `@jscadui/require` with the
compute frame's transform rule and CDN URL scheme; `https://cdn.jsdelivr.net/npm/<pkg>`
maps to the package in local `node_modules`, and a package that is not
installed fails with the frame's `failed to load module <name>` /
`file not found <url>` text. `@jscadui/jscad-text` (ESM-only) and
`@jbroll/jscad-anchors` (not installed) fail here though the app serves them.

The CDN stub hands model code a copy of `@jscad/modeling` and
`@jbroll/jscad-fluent` with the unknown-option checks (`src/optionChecks.js`,
`api/optionTable.js`), so `eval` and `writeModel` results carry
`warnings: [{ fn, option, suggestions }]` like the app's. Node's modeling
module object is never changed: fluent and model-tools require the same one.

`eval` and `writeModel` also capture the model run's `console.log/info/warn/error/debug`
calls (`src/consoleCapture.js`) and return them as `console: [lines]` when
non-empty, formatted like Node's `util.format` (objects via `JSON.stringify`,
falling back to `String` on a circular one), capped at 50 lines and 4,000
characters total with a trailing `… (N more lines)` note. The frame worker
captures the same way for the app (`apps/jscad-web/src_frame/consoleCapture.js`),
always forwarding to the real console too so the editor's own runs still log
to devtools; a grid run concatenates every member's console lines in member
order under the same cap.

Fluent class methods that take options (`.extrudeLinear({...})`) are checked
by wrapping them once on Node's fluent prototypes, since fluent exports no
classes; that reaches fluent's own calls too, which is safe because fluent
never calls those methods itself and passes modeling only valid options.
`eval/fluent-guard.test.js` runs every fluent example in the repo with the
wraps on and fails on any warning.

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
npm run eval -w @jscadui/agent-loop -- --compare eval/results/a.json eval/results/b.json
npm run eval -w @jscadui/agent-loop -- --regrade eval/results/a.json eval/results/b.json
npm run eval:keyless -w @jscadui/agent-loop
```

A fixture may declare `group` (string), such as `'profiles'` for fixtures whose
correct answer requires computing a point-list profile (`gear`).
The default run, with no `EVAL_FIXTURES`, runs only ungrouped fixtures: the CSG
suite of primitives and boolean operations. `EVAL_FIXTURES` runs the union of
whatever it names, fixture names and group names both, e.g. `EVAL_FIXTURES=profiles`
runs every fixture in that group, `EVAL_FIXTURES=gear,fluent-chain` runs one named
fixture plus one grouped fixture, and `EVAL_FIXTURES=all` runs every fixture
regardless of group.

`--regrade` rewrites each result file in place with no provider calls: it recomputes
`discipline`, `recovery`, `conservation` and `firstAttemptFailures` from the stored
`transcript` against the current grading code and fixtures, keeps the stored `geometry`
and `checkRate` (they need the final measure, which isn't stored), recomputes each
run's `total`, and rebuilds the file's `summary`. A result whose fixture no longer
exists is left as it was. Use it after a grading-rule change to update old result
files without spending API budget.

| Variable | Meaning |
|---|---|
| `EVAL_PROVIDER` | provider kind: `anthropic`, `openai`, `opencode-go`, `meta` |
| `EVAL_MODEL` | model id |
| `EVAL_API_KEY` | provider key; overrides everything below |
| `EVAL_BASE_URL` | provider base URL, without `/v1` |
| `EVAL_RUNS` | runs per fixture, default 3 |
| `EVAL_CONCURRENCY` | conversations run at once, each in its own worker thread, default 6 |
| `EVAL_MAX_TURNS` | turn cap for every conversation; overrides `eval/models.json` and the fixture's `maxTurns` |
| `EVAL_FIXTURES` | comma-separated fixture and/or group names to run; default: ungrouped fixtures only; `all` runs everything |
| `EVAL_VERBOSE` | `1` also prints the live log's lines to stdout, turn by turn: the header and prompt, tool calls with full input, tool results, and streamed assistant text |
| `JSCAD_CHAT_DATA` | path to the `jscad-chat-evals` clone, default `~/src/jscad-chat-evals` |
| `EVAL_RESULTS_DIR` | overrides where results are written, regardless of `JSCAD_CHAT_DATA` |
| `JSCAD_CHAT_KEYS` | overrides the path to `keys.json` below |
| `EVAL_LIVE_LOG` | overrides the live log path; `0` disables it |

A conversation's turn cap (provider calls) is `EVAL_MAX_TURNS` when set, else
`maxTurns` from the model's entry in `eval/models.json`
(`{ "<model id>": { "maxTurns": 8 } }`), else the fixture's own `maxTurns`.
The cap a model gets is a budget for fixing its own mistakes across turns, so
set it per model rather than tuning it to one-shot answers. Each result records
its effective cap as `maxTurns`; the result file's top-level `maxTurns` is the
model-level cap, or `null` when every fixture kept its own.

Each fixture × run is one conversation, run in its own worker thread
(`eval/worker.js`, loaded with the same `--import ./text-loader.js` hook as the
CLI) with its own backend and provider instance; the backend keeps module-level
and `globalThis` state, so two conversations never share a JS realm.
`eval/parallel.js` keeps up to `EVAL_CONCURRENCY` workers busy. The main
thread resolves the provider key once and hands each worker the provider
config in `workerData`, in memory only. It collects each result as it
finishes, prints its per-run line, and rewrites the result file with every
finished run ordered by fixture then run, whatever order they finished in. A
provider error stays on its run's `error`; a worker that dies before sending
a result records `error: "worker crashed: …"` on that run, and the suite goes
on. `runSuite` in `eval/run-eval.js` is the sequential in-thread path the unit
tests and `eval:keyless` use.

Every run appends the same conversation lines `EVAL_VERBOSE` prints — run
headers, prompts, tool calls with source, tool results, per-run summaries,
and the final tables and speed line — to
`~/.local/state/jscad-chat/eval-live.log` (`eval/live-log.js`), whether or not
`EVAL_VERBOSE` is set; that variable only controls stdout. A conversation's
lines, on stdout and in the log, are prefixed `[<model> <fixture>#<run>] ` so
concurrent conversations stay legible; the header, summary tables and speed
line are prefixed `[<model>] `. A multi-line block (a model source, a
multi-line error) gets the prefix on every line. The file starts with one header line: time, provider,
model, the prompt hash's first 8 characters, the fixture names, the run
count, the model turn cap (`maxTurns=fixture` when there is none) and the
result file path. Past 10 MB the file rotates to
`eval-live.log.1` (replacing an older one) before the next write, so
`tail -F ~/.local/state/jscad-chat/eval-live.log` in a second terminal
follows a run live across the rotation. The log never receives anything
beyond this text, so no key material reaches it.

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

Each run is graded on discipline, recovery, geometry and conservation (0-2
each) and on `firstAttemptFailures`: the failed tool results before the first
successful `eval`, or before the end of the run if none succeeds. The summary
gives, per fixture, the mean `firstAttemptFailures`, the pass rate of its
geometry checks, the mean total and the count of runs that ended in a
provider error.

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
only `toolCalls`, `failedCalls`, `warnings` and `docsCalls`; the rest,
including the speed fields, are left as stored, since they need the original
provider run.

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

Each result file, `eval/results/<YYYY-MM-DD>T<HHMMSS>Z-<model>-<sha8>.json`,
records the SHA-256 of the assembled system prompt, so `--compare` can set two
prompt versions side by side. The result dir is `evalResultsDir()`: `EVAL_RESULTS_DIR`
when set, else `<data>/results` when the evals repo is present; with neither,
`run-eval` exits 1 before calling any provider. `--compare` always takes
explicit paths. The file is rewritten after every run, so an
interrupted eval keeps every run that finished. Each result also carries `transcript`, the run's
messages minus the system prompt, for tracing a stumble back to the tool calls
that caused it. The eval prints one line per run as each finishes. The key is
never printed or written.

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params, source, solid }), transcript?, files?, target? }`.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses. `target` (`{ volume?, dimensions? }`) feeds
`geometryError` for a fixture whose prompt fixes the geometry. `source` is the
last `writeModel` source in the run, else the last `eval` source, else `''`
(`lastSource` in `eval/grade.js`), so a check can inspect the code the model
wrote as well as the geometry it produced (a style check on a fluent chain,
for example). `solid` is the parsed result of the backend's `check` tool run
on the final geometry after the run ends (`eval/backend.js`, `@jscadui/model-tools`),
or `null` when no geometry was produced; checks use it for `watertight` since
`measure` alone doesn't report it. `--regrade` still leaves geometry and
`checkRate` as stored, since it has no live measure to re-run `checks` against.

A fixture's `prompt` is a request a real user would type: casual and often
underspecified, never a specification written to be graded, and never phrased
to steer the model toward a particular answer. `checks` test properties any
reasonable answer has (plausible size, hollow where the object should be
hollow, watertight, a size the prompt actually states) rather than one exact
shape; an exact-volume band is only for a fixture whose prompt pins the
geometry precisely.

## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and keep the change only when the target fixtures improve (fewer first-attempt
or total failed calls, fewer rounds, or lower `geometryError`) and no fixture's
mean total falls by more than 0.5 or its mean `rounds` rises by more than 1.0.
