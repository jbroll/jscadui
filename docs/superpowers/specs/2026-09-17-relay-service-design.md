# Relay service — design

Date: 2026-09-17. Status: approved sections 1-3 plus kind-key amendment in brainstorming.

## Goal

Give the browser-local agent loop a CORS passthrough to provider APIs that
holds nothing. The relay forwards user-keyed provider requests and streams
responses back. It stores no keys, conversations, bodies, or logs with secrets.

## Background

The browser loop (`packages/agent-loop`, plan
`docs/superpowers/plans/2026-09-17-browser-local-agent-loop.md`) calls
provider HTTP directly. Browsers block this by CORS, so provider traffic goes
through `jscad.rkroll.com`, which already proxies `/api` to the studio Express
server on `:3006` (`apps/jscad-studio/deploy.conf:33`,
`deploy-full.sh:31-36`). The e2e stub relay proved the required shape:
path-preserving forward, streamed SSE, preflight handling. This design puts
that shape on the real server as a route, not a new service.

## 1. Route contract

`mountRelayRoutes(app, {allowlistPath, trustedOrigins})` in
`apps/jscad-studio/server/src/relay/`. Explicit per-provider endpoints keyed
by the existing `ProviderKind` vocabulary (`anthropic` | `openai`) — no
second naming scheme:

- `POST /api/relay/anthropic/*` → `{upstream}/...`
- `POST /api/relay/openai/*` → `{upstream}/...`

The `:kind` segment must exist in the allowlist file; the sub-path is
appended to that entry's upstream base and forwarded with method, body, and
provider auth headers unchanged. Upstream SSE streams back byte-for-byte with
`content-type: text/event-stream`, `cache-control: no-cache`.

Provider wire knowledge stays split where it must: the browser owns request
construction (paths like `/v1/messages` live in the adapters and cannot move
without moving request building); the relay owns host permission. The only
shared vocabulary is `ProviderKind`, which both sides already use.

Status codes: `204` on `OPTIONS` preflight, `404` unknown kind, `403` bad
origin, `429` over rate limit, `502` upstream unreachable. Nothing persisted:
no DB, no conversation store, no key storage. Logs carry method, kind,
status, and byte counts only — never headers, bodies, or keys.

## 2. Allowlist file and access rules

Allowlist is a JSON file outside the bundle (e.g.
`/etc/jscad-relay/providers.json`, `RELAY_ALLOWLIST` env override for dev):

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com" }
```

Reloaded without deploy or restart: read on request and cached ≤5s. Entry values must be `https:` URLs to public hosts: no
`http:`, no ports, no private/loopback/link-local IPs — resolved at forward
time and checked after resolution. Unknown kind is `404` without revealing
file contents.

Origins reuse the server's `trustedOrigins` config
(`server/src/index.ts:15-35`): the browser `Origin` must match; no `*`, no
null origin, `Vary: Origin`, no credentials. This reliably stops other
websites from spending the relay from their visitors' browsers (browsers set
`Origin` and page JS cannot forge it); direct script abuse is uneconomical
because every forwarded request spends the caller's own provider key. Per-IP
token-bucket rate limiting (60 req/min, burst 10) covers bandwidth exposure;
over limit is `429` with `Retry-After`. No session requirement: the caller's
provider key rides the request and is never stored or logged.

## 3. Browser changes, tests, deploy

Browser: `relayBaseUrl` in `apps/jscad-web/src/aiChat.js` becomes per-kind —
`anthropic → {relay}/api/relay/anthropic`,
`openai → {relay}/api/relay/openai` — with the existing `localStorage`
override and user `baseUrl` still winning when set. No adapter changes: they
already append `/v1/messages` and `/v1/chat/completions`. Default relay root
stays `https://jscad.rkroll.com`.

Tests: unit — unknown kind `404`, disallowed origin `403`, private-IP
upstream refused, preflight `204` with CORS headers, upstream SSE bytes
proxied unchanged, log line contains no key or body. The existing stub-relay
e2e (`apps/jscad-web/e2e/ai-chat.spec.js`) is unchanged; it already proves
the shape. Deploy: no new vhost or port — the existing `/api` proxy rule
already covers `/api/relay/*`. Ship with the normal server deploy and extend
smoke with a bad-origin `POST` expecting `403`.

## Non-goals

Session-gated access, per-user relay keys, request/response logging, body
inspection or transformation, background turns, generic open proxying.
