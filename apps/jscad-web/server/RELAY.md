# Relay operator notes

The relay (`src/relay/`) forwards user-keyed provider requests and streams
responses back. It stores nothing: no DB rows, no logs with secrets.

The access rules below live in `src/relay/policy.js`, plain JS with JSDoc and
only `node:` imports. `tsc` type-checks it (`allowJs`, `checkJs`) and emits it
into `dist/relay/`, and the `jscad-chat` launcher's relay
(`../scripts/local/relay.js`) imports the same file under plain `node`, so the
two relays cannot drift. `routes.ts` (Express wiring) and `allowlist.ts` (file
read, missing-file fallback) are the server's adapter.

## Allowlist file

JSON `{kind: upstreamBase}`, default `/etc/jscad-relay/providers.json`,
override with `RELAY_ALLOWLIST`. Entries must be public `https:` URLs without
ports; re-read at most every 5s, so edits apply without restart. When the file
does not exist the relay serves the built-in table below
(`PROVIDER_BASE_URLS` in `src/relay/policy.js`, a copy of agent-loop's
table in `packages/agent-loop/src/providers.js` that
`test/relay-allowlist.test.ts` checks against it); any other read or parse
failure is a `500`.

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com", "opencode-go": "https://opencode.ai/zen/go", "meta": "https://api.meta.ai" }
```

## Access rules

- Browser `Origin` must be in the server's trusted origins; else `403`. A
  request with no `Origin` passes only with `Sec-Fetch-Site: same-origin`,
  which is how a browser sends a GET from the app's own origin.
- `POST` and `GET` are forwarded; `GET` carries the model-list fetch.
- Per-IP token bucket, 60 req/min, burst 10; over limit is `429` with
  `Retry-After`. The launcher uses the same limiter with a burst of 60, since
  its one user's agent loop can send steps back to back.
- The provider name must be an own key of the allowlist (`constructor` is a
  `404`). The sub-path is joined to the base and refused (`400`) when the
  resulting URL leaves the base path, which catches `..`, `%2e%2e` and
  backslash forms.
- The upstream host is resolved at forward time, and any loopback, private,
  link-local, CGNAT or unspecified address (`0/8`, `10/8`, `100.64/10`,
  `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `::`, `::1`, `fc00::/7`,
  `fe80::/10`, and IPv4-mapped or NAT64 forms of the IPv4 ranges) is a `400`.
  A name that does not resolve is a `502`.
- No session required; the caller's provider key rides the request through.
- Only `content-type`, `accept`, `authorization`, `x-api-key`,
  `anthropic-version`, `anthropic-beta` and `x-opencode-session` go upstream.
  The app shares the relay's origin, so the session cookie, `origin`,
  `referer` and forwarding headers must stay behind.

## Shared (demo) options

The demo provider serves operator-owned keys to visitors with no account. JSON
`{monthlyUsd, perIpDailyUsd, options}`, default `/etc/jscad-relay/shared.json`,
override with `RELAY_SHARED`; keep it mode `0600`, owned by the service user,
beside `providers.json`. Stage the real keys locally in
`server/shared.local.json` (same schema, gitignored, never commit) and copy
that file to the host path. Re-read on the same 5s cache, so an edit applies
without a restart. A missing file means no demo options; any other read or
parse failure hides demo (the list answers `[]`, a turn is a `500`), so a bad
file never silently forwards.

```json
{
  "monthlyUsd": 5,
  "perIpDailyUsd": 0.1,
  "options": [
    {
      "id": "deepseek-flash",
      "label": "DeepSeek v4 flash",
      "kind": "opencode-go",
      "path": "v1/chat/completions",
      "model": "deepseek-v4-flash",
      "key": "sk-...",
      "maxTokens": 8192,
      "inputUsdPerMTok": 0.28,
      "outputUsdPerMTok": 0.42
    }
  ]
}
```

Each option pins one kind, model and endpoint. Loading refuses a kind other
than `opencode-go` or `meta` (both take `authorization: Bearer`), a model that
needs the messages protocol (a bearer key cannot serve it), and a `path` other
than the one endpoint that kind and model use in
`packages/agent-loop/src/providers.js`; `id`s must be unique. Both prices are
the provider's per-million-token pay-as-you-go rates, required and positive;
they price the meter. `monthlyUsd` (default 5) and `perIpDailyUsd` (default
0.1) default when absent.

Routes (both pass the origin check and mount before `/api/relay/:kind/*splat`):

- `GET /api/relay/shared` returns `[{id, label, kind, model, available}]`,
  never keys or prices. `available` is false once the month's budget is spent,
  and the client lists it disabled with `(monthly limit reached)`.
- `POST /api/relay/shared/:id/*splat` serves one option. The sub-path must be
  the option's own (`404` otherwise). The budgets are checked (`402` with
  `{error: {code: 'shared_quota_exhausted', scope, message}}`, `scope` of
  `month` or `day`), and a third request in flight from one IP group is `429`
  with `Retry-After: 2`. The body is rewritten: `model` is pinned, `stream` is
  `true`, `max_tokens` (chat completions) or `max_output_tokens` (responses) is
  the smaller of the client's and `maxTokens`, and chat completions ask for
  `stream_options.include_usage`. The client's `authorization`/`x-api-key` are
  dropped and the option's key goes upstream as `authorization: Bearer <key>`.

### Meter

Spend is one JSON file, default `./data/relay-spend.json`, override with
`RELAY_SPEND_PATH`: the month's total and each IP group's spend for the current
UTC day, so a restart does not hand out the budget again. The group is the
whole IPv4 address or the `/64` of an IPv6 address, since one household or
phone can use a whole `/64`. A turn is charged from the stream's `usage` (or
estimated from bytes when it carried none) at the option's prices, and is
written atomically (temp file + rename). A corrupt or unreadable file stops the
relay rather than resetting the meter; a failed write warns and keeps spend in
memory.

## Chat logs

Both relays log conversations to a per-day JSONL file, one record per relayed
POST: `{ts, chatId, kind, path, status, request, response, ms}`, plus `shared`
and `costUsd` for a demo turn. The request body drops `tools` (large and
re-derivable). The production relay's directory is `CHAT_LOG_DIR`, default
`./data/chat-logs`; `0` turns logging off. It keeps `CHAT_LOG_RETAIN_DAYS`
(default 90) day files and prunes the rest. An own-key turn is written only
when the request carries `x-jscad-chat-id`, which the client omits when the
user opts out; a demo turn is always written. A failed write warns and never
fails the request it describes.

## Logs and smoke

Each forwarded turn logs one JSON line: `{relay, status, bytes}`, and a shared
config that cannot be read logs `{relay: 'shared-config-error', message}`.
Deploy smoke (`e2e/smoke-deploy.mjs`) POSTs from a fake origin and expects
`403`.
