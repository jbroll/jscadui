# Agent loop parity plan

Date: 2026-10-13. Status: planned, not started.
Scope: `packages/agent-loop` loop vs opencode, pi, Muse, Claude Code.
Branch: `feat/agent-loop-best-practice` (worktree wt5, synced to main `d1279c58`).

## Baseline

`runTurn` in `packages/agent-loop/src/loop.js:153` drives one turn:
provider stream → `text/reasoning/refusal/retry/tool_use/done` events →
append assistant message → run read-only tools in parallel, mutating tools
serially (`loop.js:249,262`) → append one `{role:'tool'}` message per call →
repeat until no tool calls or `DEFAULT_MAX_ROUNDS=32`.

Already at parity: own `while(true)` loop (not SDK auto-loop), streamed
event normalization, bad-JSON args → model-facing `ArgumentsError`
(`toolArguments.js:16`), unknown tool → `UnknownToolError` result
(`dispatchTool.js:26`), `fetchWithRetry`/`streamWithRetry` with 429/5xx +
`Retry-After` + jitter and no-retry-after-reply (`providers.js:90,123`),
cooperative abort via `AbortSignal`, read-only-parallel/mutating-serial.

Sources compared: opencode `session/prompt.ts` + `processor.ts` + `retry.ts` +
`compaction.ts`, pi `packages/agent/src/agent-loop.ts` + `types.ts`,
Meta `dev.meta.ai/docs` (agent loop, tool calling, responses, error
handling, permissions), Claude `platform.claude.com` tool-use docs +
`code.claude.com` agent-sdk (loop, hooks, streaming, compaction).

## T1 — Doom-loop guard

Where: `src/loop.js:187` turn loop.
Hash `(name, stable-stringify(input))` per `runTurn` invocation (sorted
keys; exclude `badCalls`). On 3rd identical call: skip `requestTool`,
write model-facing tool error `DoomLoopError`, resolve
`{messages, rounds, stopped:'doom_loop'}` with `report({phase:'done'})`.
Resets per turn, not across turns.
Closes `docs/backlog.md` doom-loop item (opencode/Muse rule: 3 repeats).
Tests in `test/loop.test.js`: 3x identical → stopped + error fed back;
2x + different 3rd → continues; whitespace-only arg difference hashes equal.

## T2 — Permission hooks

Where: `src/loop.js` options, `src/index.js` exports, `apps/jscad-web/src/aiChat.js:348`.
`runTurn` accepts `beforeToolCall?(name,input)` →
`{allow|deny, reason?, updatedInput?}` and
`afterToolCall?(name,input,result)` → `{result?}`. Order per call:
bad-args check → `beforeToolCall` → `withTimeout(requestTool)` →
`afterToolCall`. Deny becomes `{ok:false,error:{name:'DeniedError'}}`
result, never throws; hook throw → error result (pi `b9cd557` rule).
`dispatchTool.js` unchanged. `aiChat.js handleTool` forwards hooks from
`initChat` options; no approval UI in this branch.
Closes `docs/backlog.md` permission-hooks item (pi `before/afterToolCall`,
Claude `Pre/PostToolUse`, opencode plugin trigger + `ctx.ask`).
Tests: deny blocks `requestTool`, `updatedInput` replaces args, hook
throw → error result, after-hook rewrites result.

## T3 — Graceful max-rounds

Where: `src/loop.js:189`.
Replace bare `resolve({stopped:'max_rounds'})` with one final
`provider.send(messages, [], {toolChoice:'none'})` carrying a max-steps
prompt ("maximum steps reached, answer with text only"), append its text
as the final assistant message, then resolve with `stopped:'max_rounds'`.
Abort/empty during that call resolves without it.
Matches opencode `MAX_STEPS_PROMPT` and Claude `error_max_turns`.
Test: cap hit → provider called with empty tools + `toolChoice none`.

## T4 — Result packing + usage events

Where: `src/providers.js:189`, `src/loop.js:203`.
Batch consecutive `{role:'tool'}` messages into one Anthropic `user`
message with `content=[tool_result...]` before any text (Claude
parallel-use rule; today each maps to its own user message).
OpenAI/Responses pairing by id unchanged.
Forward `{type:'usage'}` parsers already yield (`providers.js:221,343`,
`responses.js:63`) via `onUsage` + `onStatus({phase:'usage'})` instead
of dropping; `aiChat.js` may ignore, eval logs cost.
Tests: two results → one user message, two blocks; usage reaches `onUsage`.

## T5 — Retry + context hardening

Where: `src/providers.js:51`, `src/context.js:83`.
`isRetryableStatus` returns false for context overflow (400 +
`/context|token|too large|maximum context/i`, codes
`invalid_request_error` / `context_length_exceeded`); surface at once so
compaction runs (opencode never retries overflow).
`partitionTranscript`: before evicting whole turns, prune oldest
tool-result contents to `"[Old tool result content cleared]"` (keep the
`tool_use` record), oldest-first until under budget or only last 3 full
results remain (opencode prune / Claude `clear_tool_uses`).
Tests: overflow body fetched once; long transcript keeps recent outputs,
old ones pruned.

## Order

T4 + T5 (wire correctness, no API change) → T1 (isolated) → T3 (builds on
T1 stopped shape) → T2 (API surface). Each lands with its tests.
Delete this file in the final merge commit per repo spec/plan convention.

Verify: `npm run test -w @jscadui/agent-loop`, then `npm run validate`.
