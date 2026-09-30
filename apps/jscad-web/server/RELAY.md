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

## Logs and smoke

Each forwarded turn logs one JSON line: `{relay, status, bytes}`. Deploy
smoke (`e2e/smoke-deploy.mjs`) POSTs from a fake origin and expects `403`.
