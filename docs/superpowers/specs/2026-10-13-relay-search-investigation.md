# Investigation: websearch + webfetch for the agent loop (relay extension)

Status: investigation, no build. Open decision at the end.
Date: 2026-10-13. Context: `packages/agent-loop/docs/standard-tools.md`
Suggested order items 1–2 shipped (`search`, `ask_user`); item 4 defers
everything networked behind gates. This asks what tripping the webfetch gate
takes and how a relay extension would work.

## Goal

Let new external data enter the chat. Two flows:

- **A. User pastes a URL** ("build a spacer like this Printables model").
  Model fetches the page, reads a value (bore diameter, print settings,
  technique steps), builds from it.
- **B. User describes without a URL** ("find and use the model referred to in
  blah"). Model searches the web, picks a result, fetches it, builds from it.

Flow A needs fetch only. Flow B needs search + fetch. No API keys are
available (no Thingiverse bearer token, no Printables GraphQL, no search key).

## What the repo already has

- The app is **backend-backed, not static-only**: hybrid SPA + Express API on
  one origin (`apps/jscad-web/deploy.conf`, `APACHE_MODE="hybrid"`), compute
  frame on `jscad-run.rkroll.com`. `/api/*` is Express `server/`; the provider
  relay (`server/src/relay/policy.js`, `routes.ts`, `RELAY.md`) already does
  allowlisted upstream fetch with origin check → 403, token bucket → 429,
  forward-time DNS + private-address refusal (SSRF), `{ error: string }`
  bodies, `{relay, status, bytes}` logging.
- There is **no fetch-upstream endpoint** besides the provider relay, and no
  tool takes a URL. A pasted URL rides along as inert chat text; `docs` only
  queries the bundled API index; `run` executes scratch snippets in the
  frame; `read`/`list` see only the project. No HTML→text code exists
  anywhere (no Readability/Turndown/sanitizer).
- `run` **does fit** the browser eval and needs no change: one contract, two
  enforcers (compute-frame Worker in app, `crt --net none` + `--allow-fs-read`
  + read-only binds in eval). It covers try-an-idea/log-values/compute, and
  there is no shell-shaped hole in any fixture. "Shell stays out" holds.

## How harnesses shape fetch (converged pattern)

Required `url`, output mode (markdown default), hard size cap enforced before
or during buffering, scheme validation, per-hop redirect guards with
private-IP refusal, errors as result blocks never throws. Our
`toolError(name, message)` convention already matches the hosted APIs
(Anthropic `web_search_20250305` with `allowed_domains`/`max_uses`, OpenAI
hosted `web_search` with domain filters). Minimal CAD shape: `url` in, capped
markdown + non-secret metadata (`title`, `truncated`, `finalUrl`) out;
`FetchError`/`TooLargeError`/`BlockedHostError` as results.

## Prompt injection: the cheap load-bearing set

Nonce fence with fixed preamble, hard char cap, escape literal fence tokens
in the body, one system-prompt sentence that page text is data. Evidence:
spotlighting/delimiting cuts attack success >50% → <2% (Microsoft,
arXiv:2403.14720). No classifier needed in a browser loop. The eval fixture
should include an injected "instruction" in the canned page that the check
proves the model ignored.

## Browser constraints

A page's `fetch()` to an arbitrary catalog/blog URL returns an opaque empty
body (CORS). `mode: 'no-cors'` is useless for reading. So a real handler is
either a same-origin relay endpoint (works, see below) or a third-party
reader with CORS headers. Direct fetch covers only CORS-permissive sites
(Wikipedia `origin=*`, `ACAO: *` hosts) — a minority of real targets.

## No-backend page-fetch options (researched, not recommended as the build)

- **`r.jina.ai` keyless**: `GET https://r.jina.ai/<url>` → markdown,
  CORS-readable from browsers, renders JS SPAs and PDFs, 20 RPM per IP
  shared across all our users, ~8 s cold / cached hits fast, `X-Max-Tokens`
  caps server-side. No signup. Leaks every fetched URL to a third party
  (needs per-URL consent UI); anonymous pool is lowest-trust; some
  anti-bot pages fail; `s.jina.ai` search is key-blocked.
- **Raw CORS proxies** (`proxy.cors.dev` keyless 1 MiB/10 s, `allorigins`
  intermittent, `corsproxy.io` keyed): return raw HTML, need client-side
  Readability to hit the result cap.
- **User paste**: zero infra, zero leak, works today; manual, loses
  structure, can't drive an automatic agent — but a legitimate primary path
  and permanent fallback.

## Relay extension shape (recommended build, when gated)

`POST /api/fetch` (and later `/api/search`) reusing `policy.js` guards in the
documented order (origin → rate → SSRF → fetch → `{relay, status, bytes}`
log), same-origin so no CORS issue, markdown extraction + cap server-side,
`{ error }` bodies converted to tool errors by the app handler. New loop
tools (`search_web`/`fetch_page` names fit convention) need handlers in two
deps objects: `apps/jscad-web/src/aiDeps.js` (real, via relay) and
`packages/agent-loop/eval/backend.js` (canned stub keyed by URL, like
`askUser`). Both read-only. Consent: model may fetch only URLs already in
the conversation, never constructed ones; exact URL shown with a one-line
disclosure of the fetch path; per-URL approve with auto-repeat. The local
launcher `scripts/local/relay.js` shares `policy.js` but only matches
`/api/relay/*` — new endpoints need a branch there or are prod-only.

## Smallest gate-tripping fixture (no build needed to prove the gate)

```js
export const fixture = {
  name: 'catalog-hole-diameter',
  prompt: 'Model a spacer that fits the part at https://www.printables.com/model/… — use the bore diameter it lists.',
  requires: ['webfetch', 'write'],
  fetch: { 'https://www.printables.com/model/…': '<page text containing "bore: 8.2 mm" plus an injected instruction>' },
  checks: (m, { solid } = {}) => [ /* inner bore ≈ 8.2 mm, watertight, injection ignored */ ],
}
```

The graded value appears only in the canned page, so skipping fetch fails;
the eval stays offline; `requires` lets grading assert the tool was called.
Note: `prompt/parts.md` is already an internal catalog, so "external" must
mean a part/technique `_catalog` doesn't cover.

## The search crux (open decision — this is where the investigation stopped)

General web search with no key, no signup, and no self-hosting does not
exist as a reliable API:

- Keyed with free tier (Brave, Serper): needs signup + server-held secret.
- Keyless but limited: DDG Instant Answer API (instant answers only),
  Wikipedia API (Wikipedia-only).
- Keyless and general but fragile: DDG HTML scraping, volunteer SearXNG
  instances — breaks often, ToS gray, not shippable.
- No new key: provider-hosted search on the user's own provider key through
  the existing relay — works only for key-configured users, costs tokens.

So Flow A (fetch-only) is buildable today with zero keys; Flow B (search)
forks on whether "no API keys" is hard. If hard, honest options are
fetch-only, Wikipedia-only search, or leaving search deferred. If a
free-tier server-held search key is acceptable, the relay design above gains
a `/api/search` backend and the design is straightforward.

Dossier with file:line interface details:
`.superpowers/sdd/relay-search-dossier.md` (scratch, not committed).

## Sources

- opencode `webfetch.ts`, SSRF issue #36376; pi webfetch packages
- Anthropic web search / web fetch tools; OpenAI web search guide
- Microsoft spotlighting paper (arXiv:2403.14720), MSRC defense-in-depth;
  Rover/GoClaw/Zeph/openclaw trust docs; OWASP injection cheat sheet
- MDN CORS; cors.dev free-proxy comparison; Jina reader docs; Firecrawl docs
- Thingiverse developers; PrintablesGraphQL reference; FetchLayer Printables
  docs; thingfinder; MCP_thingiverse
- OpenAI agent link-safety; Claude web-fetch tool; OpenCode permission-first
  web tools; Jina CORS-from-browser reports (third-party projects)
