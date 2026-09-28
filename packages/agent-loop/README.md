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
