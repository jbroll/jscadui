# Chat feedback loop

Record every jscad-chat conversation, and improve the system prompt and its
examples against an eval that reproduces the stumbles users hit. The first
target is the import mistakes seen on "A single sphere" with Meta Muse 1.3
contributor.

## Scope

1. Conversation log in the local launcher relay.
2. A log reader that rebuilds conversations.
3. An eval harness that runs model code the way the app does, with a
   first-attempt failure metric.
4. `prompt.md` as the single prompt source, plus separate example files.
5. Conversation context: prior turns under a size budget, plus the current
   project files.
6. A `chat-review` project skill that runs the improvement loop.

Out of scope: logging in the production relay (`server/src/relay`), other
models in the eval, and trimming project files for large projects (backlog).

## 1. Relay log

`apps/jscad-web/scripts/local/relay.js` appends one JSONL record per
forwarded request to `~/.local/state/jscad-chat/logs/YYYY-MM-DD.jsonl`
(`$XDG_STATE_HOME` when set). The directory is created on first write.

Record fields:

| field | value |
|---|---|
| `ts` | ISO time the request arrived |
| `chatId` | `x-jscad-chat-id` request header, or `null` |
| `kind` | provider name from the relay path |
| `path` | upstream sub-path, e.g. `v1/chat/completions` |
| `status` | upstream HTTP status |
| `request` | parsed JSON body with `tools` removed; the raw string if it does not parse |
| `response` | the upstream response body as text (SSE or JSON) |
| `ms` | time from request to end of response |

GET requests (model listing) are not logged. Headers are never logged, so
API keys never reach the file. The response is teed while streaming, so the
browser sees no added latency. A write failure prints one warning and never
fails the request.

The browser sends `x-jscad-chat-id` with every provider request. Its value
is the per-project id `aiChat.js` already keeps in `sessions`. The header is
not in the relay's `FORWARD` set, so it never reaches the provider. The
production relay forwards by the same kind of allowlist and drops it as well.

Logging is on by default in the launcher relay. `JSCAD_CHAT_LOG=0` turns it
off, and `JSCAD_CHAT_LOG=<dir>` moves it.

## 2. Log reader

`packages/agent-loop/log/read-log.js` exports
`readConversations(dir, { since })`. It groups records by `chatId` (records
without one become single-request conversations) and orders them by `ts`.
Each request already carries the full message list for its turn, so the last
request of a turn plus its parsed response gives the turn's whole exchange.
Responses are parsed with the stream parsers in `src/providers.js` and
`src/responses.js`, exported for this purpose, so there is one SSE parser per
protocol.

Output per conversation: `{ chatId, model, turns: [{ user, steps, final }] }`,
where each step is an assistant tool call with its tool result, and a failed
step has `ok: false` with the error message.

A CLI, `node packages/agent-loop/log/read-log.js [--since ISO] [--json]`,
prints a readable summary: one block per conversation, each failed tool call
with its error message and the source that caused it.

## 3. Eval harness

### Runner

`eval/backend.js` drops its `new Function` and CommonJS shim. `eval` and
`writeModel` run the source through `@jscadui/require` with the same
transform and bundle aliases the compute frame uses, as the CLI runner in
`packages/openscad` does in Node. `https://cdn.jsdelivr.net/npm/<pkg>` URLs
resolve to the package in local `node_modules`. A package that is not there
fails with the error text the frame gives for a failed CDN fetch. The model
sees the same failures in the eval as in the app.

### Metric

`grade.js` adds `firstAttemptFailures`: the number of failed tool results
before the first successful `eval`, or before the end of the run if none
succeeds. The existing four dimensions stay.

`run-eval.js` runs each fixture `EVAL_RUNS` times (default 5) and reports,
per fixture, the mean `firstAttemptFailures`, the pass rate of its geometry
checks, and the mean total score. Each result file records the SHA-256 of
the assembled system prompt, so two prompt versions can be compared by file.

`--compare <a.json> <b.json>` prints a per-fixture table of the two runs.

### Credentials

When `EVAL_API_KEY` is unset and `EVAL_PROVIDER=meta`, `run-eval.js` reads
`providers.meta.api_key` and `providers.meta.api_base_url` from
`~/.config/muse/auth.json`. The key is never printed or written to results.

### Fixtures

New fixtures, each a short prompt of the kind a first-time user types, with
geometry checks:

- `single-sphere`: "A single sphere"
- `rounded-box`: "A 30 by 20 by 10 box with rounded edges"
- `cylinder-param`: "A cylinder with a slider for its height"

`cube-hole`, `gear` and `bracket` stay. `run-eval.js` loads every file in
`eval/fixtures/` instead of a fixed import list, so the review skill adds a
fixture by adding a file.

## 4. Prompt source

`packages/agent-loop/prompt.md` is the only copy of the prose.
`packages/agent-loop/prompt/examples/*.js` hold example models, each
starting with a one-line comment naming the request it answers.
`src/prompt.js` assembles `SYSTEM_PROMPT` as `prompt.md` followed by an
`## Examples` section with each example in a fenced block, in file-name
order.

Loading the text files:

- Web bundle: esbuild's `text` loader for `.md`, and an import of each
  example with `?raw` handled by a small esbuild plugin in
  `apps/jscad-web/src_build/`.
- Node (eval, log reader): a module loader hook,
  `packages/agent-loop/text-loader.js`, registered with `--import`.
- Vitest: a small plugin in the agent-loop vitest config.

The existing drift test is deleted along with the copy.

`prompt.md` gains an Imports section listing the packages the runtime serves
and the exact import form for each. The first examples are two or three
short models from the repo's JSCAD examples that use those imports.

## 5. Conversation context

`aiChat.js` builds each turn's messages as:

1. The system prompt.
2. Prior turns, newest first, whole turns only, until the next turn would
   exceed `CONTEXT_BUDGET` characters (24,000). A turn is the user message
   and the final assistant text, which is what the transcript stores.
3. A user message holding the current project files, each under a
   `### <path>` heading in a fenced block. It is outside the budget and
   omitted when the project is empty.
4. The new user message.

The budget and the assembly are a pure function in `packages/agent-loop`,
`buildMessages({ systemPrompt, transcript, files, message, budget })`, so
the eval uses the same assembly. Fixtures can then supply prior turns and
files to test follow-up requests.

## 6. `chat-review` skill

`.claude/skills/chat-review/SKILL.md`. It runs when asked to "review the chat
logs". Steps:

1. Read conversations since the time in
   `~/.local/state/jscad-chat/last-review`, using the log reader.
2. For each conversation, list the stumbles: failed tool calls, turns where
   the user corrected the model, and turns that ended without a
   `writeModel`.
3. Group stumbles with the same cause across conversations.
4. For each group, add a fixture that reproduces it, then run the eval on
   the current prompt to confirm the fixture fails as seen in the log.
5. Draft a prompt or example change. Use `llm-application-dev`'s
   `prompt-engineering-patterns` skill, especially its few-shot reference.
6. Run the eval on the candidate. Keep the change only if mean
   `firstAttemptFailures` drops on the new fixtures and no fixture's mean
   total score falls by more than 0.5.
7. Show the user the diff and the comparison table. On approval, commit the
   prompt, examples, fixtures and result files together, and update
   `last-review`.

The skill never edits code outside `packages/agent-loop/prompt*`,
`prompt/examples/` and `eval/fixtures/`. A stumble whose cause is in the
runtime or tools goes to `docs/backlog.md` instead.

## Testing

- Relay: a unit test posts through the handler to a stub upstream and checks
  the JSONL record, that no header is written, that GETs are skipped, and
  that `x-jscad-chat-id` is not forwarded.
- Log reader: fixtures of recorded SSE for each protocol, checked against
  the rebuilt conversation.
- Harness runner: a model importing `@jscad/modeling` runs; one importing a
  missing package fails with the frame's error text.
- `buildMessages`: budget boundary, whole-turn dropping, newest message
  always present, files block present and outside the budget.
- Prompt assembly: `SYSTEM_PROMPT` contains `prompt.md` and every example.

## Documentation

- `apps/jscad-web/docs/architecture.md`, Agent loop: context assembly and
  the relay log.
- `apps/jscad-web/docs/user-manual.md` or the launcher docs: where logs go
  and `JSCAD_CHAT_LOG`.
- `packages/agent-loop` README: eval usage, metric and the review loop.
- `docs/backlog.md`: trim project files by most recent mention when
  projects grow; production relay logging with opt-in.
