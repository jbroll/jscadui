# Chat logging and shared keys

Record jscad.rkroll.com chat conversations so the `chat-review` loop can learn
from real sessions, and offer two shared provider keys that anyone can use
without bringing their own, with every conversation on them logged.

Paths are under `apps/jscad-web` unless given in full.

## Decisions

- Logging is on by default for every chat that goes through the production
  relay. A user on their own key can opt out. A user on a shared key cannot.
- Two shared keys to start: DeepSeek v4 flash through the existing
  `opencode-go` key, and Muse Spark 1.3 on a new Meta key.
- Spend on the shared keys is capped at $5 per calendar month (UTC), in total
  across both keys, and at a per-IP daily dollar budget. The relay meters the
  spend itself from each response's token usage.
- Shared keys need no sign-in. The IP budget is the per-person limit.
- Logs stay on the server host. A script pulls them into the private
  `jscad-chat-evals` repo on demand.
- The `jscad-chat` launcher keeps its current behavior: it logs every relayed
  POST to the user's own disk and ignores the opt-out.

## Phase 1: production logging

### Shared log module

Move `scripts/local/chatLog.js` (and its test) to
`server/src/relay/chatLog.js`, plain JS with JSDoc like `policy.js`, so the
server and the launcher write the same JSONL from one file. The launcher
imports it from there as it already does `policy.js`. The record format does
not change, so `packages/agent-loop/log/read-log.js` and the `chat-review`
skill read production logs unchanged. Phase 2 adds two optional fields,
`shared` and `costUsd`.

The tee that builds the record (`ts`, `chatId`, `kind`, `path`, `status`,
`request` without `tools`, response text, `ms`, `error`) moves out of
`scripts/local/relay.js` into the same module as a helper both relays call,
so the two cannot drift.

### Production relay

`server/src/relay/routes.ts` logs a POST when the request carries
`x-jscad-chat-id`, and only then. It still does not forward that header.
Headers are never written, so a user's key never reaches the log.

The relay also aborts the upstream request when the page closes the
connection, as the launcher does. Without it a closed tab keeps a provider
generating, which Phase 2 would pay for.

Logs go to `CHAT_LOG_DIR`, default `./data/chat-logs` in production next to
`auth.db`, one `YYYY-MM-DD.jsonl` per UTC day. `CHAT_LOG_DIR=0` turns logging
off. At startup and once a day the server deletes files older than
`CHAT_LOG_RETAIN_DAYS` (default 90). A failed write warns once and never fails
the request, as in the launcher.

### Opt-out

The chat sends `x-jscad-chat-id` today whenever it goes through the relay
(`src/aiChat.js:317`). It now also omits the header when the user has opted
out, so the server rule above is the whole mechanism.

- The gear dialog (`src/aiAccount.js`) gets a checkbox, "Save my chats to help
  improve the assistant", checked by default. The choice is stored in
  `localStorage['jscad-ai.log']` as `off` when unchecked. Absent means on.
- The chat drawer shows one line above the input while logging is on: "Chats
  are saved to improve the assistant. Turn this off in Chat settings." The
  line links to the dialog. With logging off it is hidden. With a shared key
  selected it reads "Chats on shared keys are always saved to improve the
  assistant." and the checkbox is checked and disabled.
- A custom base URL skips the relay and is never logged, as today.

### Client address

`server/src/index.ts:69` sets `trust proxy` to `true`, so `req.ip` is the
leftmost `X-Forwarded-For` entry, which the client controls. Set it to
`'loopback'`: Express then takes the address Apache appended, the real
client. `createLimiter` (`server/src/relay/policy.js`) drops a bucket once it
has been full for a minute, checked on each call, so the map cannot grow
without bound. This removes the relay part of the rate-limit item in
`docs/backlog.md`. The better-auth IP header part stays there.

### Pulling logs

`scripts/pull-chat-logs.sh` rsyncs the host's log directory into
`<jscad-chat-evals>/logs/prod/`, resolving the evals clone the way
`chatDataDir` does (`~/src/jscad-chat-evals` or `$JSCAD_CHAT_DATA`) and the
host from `server/deploy.conf`. The `chat-review` skill reads `logs/prod/`
beside the launcher's `logs/`.

## Phase 2: shared keys

### Configuration

`/etc/jscad-relay/shared.json` (`RELAY_SHARED` overrides the path), mode 0600,
owned by the service user, beside the existing `providers.json`:

```json
{
  "monthlyUsd": 5,
  "perIpDailyUsd": 0.10,
  "options": [
    {
      "id": "deepseek-flash",
      "label": "DeepSeek v4 flash",
      "kind": "opencode-go",
      "path": "v1/chat/completions",
      "model": "deepseek-v4-flash",
      "key": "sk-...",
      "maxTokens": 8192,
      "inputUsdPerMTok": null,
      "outputUsdPerMTok": null
    },
    {
      "id": "muse",
      "label": "Muse Spark 1.3",
      "kind": "meta",
      "path": "v1/responses",
      "model": "muse-spark-1.3",
      "key": "...",
      "maxTokens": 8192,
      "inputUsdPerMTok": null,
      "outputUsdPerMTok": null
    }
  ]
}
```

The operator replaces the two `null` prices per option with the provider's
published pay-as-you-go rates. Loading refuses a missing, null or zero price, a kind
other than `opencode-go` or `meta` (both take `authorization: Bearer`), and a
`path` other than the one endpoint that kind and model use in
`packages/agent-loop/src/providers.js`. A missing file means no shared
options. The file is re-read on the same 5-second cache as the allowlist.

### Routes

Both mount before the existing `/api/relay/:kind/*splat` and pass the same
origin check.

- `GET /api/relay/shared` returns
  `[{ id, label, kind, model, available }]`, never the key or prices.
  `available` is false once the month's budget is spent.
- `POST /api/relay/shared/:id/*splat` serves one option:
  1. Refuse a path other than the option's `path` (404) and a body over the
     100 KB `express.json()` limit already in place.
  2. Check the budgets (below). Refuse a third request in flight from the same
     IP group with 429 and `Retry-After: 2`. agent-loop retries a 429, which
     suits a concurrency limit.
  3. Rewrite the body: `model` is the option's model, `stream` is `true`,
     `max_tokens` (chat completions) or `max_output_tokens` (responses) is
     the smaller of the client's value and `maxTokens`, and chat completions
     get `stream_options.include_usage: true`. Everything else, tools and
     effort included, passes through.
  4. Drop the client's `authorization` and `x-api-key` and send
     `authorization: Bearer <key>` upstream.
  5. Stream the response back, teeing it for the log and the meter, and abort
     upstream if the page closes.
  6. Always write the log record, with `shared: <id>` and `costUsd`, whether
     or not the request carried a chat id.

The upstream host comes from the allowlist entry for the option's kind,
through `resolveTarget`, so the private-address check still applies.

### Meter

`server/src/relay/meter.ts`, one instance per server process.

- **State:** the current month (`YYYY-MM`) and its spend, the current UTC day
  and the spend per IP group that day. An IP group is the full IPv4 address,
  or the /64 prefix of an IPv6 address, since one household or phone can use a
  whole /64. The state is written to `./data/relay-spend.json` (temp file then
  rename) after every charge, so a restart does not reset it. A day or month
  rollover clears the old counters. IPs are kept only for the current day and
  never written to the chat log.
- **Check before forwarding:** refuse when the month's spend has reached
  `monthlyUsd` or the IP group's spend has reached `perIpDailyUsd`. The answer
  is 402 with
  `{ "error": { "code": "shared_quota_exhausted", "scope": "month" | "day", "message": "..." } }`.
  agent-loop does not retry a 402 or that code.
- **Charge after the response:** read token usage from the streamed text. Chat
  completions carry it in the final chunk's `usage.prompt_tokens` and
  `usage.completion_tokens`, responses in the `response.completed` event's
  `response.usage.input_tokens` and `output_tokens`. Both output counts
  include reasoning tokens. Cost is
  `input × inputUsdPerMTok / 1e6 + output × outputUsdPerMTok / 1e6`, charged
  to both the month and the IP group. Cached-input discounts are ignored, so
  the meter overcounts rather than under.
- **Missing usage:** when a stream ends without usage (the page closed, the
  stream failed), charge an estimate of one token per 3 bytes of request body
  and of streamed text. A provider bills for what it generated before the
  abort, so charging nothing would let repeated aborts run free.

Checks happen before the cost is known, so the month can overshoot by at most
the in-flight requests' cost: two per IP group, each capped at `maxTokens`
of output.

The shared keys still let anyone with curl use DeepSeek or Muse for free
within the budgets, with any prompt, since the relay passes the conversation
through. The budgets bound the cost of that, not the use.

### Client

- `src/aiAccount.js` fetches `GET /api/relay/shared` when the dialog opens and
  adds each option to the Provider select as "Shared: <label>". Choosing one
  hides the key, custody and base URL fields and the model controls, shows
  the fixed model, and keeps the effort select, filled by `aiEffort.js` for
  the option's kind and model. An option with `available: false` is listed
  but disabled, with "monthly limit reached".
- The selection stores `shared: <id>` along with `kind` and `model`.
  `persistSelection` carries it. `getProviderConfig` returns the config with
  `apiKey: 'shared'` so the fail-closed check passes. The server ignores the
  value.
- `relayBaseUrl` gets the shared id and returns `/api/relay/shared/<id>` for
  it. The model-list GET is skipped for a shared selection.
- `src/aiChat.js` shows a `shared_quota_exhausted` error as its message plus
  "Add your own key in Chat settings to keep going." instead of the raw
  status and body.
- `scripts/local/relay.test.js` keeps checking that the dialog's provider list
  matches the allowlist. Shared options are not in that list.

## Operator setup

1. Get the Muse key and set any spend cap Meta's console offers as a backstop.
   Do the same for the `opencode-go` key if its console allows one.
2. Write `/etc/jscad-relay/shared.json` with both keys and their prices, mode
   0600.
3. Deploy. Check that `GET /api/relay/shared` lists both options, and that a
   chat turn on each writes a record with `shared` and a non-zero `costUsd`.

## Testing

Server tests in `server/test/`, under vitest with injected `fetchFn`,
`dnsLookup` and clock:

- Logging: a POST with a chat id writes one record, a POST without one writes
  none, a GET writes none, headers are never in the record, and a failed write
  does not fail the request.
- Retention deletes only files older than the limit.
- `trust proxy`: with a loopback peer and `X-Forwarded-For: <forged>, <real>`,
  the limiter keys on `<real>`.
- Limiter eviction: a bucket idle at full is dropped, an active one is kept.
- Shared route: path refusal, body rewrite (model, stream, token cap,
  `include_usage`), client auth dropped and the key injected, the key absent
  from the log and from `GET /api/relay/shared`, always logged without a chat
  id, the third in-flight request refused, upstream aborted on close.
- Meter: usage parsed from both stream shapes, the estimate when usage is
  missing, month and IP refusals with the 402 body, day and month rollover,
  IPv6 /64 grouping, state surviving a reload from the spend file, and config
  refusals (missing price, wrong kind, wrong path).

Client unit tests for the opt-out header, the selection's `shared` field, and
`relayBaseUrl`. `e2e/ai-chat.spec.js` covers the notice line in each of its
three states and choosing a shared option with a stubbed relay.

## Documentation

- `docs/architecture.md` (jscad-web): the relay section's logging paragraph,
  "Logging stays in the local launcher", the chat feedback loop and key
  custody, which now has a server-held key.
- `server/RELAY.md`: the shared routes, the config file and the meter.
- `docs/backlog.md`: delete "Production relay chat logging" in Phase 1, and
  trim the rate-limit security item to its better-auth part.
- `.claude/skills/chat-review/SKILL.md`: the `logs/prod/` directory and the
  pull script.

## Phases

Phase 1 (logging, opt-out, notice, client address, limiter eviction, pull
script) ships and deploys on its own. Phase 2 (shared config, routes, meter,
client option) follows on the same branch or a second one, after the Muse key
exists.
