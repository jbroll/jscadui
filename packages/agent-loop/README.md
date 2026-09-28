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
`Also:` line, or lists the candidates. A miss is a failed result,
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
| `EVAL_API_KEY` | provider key; with `EVAL_PROVIDER=meta` and no key, `providers.meta.api_key` and `api_base_url` come from `~/.config/muse/auth.json` |
| `EVAL_BASE_URL` | provider base URL, without `/v1` |
| `EVAL_RUNS` | runs per fixture, default 5 |
| `EVAL_FIXTURES` | comma-separated fixture names to run, default all |
| `EVAL_VERBOSE` | `1` prints each run turn by turn: the header and prompt, tool calls with full input, tool results, and streamed assistant text |
| `JSCAD_CHAT_DATA` | path to the `jscad-chat-evals` clone, default `~/src/jscad-chat-evals` |
| `EVAL_RESULTS_DIR` | overrides where results are written, regardless of `JSCAD_CHAT_DATA` |

Each run is graded on discipline, recovery, geometry and conservation (0-2
each) and on `firstAttemptFailures`: the failed tool results before the first
successful `eval`, or before the end of the run if none succeeds. The summary
gives, per fixture, the mean `firstAttemptFailures`, the pass rate of its
geometry checks, the mean total and the count of runs that ended in a
provider error.

Each result also carries `metrics`, degrading gradually where the 0-2 grades
tend to max out once a prompt clears the bar:

- `rounds`: provider calls in the run (one per `send()` on the wrapped
  provider, capped at `fixture.maxTurns`).
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
- `seconds`: wall time of the run.
- `geometryError`: relative error against an optional fixture `target`
  (`{ volume?, dimensions? }`): the max of `|volume - target| / target` and,
  for `dimensions`, the max per-axis relative error comparing both sides
  sorted ascending (so orientation doesn't matter); `null` when the fixture
  has no `target` or no geometry was produced.

`summarize` means each of these per fixture (over non-null values; `null`
when none exist), and `formatSummary`/`formatComparison` print them in a
second table alongside the existing one, showing `-` for a result file
written before `metrics` existed. `--regrade` fills only `toolCalls`,
`failedCalls`, `warnings` and `docsCalls`; the rest are left as stored, since
they need the original provider run.

Each result file, `eval/results/<date>-<model>-<sha8>.json`,
records the SHA-256 of the assembled system prompt, so `--compare` can set two
prompt versions side by side. The result dir is `evalResultsDir()`: `EVAL_RESULTS_DIR`
when set, else `<data>/results` when the evals repo is present; with neither,
`run-eval` exits 1 before calling any provider. `--compare` always takes
explicit paths. The file is rewritten after every run, so an
interrupted eval keeps every run that finished. Each result also carries `transcript`, the run's
messages minus the system prompt, for tracing a stumble back to the tool calls
that caused it. The eval prints one line per run as it goes. The key is never
printed or written.

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params }), transcript?, files?, target? }`.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses. `target` (`{ volume?, dimensions? }`) feeds
`geometryError` for a fixture whose prompt fixes the geometry.

## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and keep the change only when the target fixtures improve (fewer first-attempt
or total failed calls, fewer rounds, or lower `geometryError`) and no fixture's
mean total falls by more than 0.5 or its mean `rounds` rises by more than 1.0.
