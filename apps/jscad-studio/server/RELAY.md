# Relay operator notes

The relay (`src/relay/`) forwards user-keyed provider requests and streams
responses back. It stores nothing: no DB rows, no logs with secrets.

## Allowlist file

JSON `{kind: upstreamBase}`, default `/etc/jscad-relay/providers.json`,
override with `RELAY_ALLOWLIST`. Entries must be public `https:` URLs without
ports; re-read at most every 5s, so edits apply without restart.

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com" }
```

## Access rules

- Browser `Origin` must be in the server's trusted origins; else `403`.
- Per-IP 60 req/min, burst 10; over limit is `429` with `Retry-After`.
- No session required; the caller's provider key rides the request through.

## Logs and smoke

Each forwarded turn logs one JSON line: `{relay, status, bytes}`. Deploy
smoke (`e2e/smoke-deploy.mjs`) POSTs from a fake origin and expects `403`.
