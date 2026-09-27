# Chat settings cleanup design (2026-09-27)

Gear-gated chat config, truthful sign-in copy, fetched model lists, and
per-provider documented effort controls (incl. Meta Muse Spark).

## 1. Drawer header

- One row: `[Sign in to Sync]` on the left (email + Sign out when signed in),
  gear button on the right.
- Below: a single Provider row (`anthropic` / `openai` / `opencode-go` / `meta`).
- The `Not signed in — chat turns need an account.` copy is removed: sign-in
  buys project sync only; the relay requires no session and chat runs on the
  user's own provider key.

## 2. Gear dialog (need-order)

1. API key + Save, custody modes (`session` / `device` / `synced`) unchanged
   (`@jscadui/key-store`).
2. Model select: on dialog open with a key set, GETs the provider's
   `/v1/models` through the relay and prefills options. Any fetch failure
   falls back to the current free-text input with the saved value kept.
3. Base URL as an advanced collapsible (keeps the local Ollama no-relay path;
   when set, the model fetch tries `{baseUrl}/v1/models`, else free text).
4. Effort select, shown only when the chosen model has known effort support.

## 3. Effort plumbing (documented params only, all optional)

- `createProvider` accepts `effort`; each adapter maps it to its documented
  param and omits it when unset (current behavior unchanged):
  - anthropic (`/v1/messages`): `output_config.effort`.
  - openai chat (`/v1/chat/completions`): `reasoning_effort`.
  - responses adapter (opencode-go / meta routed models): `reasoning.effort`.
  - meta chat path: `reasoning_effort` (Chat Completions equivalent).
- Meta Muse Spark supports effort on both surfaces; `none` returns 400 there,
  so the UI excludes `none` for Muse models.
- Effort options per model: Anthropic's list response carries
  `capabilities.effort.{low,medium,high,xhigh,max}.supported` — drive the
  dropdown from it. OpenAI-style lists carry no capabilities, so show the
  documented level set for those kinds.

## 4. Relay GET route

- `GET /api/relay/:kind/*` for the models fetch, under the existing rules:
  trusted-origin check, 60/min rate limit, provider-auth header allowlist
  only, no secret logging. POST behavior unchanged.
