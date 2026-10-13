# Project-files recency (API16)

## Problem

`buildMessages` ranks the project-files block by the paths in the transcript's
assistant `toolCalls` (`packages/agent-loop/src/context.js`, `mentionedPaths`).
When the block is over `PROJECT_BUDGET`, the most recently mentioned files are
kept and the rest dropped; with no mentions the trim falls back to alphabetical
order.

The app's stored transcript never carries `toolCalls`. `reply()`
(`apps/jscad-web/src/aiChat.js`) builds `{ role, content, [stopped], [reasoning] }`
and the value `runTurn` returns — which does contain the loop's tool-call turns —
is discarded. So in production the block is always trimmed alphabetically, and
the recency ordering is inert. `mentionedPaths` even lists `toolCalls` as its
source, which no stored turn provides.

The eval has the same gap: it rebuilds `prior` each turn with text only
(`packages/agent-loop/eval/run-eval.js`), so its `buildMessages` input never
carries mentions either. Only the eval's graded transcript keeps `toolCalls`.

Just storing `toolCalls` on the turn is not enough: the provider adapters
serialize an assistant `toolCalls` turn into a real `tool_use` / `tool_calls`
block, and an assistant tool call with no matching tool result is rejected by
Anthropic and OpenAI. The app stores no tool-result turns, so a forwarded
`toolCalls` field would produce malformed requests.

## Design

A transcript message gains one optional field:

```js
{ role: 'assistant', content: '...', mentions: ['src/frame.js', 'main.js'] }
```

`mentions` is the list of project-file paths the turn's tools touched, in call
order, duplicates kept. It is the recency source and nothing else. The three
provider adapters rebuild every message from named fields
(`providers.js` `toAnthropicMessage` / `toOpenAIMessage`, `responses.js`
`toResponsesInput`), so `mentions` never reaches an API.

### Flow

- **Live turn.** `handleTool` pushes `input.path` (when it is a string) onto a
  per-turn list. `reply()` attaches the list as `mentions`. `commit` persists
  it, and it lives in `transcript` like any other field.
- **Next turn.** `buildMessages` receives the prior transcript through
  `forModel`, which forwards `mentions`. `mentionedPaths` collects them in
  message order; `filesSection` keeps the most recent when the block is over
  budget. Output order stays alphabetical — recency only decides membership.
- **Resume / project switch.** `mentions` round-trips through local IndexedDB
  and rowboat unchanged (`Conversation.messages` is `z.array(z.unknown())`), so
  recency survives a reload.
- **Eval.** Each turn derives the same path list from the loop's new messages
  and adds `mentions` to its `prior` assistant entry, so the eval prompt mirrors
  production.

### Decisions

- `mentionedPaths` reads `m.mentions` and keeps its `m.toolCalls` branch. The
  eval feeds it the loop's output, whose assistant turns carry `toolCalls`;
  build inputs carry `mentions`. One function covers both shapes.
- A path is recorded on every path-bearing call, regardless of the tool's
  result. This matches today's `mentionedPaths`, which does not inspect results.
  A deleted file is absent from `files` and cannot be ranked anyway.
- No separate recency store. The list rides on the messages, so it is trimmed by
  the same budget and persisted by the same path as the rest of the transcript.
- A turn that produces no assistant text commits nothing today, so it
  contributes no `mentions` in either the app or the eval. Consistent, and the
  only cost is one turn's recency.

## Changes by file

### `packages/agent-loop/src/context.js`

`mentionedPaths` grows a `mentions` branch and keeps the `toolCalls` branch:

```js
export const mentionedPaths = (transcript) => {
  const paths = []
  for (const m of transcript) {
    for (const path of m.mentions ?? []) {
      if (typeof path === 'string') paths.push(path)
    }
    for (const call of m.toolCalls ?? []) {
      if (typeof call.input?.path === 'string') paths.push(call.input.path)
    }
  }
  return paths
}
```

Export it: `packages/agent-loop/index.js` adds `mentionedPaths` to the
`./src/context.js` export line.

### `apps/jscad-web/src/aiChat.js`

- `forModel` forwards `mentions` instead of `toolCalls`; its comment is updated.
- A module-scope `let turnMentions = []` sits beside `turnReasoning`.
- `runTurnLocal` resets it when it resets `turnReasoning`.
- `handleTool` records `input.path` when it is a string.
- `reply` adds `mentions` when the list is non-empty. A stopped turn keeps the
  mentions of the calls it already made.

### `packages/agent-loop/eval/run-eval.js`

Import `mentionedPaths`. The rebuilt `prior` assistant entry carries the paths
from that turn's new loop messages:

```js
const mentions = mentionedPaths(turnMessages.slice(messages.length))
prior = [...prior, { role: 'user', content: message },
  ...(reply ? [{ role: 'assistant', content: reply, ...(mentions.length > 0 ? { mentions } : {}) }] : [])]
```

### Provider adapters

No change. They already drop unknown fields.

## Tests

- `packages/agent-loop/test/context.test.js`: keep the `toolCalls`-based trim
  tests (the eval path) and add one carrying `mentions`, asserting the same
  membership under a forced `projectBudget`.
- `apps/jscad-web/test/aiChat.test.js`: rewrite the stored-conversation test
  (`:791`) to store `mentions` and expect it forwarded; add a live-turn test
  that a `write`/`read` records a mention and a pathless tool (`list`) does not.
- `packages/agent-loop/eval/followups.test.js`: the second-turn expectation
  (`:42`) gains `mentions: ['main.js']`.
- `packages/agent-loop/test/providers.test.js`: one test sending a message with
  `mentions` through anthropic, openai and responses, asserting the posted body
  has no `mentions`.

## Docs

- `apps/jscad-web/docs/architecture.md` and
  `packages/agent-loop/docs/architecture.md`: the recency paragraph names
  `mentions` as the source and `forModel` as what forwards it.
- `packages/agent-loop/docs/user-manual.md`: `buildMessages` ranks by `mentions`
  (or `toolCalls`); the eval follow-up paragraph stops saying tool calls are
  left out of `prior`.
- `docs/backlog.md`: delete the API16 bullet and its Finding-ID row.
