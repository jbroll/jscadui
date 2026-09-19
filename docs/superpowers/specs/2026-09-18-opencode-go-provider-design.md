# opencode-go provider — design

Date: 2026-09-18. Status: all sections approved in brainstorming.

## Goal

Offer OpenCode Zen Go (`opencode-go`, OpenAI-compatible at
`https://opencode.ai/zen/go/v1`) as a provider option everywhere the app
already offers `anthropic` and `openai`, without duplicating wire code.

## Background

Both provider stacks already speak OpenAI-compatible chat completions:
`packages/agent-loop/src/providers.js` (browser-local loop) and
`apps/jscad-studio/server/src/providers/` (`openaiCompatible.ts` adapter
behind `ProviderKind`). Provider kind currently appears in those two
switches, the jscad-web account dropdown (`aiAccount.js`), the studio chat
selection key, the relay kind→upstream allowlist, and the eval harness
(`EVAL_PROVIDER`). Studio has no picker UI writing its selection key, so it
needs no UI change.

## 1. Kind resolution: lookup table, no fallbacks

Each stack gains an explicit provider→base-URL lookup (a routing table,
not a silent default):

```js
{ anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', 'opencode-go': 'https://opencode.ai/zen/go' }
```

Table values are the URL *before* the adapter's `/v1/...` suffix: both
adapters append `/v1/messages` or `/v1/chat/completions`, and Zen's
documented base (`.../zen/go/v1`) already contains that segment, so the
table entry omits the trailing `/v1`.

`createProvider({ kind, model, apiKey, baseUrl })` resolves
`baseUrl ?? table[kind]`, maps `opencode-go` to the existing
openai-compatible adapter, and throws on unknown kind. Error prefix stays
`openai:` for the alias (it is the OpenAI protocol).

Keys are strictly caller-supplied: browser key-store attached per request,
server uses the posted per-turn key and never stores one, eval uses
explicit `EVAL_API_KEY`. No `*_API_KEY` env reads in library or server
code, and none are added.

Go requires an `x-opencode-session` header per conversation: both
openai-compatible adapters send one for kind `opencode-go` (explicit
`sessionId` config wins, else a per-provider `crypto.randomUUID()`).
Only `chat/completions`-served models work through this adapter; models
served on `/v1/responses` or `/v1/messages` (e.g. Muse Spark, Qwen, MiniMax)
need their own adapter, out of scope here.

## 4. Endpoint notes (from live probing 2026-09-19)

- Go serves three protocols per model: `/v1/chat/completions`
  (DeepSeek, Kimi, GLM, LongCat, MiMo, Hy), `/v1/responses` (Grok 4.6,
  GPT 5.6 Luna, Muse Spark contributor tiers), `/v1/messages`
  (MiniMax, Qwen, all `*-max`/`*-plus`). Hitting the wrong one fails
  (500 on Spark via chat/completions).
- Missing `x-opencode-session` fails the request outright
  (`MissingSessionID`, 400).
- Free-tier models (`*-free` on the main `zen/v1` endpoint) are gated to
  validated opencode clients (`FreeTierError`, 403): unreachable from a
  raw harness. Paid Go enforces per-model monthly limits
  (`GoUsageLimitError`, 429).
- Docs: `https://opencode.ai/docs/go/`.

## 2. Surfaces

- agent-loop `createProvider`: accept `opencode-go` via the table.
- Server `ProviderKind`: add `opencode-go`, same alias treatment.
- jscad-web account panel: dropdown gains `opencode-go`; model
  placeholder switches to a Zen model id; no auto-fill; key handling
  unchanged.
- Relay: `RELAY.md` example gains the `opencode-go` upstream entry;
  the operator applies it to the allowlist file. Browser turns keep
  flowing through `/api/relay/<kind>`.
- Eval: `EVAL_PROVIDER=opencode-go` with `EVAL_MODEL` and `EVAL_API_KEY`;
  no harness change needed beyond the agent-loop alias.

## 3. Tests (keyless)

- agent-loop `providers.test.js`: table resolves all three kinds
  (Zen URL asserted), explicit `baseUrl` override wins, unknown kind
  throws, missing key throws.
- Server provider tests mirror the same cases.
- No live-key tests; the live eval run stays manual.

## Non-goals

New wire adapters, model catalogs, server-side default keys, CI live runs.
