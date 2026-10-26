# Relay operator notes

The relay (`src/relay/`) forwards provider requests and streams responses back.
It stores nothing: no DB rows, no logs with secrets.

The access rules below live in `src/relay/policy.js`, plain JS with JSDoc and
only `node:` imports. `tsc` type-checks it (`allowJs`, `checkJs`) and emits it
into `dist/relay/`, and the `jscad-chat` launcher's relay
(`../scripts/local/relay.js`) imports the same file under plain `node`, so the
two relays cannot drift. `routes.ts` (Express wiring) and `allowlist.ts` (file
read, missing-file fallback) are the server's adapter.

## One endpoint, one hook per kind

There is one relay endpoint family, `POST|GET /api/relay/:kind/*`, for every
provider. `routes.ts` reads the wire `kind` from the path and dispatches to the
hook for that kind (the hook table lives in `src/relay/providers/`, plain JS
with JSDoc like `policy.js`). There is no second route family: the free
jscad-web provider rides this one, dispatched by `kind` like every other.

| hook | kind | behaviour |
| --- | --- | --- |
| `providers/default.js` | every kind but `jscad-web` | passthrough: forward the caller's own key, log a `POST` only when it carries `x-jscad-chat-id` |
| `providers/jscad.js` | `jscad-web` | free specialization: ignore the client's `jscad-web-free` sentinel, serve the catalog `GET`, drop the client key and inject the option's, pin the model and endpoint, meter the turn, always log |

`getHook(kind)` in `providers/index.js` returns the jscad-web hook for the
`jscad-web` wire kind and the default hook otherwise. A free option's underlying
protocol (`opencode-go`, `meta`) is not the hook key: the catalog entry's `kind`
is the upstream protocol, while the client selection's `kind` is `jscad-web`,
which agent-loop routes by model id for its protocol and effort.

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

The rules below are the default hook's. The jscad-web hook applies the same
origin, limiter and private-address checks, but resolves the option's own kind
and drops the caller's key (see Free jscad-web models).

- Browser `Origin` must be in the server's trusted origins; else `403`. A
  request with no `Origin` passes only with `Sec-Fetch-Site: same-origin`,
  which is how a browser sends a GET from the app's own origin.
- `POST` and `GET` are forwarded by the default hook; a `GET` carries its
  model-list fetch. The jscad-web hook serves its own catalog `GET`.
- Per-IP token bucket, 60 req/min, burst 10; over limit is `429` with
  `Retry-After`. The launcher uses the same limiter with a burst of 60, since
  its one user's agent loop can send steps back to back.
- For the default hook the wire kind must be an own key of the allowlist
  (`constructor` is a `404`); the jscad-web hook resolves the option's own
  underlying kind instead. The sub-path is joined to the base and refused
  (`400`) when the resulting URL leaves the base path, which catches `..`,
  `%2e%2e` and backslash forms.
- The upstream host is resolved at forward time, and any loopback, private,
  link-local, CGNAT or unspecified address (`0/8`, `10/8`, `100.64/10`,
  `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `::`, `::1`, `fc00::/7`,
  `fe80::/10`, and IPv4-mapped or NAT64 forms of the IPv4 ranges) is a `400`.
  A name that does not resolve is a `502`.
- No session required; on the default hook the caller's provider key rides the
  request through (the jscad-web hook drops it and injects the option's key).
- Only `content-type`, `accept`, `authorization`, `x-api-key`,
  `anthropic-version`, `anthropic-beta` and `x-opencode-session` go upstream.
  The app shares the relay's origin, so the session cookie, `origin`,
  `referer` and forwarding headers must stay behind.

## Free jscad-web models

The jscad-web hook serves operator-owned keys to visitors with no account. Its
config is JSON `{monthlyUsd, perIpDailyUsd, providers}`, default
`/etc/jscad-relay/jscad-inference.json`, override with `RELAY_INFERENCE`; keep it mode `0600`, owned by
the service user, beside `providers.json`. Stage the real keys locally in
`server/jscad-inference.local.json` (same schema, gitignored, never commit).
Validate it with `node --input-type=module -e "import('./server/src/relay/inference.js').then(m => console.log(m.loadInferenceFile('./server/jscad-inference.local.json').options.map(o => o.id)))"`
from `apps/jscad-web`, then copy it to the host path (no restart; the 5s cache
picks it up):

```sh
ssh john@jscad.rkroll.com 'sudo install -d -m 755 -o root -g root /etc/jscad-relay'
scp apps/jscad-web/server/jscad-inference.local.json john@jscad.rkroll.com:/tmp/jscad-inference.json
ssh john@jscad.rkroll.com 'sudo install -m 600 -o jscad-studio -g jscad-studio /tmp/jscad-inference.json /etc/jscad-relay/jscad-inference.json && rm /tmp/jscad-inference.json'
curl -s -H 'Origin: https://jscad.rkroll.com' https://jscad.rkroll.com/api/relay/jscad-web/v1/models
```

Re-read on the same 5s cache, so an edit
applies without a restart. A missing file means no free options; any other read
or parse failure hides free (the catalog answers `[]`, a turn is a `500`), so a
bad file never silently forwards.

```json
{
  "monthlyUsd": 5,
  "perIpDailyUsd": 0.1,
  "providers": [
    {
      "kind": "opencode-go",
      "key": "sk-...",
      "models": [
        {
          "model": "deepseek-v4.1-flash",
          "maxTokens": 8192,
          "inputUsdPerMTok": 0.30,
          "outputUsdPerMTok": 1.20
        }
      ]
    },
    {
      "kind": "meta",
      "key": "...",
      "models": [
        {
          "model": "muse-spark-1.3-contributor",
          "maxTokens": 4096,
          "inputUsdPerMTok": 1.25,
          "outputUsdPerMTok": 4.25
        }
      ]
    }
  ]
}
```

One provider entry holds one kind and one server key plus the models that
key serves, so adding a model is one object, not a repeated key. A model that
reads images carries `"vision": true` (optional, default false); the catalog
serves it as `capabilities: { vision }` and the app offers those models the
`view` tool. Mark it only for models whose image input you have verified —
an unverified flag hands pixels to a model that cannot read them. The
endpoint is derived from kind and model, never read from the file. Loading
refuses a kind other than `opencode-go` or `meta` (both take
`authorization: Bearer`) and a model that needs the messages protocol (a
bearer key cannot serve it), both in
`packages/agent-loop/src/providers.js`; model slugs must be unique across the
whole file — the slug names the route, the pinned model, and the menu row. Prices are the provider's per-million-token pay-as-you-go
rates — use peak rates so the meter overcounts rather than under; zero is
allowed for a free model, missing or negative is refused. `monthlyUsd`
(default 5) and `perIpDailyUsd` (default 0.1) default when absent. Model
ids are the providers' own: the live Go catalog is
`https://opencode.ai/zen/go/v1/models` (37 models at last check, including
`deepseek-v4.1-flash` and both Muse Spark contributors).

### Catalog and turns

The hook owns both routes; it never proxies the catalog and never returns keys
or prices.

- `GET /api/relay/jscad-web/v1/models` returns
  `[{id, kind, model, available}]` (`id` is the model slug). `available` is false once the month's
  budget is spent, and the client lists it disabled with
  `(monthly limit reached)`.
- `POST /api/relay/jscad-web/<id>/<path>` serves one option: `<id>` is the first
  path segment and the remainder must equal the option's derived `path` exactly
  (`404` otherwise, with no upstream request, so the injected key is never sent
  to find out). The budgets are checked (`402` with
  `{error: {code: 'inference_quota_exhausted', scope, message}}`, `scope` of
  `month` or `day`), and a third request in flight from one IP group is `429`
  with `Retry-After: 2`. The body is rewritten: `model` is pinned to the
  option's, `stream` is `true`, `max_tokens` (chat completions) or
  `max_output_tokens` (responses) is the smaller of the client's and `maxTokens`,
  and chat completions ask for `stream_options.include_usage`. The client's
  `authorization`/`x-api-key` are dropped and the option's key goes upstream as
  `authorization: Bearer <key>`.

### Meter

Spend is one JSON file, default `./data/relay-spend.json`, override with
`RELAY_SPEND_PATH`: the month's total and each IP group's spend for the current
UTC day, so a restart does not hand out the budget again. The group is the
whole IPv4 address or the `/64` of an IPv6 address, since one household or
phone can use a whole `/64`. A turn is charged from the stream's `usage` (or
estimated from bytes when it carried none) at the option's prices, and is
written atomically (temp file + rename). A corrupt or unreadable file (including a
non-numeric per-IP amount) never resets the meter: the relay logs
`{relay: 'meter-unavailable', message}` once at startup, the free models
answer `503` and the catalog marks them unavailable, and keyed providers and
the rest of the server keep working. The file is read only at startup, so the
free models stay off until the server is restarted after the file is fixed.
A failed write warns and keeps spend in memory.

## Body limit

JSON bodies are parsed with a `1mb` limit (`RELAY_JSON_LIMIT` in
`src/relay/body.js`, shared by the server and its tests). A turn resends
system + files + history + build every time, so the 100KB express default
413d real turns as an HTML page. Past the limit the relay answers `413`
`{error: 'payload too large'}` as JSON, so the agent loop surfaces the
error instead of HTML.

## Chat logs

Both relays log conversations to a per-day JSONL file, one record per relayed
POST: `{ts, chatId, kind, path, status, request, response, ms}`, plus
`inference` (the free option's id) and `costUsd` for a free turn. The request
body drops `tools` (large and re-derivable). The production relay's directory is
`CHAT_LOG_DIR`, default `./data/chat-logs`; `0` turns logging off. It keeps
`CHAT_LOG_RETAIN_DAYS` (default 90) day files and prunes the rest. The value is
a whole number of days from 1 to 3650: a fraction is floored, anything outside
the range is clamped, and an empty or non-numeric value means the default. An own-key
turn is written only when the request carries `x-jscad-chat-id`, which the
client omits when the user opts out; a free turn is always written. A failed
write warns and never fails the request it describes.

A client that closes before the upstream answers, or while a chunk waits to be
written, is recorded with `error: 'client closed'`; before the upstream answers
the status is `499`, mid-stream it is the upstream's. The stream loops write
through `src/relay/pipe.js` `writeOrClose`, which stops on a closed response
instead of waiting for a `drain` that never comes.

## Logs and smoke

Each forwarded turn logs one JSON line: `{relay, status, bytes}`, where `relay`
is the wire kind for the default hook and `inference:<id>` for a free turn. An
inference config that cannot be read logs
`{relay: 'inference-config-error', message}`. Deploy smoke
(`e2e/smoke-deploy.mjs`) POSTs from a fake origin and expects `403`.
