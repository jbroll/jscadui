# Design: demo provider + TOS gate + dynamic model catalog

Paths under `apps/jscad-web` unless stated. Builds on
`docs/superpowers/specs/2026-10-01-chat-logging-and-shared-keys-design.md`
(logging Phase 1 + shared-keys Phase 2); this doc decides the demo/TOS
layer on top and does not re-spec the meter/log format.

## Intent and why

Let a casual visitor try the chat before signup or bringing a key, without
leaking server keys to the browser and without shipping a per-model
training-terms table that rots. Cover ourselves with one honest,
always-on data-use gate instead of per-model "free/contributor" warnings.

## Scope (builder-check call)

Phase 1 (production logging, opt-out, notice, `trust proxy`, limiter
eviction, pull script) and Phase 2 (shared config, routes, meter, client
option) have not landed — `server/src/relay/routes.ts` has only
`/api/relay/:kind/*splat`, no shared routes, meter, or chat log. This plan
builds Phase 1 + Phase 2 + the demo/TOS layer below as one job, reusing the
2026-10-01 record format and route shapes unchanged.

## Goals

- A `demo` provider choice in the gear dialog, integrated like every other
  provider (`kind`, `model`, `effort`, summary line), usable with no signup
  and no user key. The client carries exactly one sentinel credential,
  `demo-limited-free`, for the whole demo provider (partner call 2026-10-15);
  the server ignores its value and injects the operator's server-held keys
  per shared option. Every demo turn is always recorded to improve
  jscad-web. Per-IP daily + monthly budgets bound
  spend (reuse shared-keys Phase 2 meter).
- First-turn TOS gate: no chat turn runs until the user accepts the current
  TOS version. Acceptance is versioned in
  `localStorage['jscad-ai.tos'] = { version, at, recordOwnChats }`. A
  `TOS_VERSION` bump clears acceptance and re-blocks turns until the user
  re-accepts (partner call 2026-10-15); the prior `recordOwnChats` is shown
  pre-checked as the default but requires an explicit accept.
- Mandatory acknowledgements (must check/press to proceed):
  1. Agents run generated JavaScript in workers in this browser.
  2. Prompts, project files in context, and outputs are sent to the chosen
     inference provider.
  3. The inference provider might train on session data (generic, all models —
     explicit decision: no per-model training flag, no overlay table).
  4. Demo only: sessions on demo keys are always recorded to improve
     jscad-web and cannot be opted out.
- Optional, asked for every model: "Save my chats to help improve jscad-web"
  (our recording consent). Default on for demo (checked + disabled), default
  on for own keys, unchecked persists `localStorage['jscad-ai.log'] = 'off'`
  and omits `x-jscad-chat-id` so the relay never logs (per Phase 1 rule).
- Dynamic model catalog: the model list always comes from a live
  `GET /v1/models` with the active credential (user key, or demo's
  `GET /api/relay/shared` list for demo). Own keys go through the relay
  (`relayBaseUrl(kind)` + per-kind auth headers, as `aiAccount.js:loadModels`
  does today) — never direct browser → provider. No static model allowlist in the
  client; `modelPlaceholders` remain as empty-state hints only. Demo has no
  model dropdown: each shared option pins one fixed model, and the
  "catalog" for demo is the option list itself.

## Consent sync (builder-check call)

`localStorage['jscad-ai.tos'] = { version, at, recordOwnChats }` is the
source of truth. `localStorage['jscad-ai.log']` (`'off'` when opted out,
absent means on, per Phase 1) is a derived mirror kept for backward
compat: accepting the TOS writes both, toggling the gear-dialog checkbox
rewrites both. On divergence the `.tos` record wins; fresh installs with
neither key default `recordOwnChats` to true.

## Non-goals

- No per-model `providerTrains` flag, no terms scraper, no pricing UI.
- No new recording service: server JSONL + pull script from Phase 1 is the
  store. No client-side transcript upload.
- No signup, captcha, or payment in this change. IP budgets are the only
  demo throttle.
- No custom-base-URL logging (still never logged, still skips TOS recording
  question but keeps the code-execution + provider-sharing acks).

## Anti-goals

- A hardcoded `demo-limited-free` bearer that reaches the browser as a real
  credential and can be curled independently of the relay.
- Silent training-data collection: demo without the always-recorded notice,
  or own-key logging that ignores the opt-out.
- A TOS wall on every launch: accept once per version, not per session.

## Constraints

- Relay never trusts the client key for demo: `POST /api/relay/shared/:id/*`
  drops client `authorization`/`x-api-key` and injects the server key (Phase 2
  routes). Client sends `apiKey: 'demo-limited-free'` only so the existing
  fail-closed `getProviderConfig()` passes; the server ignores the value.
- `GET /api/relay/shared` returns `[{id,label,kind,model,available}]`, never
  keys or prices. Demo dialog lists these as `Demo: <label>` entries.
- Demo models to start: `opencode-go/deepseek-v4-flash` (confirm exact id at
  build; request said `deepseek-v4.1-flash`, code placeholder says
  `deepseek-v4-flash`) and `meta/muse-spark-1.3-contributor`. Opencode GO free
  models: include only if they appear in the operator's `shared.json`
  options — no auto-discovery of "free" from the provider API.
- `RESPONSES_MODELS` / `MESSAGES_MODELS` routing in
  `packages/agent-loop/src/providers.js` stays the source of truth for
  protocol; adding a model id there is a one-line client change, no TOS change.
- TOS text lives in one module (`src/aiConsent.js`) with a `TOS_VERSION`
  constant; bumping it re-prompts. Keep each ack under two sentences with a
  link to the privacy note in `docs/architecture.md`.

## Decided how (partner calls, builder must follow)

- Demo = shared-keys Phase 2 shipped as the user-visible "demo provider".
  `kind` stays the underlying protocol kind (`opencode-go`/`meta`);
  selection adds `shared: <id>` + `demo: true`. `relayBaseUrl` maps demo to
  `/api/relay/shared/<id>`. The server accepts the client sentinel
  `demo-limited-free` and the Phase 2 sentinel `shared` interchangeably
  (ignores the value either way). There are no shipped `shared` selections
  to migrate (Phase 2 unlanded); if one is found it is treated as demo.
- Ship vehicle (partner call 2026-10-15): single feature — Phase 1 + Phase 2
  + demo/TOS land and deploy together, no phased rollout.
- Enforcement (builder-check call): the gate runs on Send, on every
  transport including custom base URLs (which keep the code-execution +
  provider-sharing acks, skip only the recording question). Decline blocks
  that turn with the quota-style error line.
- Generic training warning replaces the training flag (partner decision
  2026-10-15). Do not build the overlay.
- Consent storage keys above are final; `recordOwnChats` boolean is the only
  new persisted bit beyond Phase 1's `jscad-ai.log`.
- Dialog order: code-execution → provider-sharing + trains-generic (one box
  with two sentences) → demo-always-recorded (demo only) → our-recording
  opt-in → Close/Accept. Decline blocks the turn with the existing
  quota-style error line, not a dead page.
- Drawer notice line while logging is on (Phase 1 wording) stays; demo
  wording stays "always saved".

## Left to the builder

- Exact demo copy (keep short, link privacy note), CSS for the gate dialog
  (reuse `.confirm-overlay`/`ai-settings` patterns), and e2e selectors.
- Meter budget numbers come from operator `shared.json`; defaults from
  Phase 1 spec ($5/mo total) unless operator overrides.
- Model-id spelling reconciliation against the live provider at build time.
- Whether `GET /api/relay/shared` failure degrades to hiding demo vs showing
  "demo unavailable" — either is acceptable, pick one and test it.
