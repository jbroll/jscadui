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
(see `apps/jscad-web/README.md`). The reader groups the lines by chat id,
splits them into turns, and parses each response with the adapters' own
stream parsers.

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

## Eval

The eval replays each fixture in `eval/fixtures/` against a live model and
grades the transcript. Model code runs through `@jscadui/require` with the
compute frame's transform rule and CDN URL scheme; `https://cdn.jsdelivr.net/npm/<pkg>`
maps to the package in local `node_modules`, and a package that is not
installed fails with the frame's `failed to load module <name>` /
`file not found <url>` text. `@jscadui/jscad-text` (ESM-only) and
`@jbroll/jscad-anchors` (not installed) fail here though the app serves them.

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
npm run eval -w @jscadui/agent-loop -- --compare eval/results/a.json eval/results/b.json
npm run eval:keyless -w @jscadui/agent-loop
```

| Variable | Meaning |
|---|---|
| `EVAL_PROVIDER` | provider kind: `anthropic`, `openai`, `opencode-go`, `meta` |
| `EVAL_MODEL` | model id |
| `EVAL_API_KEY` | provider key; with `EVAL_PROVIDER=meta` and no key, `providers.meta.api_key` and `api_base_url` come from `~/.config/muse/auth.json` |
| `EVAL_BASE_URL` | provider base URL, without `/v1` |
| `EVAL_RUNS` | runs per fixture, default 5 |
| `EVAL_FIXTURES` | comma-separated fixture names to run, default all |
| `EVAL_VERBOSE` | `1` prints each run turn by turn: the header and prompt, tool calls with full input, tool results, and streamed assistant text |

Each run is graded on discipline, recovery, geometry and conservation (0-2
each) and on `firstAttemptFailures`: the failed tool results before the first
successful `eval`, or before the end of the run if none succeeds. The summary
gives, per fixture, the mean `firstAttemptFailures`, the pass rate of its
geometry checks, the mean total and the count of runs that ended in a
provider error. Each result file, `eval/results/<date>-<model>-<sha8>.json`,
records the SHA-256 of the assembled system prompt, so `--compare` can set two
prompt versions side by side. The file is rewritten after every run, so an
interrupted eval keeps every run that finished. Each result also carries `transcript`, the run's
messages minus the system prompt, for tracing a stumble back to the tool calls
that caused it. The eval prints one line per run as it goes. The key is never
printed or written.

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params }), transcript?, files? }`.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses.

## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and keep the change only when the eval shows fewer first-attempt failures on
the new fixtures and no fixture's mean total falls by more than 0.5.
