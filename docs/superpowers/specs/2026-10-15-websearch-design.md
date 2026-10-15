# Design: `web_search` tool with rotating providers, key dialog, blanket permission

Status: implemented 2026-10-15 (branch `feat/websearch`, plan `docs/superpowers/plans/2026-10-15-websearch.md`).
Supersedes the open decision in `2026-10-13-relay-search-investigation.md`
§"The search crux": keyless general web search **does** exist via the
providers' hosted MCP endpoints (probed 2026-10-15, evidence below), so Flow B
(search, then fetch, then build) is buildable. This spec covers search only;
fetch stays with the relay-investigation design. The user trips the gate from
`standard-tools.md` ("everything networked waits for a fixture") by direct
request; a `catalog-search` eval fixture is still required before merge (see
Acceptance).

## Goal

Give the chat model a `web_search` loop tool that works with no signup on day
one (keyless free tiers), upgrades to user-supplied keys, asks permission once
per conversation instead of per call, and runs in both deps contexts (app page
and eval backend). Patterned after opencode's `websearch` (one tool, rotating
providers, permission gate, 429 failover), adapted to our tool protocol and to
the browser CORS reality opencode never faces.

Non-goals: page fetch (relay spec owns it), browser automation, server-held
shared keys, per-query approval UI.

## Evidence: CORS + keyless matrix (probed 2026-10-15 with curl)

Preflight: `OPTIONS` with `Origin: https://jscad.example.com`,
`Access-Control-Request-Method: POST`. Handshake: MCP `initialize` POST,
no key.

| Provider | MCP endpoint | Preflight | Keyless `initialize` |
|---|---|---|---|
| Exa | `https://mcp.exa.ai/mcp` | `ACAO: *` | 200 |
| Parallel | `https://search.parallel.ai/mcp` | `ACAO: *` | 200 |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | `ACAO: *` | 200 |
| TinyFish | `https://agent.tinyfish.ai/mcp` | `ACAO: *` | 401 (OAuth or `X-API-Key` required) |
| Tavily | `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>` | **405, no CORS headers** | 401 (key required) |

Consequences, locked here:

- **Browser-direct pool: Exa, Parallel, Firecrawl** (keyless) **+ TinyFish**
  (keyed). The app page calls these straight from JS; no relay needed.
- **Tavily is relay-only** (no preflight → browser `fetch` dies before any
  status is readable). Tavily also needs a key, so it only enters the pool
  when the user sets one, and browser calls go through `POST /api/search`.
- **Keyless pool: Exa, Parallel, Firecrawl.** TinyFish and Tavily join only
  with user keys. No keyless path may ever send `Authorization`; keyless
  requests carry only `User-Agent: jscadui/<version>`.

## Architecture

New `packages/agent-loop/src/websearch.js`, no new dependencies (bare
`fetch` + JSON-RPC). Three layers, mirroring opencode's split:

1. **MCP client** (`mcpCall(url, tool, args, { headers, timeoutMs })`):
   Streamable-HTTP `tools/call`, 25 s timeout, `{ error }` bodies become
   `toolError`, never throws. Tool names per provider: `web_search_exa`
   (Exa), `web_search` (Parallel), `firecrawl_search` (Firecrawl, via the
   dedicated `…/v2/mcp-search` surface), `tavily-search` (Tavily),
   TinyFish search tool name resolved at implementation from its
   `tools/list` (do not hardcode an unverified name).
2. **Provider table + rotation.** Ordered pool built per call from what is
   usable *in this context with these keys* (routing matrix below).
   Sticky selection per conversation: `hash(projectId ?? sessionId) %
   pool.length`, exactly opencode's `checksum(sessionID)` trick, so one
   conversation reuses one provider unless it fails. On 429 or network
   error the provider cools down (60 s, or `Retry-After`), and the call
   retries with the next pool member; all cooling → `toolError`
   (`SearchUnavailableError`). Every result is tagged with the serving
   provider (`{ title, url, snippet, provider }`), capped chars (see
   Injection), so failover is visible in transcripts and tests.
3. **Loop-tool surface.** Tool name **`web_search`** (OpenAI + Anthropic
   convention, and snake_case like the existing `ask_user`; opencode's
   one-word `websearch` was considered and rejected for consistency).
   When page fetch is specified, it should take the same convention
   (`web_fetch`) rather than inventing a local variant. Entry in
   `buildTools()` (`tools.js`),
   route in `dispatchTool.js` (`web_search: (deps, args) => deps.websearch(args)`),
   member of `READ_ONLY` (concurrent-safe). Input schema:
   `{ query: string (required), count?: integer default 8 }`;
   `additionalProperties: false`.

Handlers in both deps objects (the two-context rule from the relay spec):

- `apps/jscad-web/src/aiDeps.js` (real): page-side handler. Tries the
  browser-direct pool first; Tavily and relay-fallback go through
  `POST /api/search` (new relay route, policy.js guards in documented
  order; server Tavily key from env when the operator sets one; response
  never echoes a key). Keys come from the key dialog (§Keys), memory only.
- `packages/agent-loop/eval/backend.js` (canned): offline stub keyed by
  query substring, like the `askUser` precedent — fixtures must declare
  `requires: ['web_search']` and carry canned results; a fixture whose
  graded value appears only in canned search output proves the tool path.
  Eval keys: none; live network never runs in eval.

## Routing matrix (normative)

| Context | No keys | With user keys |
|---|---|---|
| App page (browser) | Exa → Parallel → Firecrawl, sticky, failover | + TinyFish direct; + Tavily **via relay** |
| Eval backend (node) | Exa → Parallel → Firecrawl direct | + TinyFish direct; + Tavily direct (env key) or relay |
| Local launcher | Same as eval | Same as eval |

Keyed providers sort after keyless ones when all are healthy (spend the
user's money last); a keyed provider the user explicitly pins in settings
sorts first. Pinning: `websearch: { provider: 'tavily' | 'random' | false }`
next to the model selection (opencode parity); `false` removes the tool
from `buildTools` output.

## Keys: dialog + custody

Gear dialog (`apps/jscad-web/src/aiAccount.js` pattern) gains a Search
section: one password row per provider (Exa, Parallel, Firecrawl, Tavily,
TinyFish) with provider signup link, Save/Clear per row, and a status line
(`keyless` vs `key set`). Reuses session/device/synced modes and the
existing mode UI; a search key in device mode is no more exposed than the
model key (page memory + origin localStorage, never posted to the compute
frame, never logged).

Prerequisite change, called out because it is easy to miss:
`createKeyStore` (`packages/key-store/src/keys.js`) hardcodes one
`STORE_KEY`, so five instances would collide. Parameterize the storage key
(`createKeyStore({ storage, key })`) and instantiate one store per provider
id (`jscad-studio.search.<provider>`). No change to the crypto.

Eval/CI: keys arrive only via env (`JSCADUI_<PROVIDER>_API_KEY`) and are
read at handler-construction time; fixtures carry canned results, never
keys. A test that needs a live provider is forbidden; e2e asserts the
dialog stores and clears without network (mock `fetch`).

## Permission: blanket grant (user requirement)

Per-query approval is explicitly rejected: the user grants web search once,
and the grant covers the conversation. Mechanics:

- Grant states per conversation: `off` (default) / `on`. Surfaces: (a) the
  model asks via `ask_user` and the user accepts — `handleTool` flips the
  conversation grant; (b) the gear dialog toggle (global default for new
  conversations); (c) first `web_search` call arrives ungranted → the loop
  answers with a grant request instead of searching (never auto-searches).
- Enforcement point: `beforeToolCall` (already threaded through
  `initChat`/`runTurnFn` in `aiChat.js:80,429`). Ungranted `web_search`
  short-circuits to a grant-request result; granted calls proceed and each
  one is logged (query + provider + result count) to the transcript console,
  so spend is auditable per conversation.
- Revoke: dialog toggle off, or conversation close; revoke clears the grant
  but never the stored keys.
- Eval harness: the canned stub ignores grants (scripted fixtures are
  consent by construction), but a fixture without `requires:
  ['web_search']` that triggers a search call fails grading, proving the
  model does not spray searches.

## Injection (by reference, not repeated)

Page/search snippets are untrusted data: apply the relay spec's cheap set —
nonce fence with fixed preamble, hard char cap on returned snippets,
escape fence tokens, one system-prompt sentence that result text is data.
The `catalog-search` fixture carries an injected instruction in a canned
snippet that grading proves the model ignored.

## Global constraints

- TDD per repo rule; every new file gets its test file in the same commit.
- Fail-closed: no grant → no search; no usable provider → `toolError`, never
  a throw, never a silent empty success.
- Secrets: keys in memory/localStorage only; never in transcripts, logs,
  fixtures, URLs (except Tavily's documented `?tavilyApiKey=` query param on
  the direct-Node path — never logged), or error messages.
- `result?.isTreeNode` style rules do not apply here (no geometry), but the
  two-deps-objects rule does: nothing lands with only one handler.
- Existing suites green; `standard-tools.md` §4 verdict updated in the
  landing commit (websearch graduates from "deferred" with this spec as its
  gate-trip record).

## Acceptance

- Unit (`packages/agent-loop/test/websearch.test.js`, mocked `fetch`):
  sticky selection stable per id; keyless pool excludes Tavily/TinyFish;
  keyed pool includes them; 429 on first provider retries second and tags
  the serving provider; all-cooling → `SearchUnavailableError`; Tavily
  never attempted from a browser-context pool member (assert the pool
  builder takes the context, not just keys); result char cap enforced.
- Dialog (`apps/jscad-web/test/`): per-provider save/clear round-trips
  through parameterized stores; no network calls (fetch mocked).
- Dispatch (`dispatchTool.test.js` + eval `backend.test.js` mirror):
  `web_search` routes in both deps objects; schema rejects unknown props.
- Eval fixture `catalog-search`: graded value only in canned search output
  + injected instruction ignored; `requires: ['web_search']`.
- Manual (pre-merge, keyless): three live queries from the app, one per
  keyless provider (pin each via settings), results render with provider
  tags; Tavily row shows "needs key + relay" until keyed.

## Open decisions for the owner (do not block the build)

1. **Billing ownership**: user keys only (this spec), or also a server-held
   fallback key for keyless-exhausted users? Undecided; spec assumes user keys.
2. **Blanket scope default**: per-conversation grant (spec default) vs.
   global always-on toggle. Dialog ships both; which is default?
3. **Launcher parity**: `scripts/local/relay.js` only matches `/api/relay/*`
   (relay-spec noted) — add `/api/search` there or accept prod-only relay?
4. **TinyFish MCP tool name**: resolve from live `tools/list` at build time;
   do not ship a hardcoded guess.
