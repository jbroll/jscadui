# Standard agent tools and browser-loop fit

What a minimal tool-calling loop needs, what wider harnesses treat as
standard, and where `packages/agent-loop` stands. The loop itself is
browser-local: providers over `fetch`, model code in the compute frame
or a sandboxed executor, no shell and no host filesystem.

## The loop

1. Send messages + tool definitions.
2. Model returns `tool_use{id, name, input}` or text.
3. Harness executes, returns `tool_result` with the same id.
4. Repeat while `stop_reason == "tool_use"`.

`src/loop.js` `runTurn` already does this, with the guardrails other
loops add later: `maxRounds` (32) plus a tools-off closing answer,
triple-identical-call doom-loop stop, per-result and per-turn caps,
read-only calls concurrent and mutating calls serial, `beforeToolCall`
deny/rewrite and `afterToolCall` rewrite, orphaned-call error fill on
abort/timeout, and provider retry in `src/providers.js`.

## What we have

| Standard category | Our tools | Notes |
| --- | --- | --- |
| Read files | `glob`, `read`, `grep` | Project-scoped, paths cannot leave project. Every turn already carries files + last build, so `glob` is rarely needed. `grep` finds `path:line` hits across the project, at most 60 per call. |
| Write files | `write`, `edit`, `delete` | Save + rebuild in one step, same `src/project.js` ops in app and eval. `edit` needs exact `oldString`. |
| Run code | `execute` | Scratch snippet beside the project, never saved. Closest browser-safe analog of a shell. |
| Domain verbs | `measure`, `check`, `export`, `view` (app) | Geometry instead of tests/linter. `export` gives size; download stays in app. |
| Docs lookup | `docs` | Generated API index over modeling/fluent/jscad-text. Our version of a lookup tool, scoped to APIs we serve. |
| Context | `src/context.js`, `src/summarize.js` | 24k history + 24k project budgets, recency-pruned files, summary handoff. No live compaction block from provider. |
| Status/usage | `onStatus`, `onText`, `onReasoning`, `onUsage` | Thinking/retry/usage stream alongside content. |

## Standard tools we lack

Ordered by fit for a browser CAD loop. None is committed; each is a
candidate with its cost noted.

### 1. Search inside the project (`grep`, `glob`) — shipped

Shipped as `grep(pattern, include?, path?, literal?)`: `path:line: text`
hits sorted by path, at most 60 per call with an overflow count, binary
files skipped, regex or plain text, read-only. `include` is a glob string or
a list of paths and globs, and `path` a file or folder, OpenCode's shape,
which models bring with them. `glob(pattern?, path?)` gives the matching
paths with their sizes; `grep` is for the contents. Both share
`globMatcher` (`src/project.js`): `**` spans folders, `*` and `?` stay in
one, `{a,b}` picks one, and a pattern with no `/` matches the file name at
any depth, as ripgrep's do.

### 2. User question / approval (`question`) — shipped

Shipped as `question(question, options?)`, read-only: the route hands the
call to the app's `deps.askUser`, which shows the question mid-turn and
returns the answer as the tool result. The app supplies the chat-bubble UI
and the eval a canned stub; the package ships only the definition. Standard
as `question` or per-tool `needsApproval`; all our tools are low-risk
(project-only), so approval gates matter less than a way to resolve
ambiguity without guessing dimensions or printers.

### 3. Todo / plan tracker

Standard as `todowrite` for multi-step work. Our turns are short
(write, build, measure), so value is lower than in a repo-wide agent.
Could live as a prompt convention first, a tool only if long
multi-part builds show lost track in evals.

### 4. Web fetch

Standard as `webfetch`/`websearch` (Anthropic server-side web search,
OpenAI hosted fetch). Tempting for referencing Thingiverse/print
profiles, but opens network, prompt-injection via page content, and
breaks the no-network sandbox story the eval relies on. Would need
size caps, same-origin or allowlist policy, and error-as-result
handling. Not proposed until a concrete fixture needs it.

Verdict 2026-10-15: `websearch` graduates from deferred under
`docs/superpowers/specs/2026-10-15-websearch-design.md`, which trips the
gate above: rotating keyless MCP providers (Exa, Parallel — Firecrawl went
keyed-only 2026-10-18, see the spec's re-probe note)
plus keyed TinyFish direct and Tavily via `POST /api/search`, blanket
per-conversation permission, snippet caps with fence escaping, and the
`catalog-search` eval fixture proving the tool path with an ignored
injection. Page fetch (`webfetch`) follows the same gate under the relay
spec: `POST /api/fetch` reaches arbitrary public pages with an http(s)
check, a five-hop redirect cap re-checked per hop for private addresses,
a 15s timeout, an 8k extracted-text cap with fence escaping, and the
`catalog-fetch` eval fixture proving the tool path with an ignored
injection.

### 5. Subagents / agent-as-tool

Standard as `task` spawn or `AgentTool`: coordinator delegates to a
specialist through the same tool interface. Our loop is single-turn,
single model; parallel lanes exist only in the eval. Adds recursion,
cost tracking, and prompt-cache invalidation problems. Revisit only if
single-turn quality plateaus on complex fixtures.

### 6. Skills (progressive know-how)

Complementary to MCP: a folder with `SKILL.md` whose description stays
in context and loads fully on relevance. Our system prompt already
bundles CAD conventions; skills would split printer profiles, material
notes, or anchor guides out of the base prompt. Cheap to prototype as
markdown + the `docs` pattern, but needs a loader and eval proof that
the base prompt is actually too big.

Verdict 2026-10-13: no split; prompt at ~2.1k words (~4.5k tokens by
`estimateTokens`) per style, under the 5,000-token sheet budget and well
inside the 24k+24k context/project budgets. Budgets unchanged.

Update 2026-10-29: split shipped. `src/skills.js` loads bodies on demand
(`skillTool`, `skillIndex`, `SKILL_BUDGET` 2000 chars) behind a `skill`
tool; `prompt/skills/` holds 5 starter skills plus 9 printability skills
(`fit-clearance` first), each under 250 words
(`test/skills-content.test.js`). The index (id + description) stays in
context; full bodies load on relevance.

### 7. MCP client

MCP won the transport war for external tools (JSON-RPC Tools /
Resources / Prompts). Our tools are local and few, so a client buys
little today. The Tool Search pattern (one `search_tools` meta-tool
over a registry) matters only past dozens of tools. Keep the tool
interface MCP-shaped so a future bridge is easy; do not add a client
now.

### 8. Shell (`bash`)

Standard elsewhere, explicitly out here. The browser has no shell and
the eval sandbox forbids processes by design. `execute` plus domain tools
cover the need. No work planned.

## OpenCode tool names

Our agent-visible names follow the OpenCode tool names, so a model that
knows OpenCode already knows our surface. `read`, `write` and `edit` are
unchanged; `glob`, `grep`, `question`, `websearch` and `execute` rename to
the OpenCode name each replaces; the rest are domain verbs OpenCode has no
tool for, kept as extensions.

| Ours | OpenCode | Status |
| --- | --- | --- |
| `read` | `read` | identical |
| `write` | `write` | identical |
| `edit` | `edit` | identical |
| `glob` | `glob` | renamed from `list` |
| `grep` | `grep` | renamed from `search` |
| `question` | `question` | renamed from `ask_user` |
| `websearch` | `websearch` | renamed from `web_search` |
| `execute` | `execute` | renamed from `run` |
| `skill` | `skill` | identical |
| `delete` | — | extension: OpenCode removes files with `bash rm` or `patch` |
| `measure` | — | extension: CAD geometry, no OpenCode analog |
| `check` | — | extension: CAD geometry, no OpenCode analog |
| `export` | — | extension: writes a mesh for download, app-side |
| `docs` | — | extension: OpenCode reaches docs through `webfetch`/`skill`; ours is a scoped index |
| `view` | — | extension: app-only visual viewer |
| `webfetch` | `webfetch` | deferred; `websearch` ships first, page fetch waits for its gate |

OpenCode tools we deliberately leave out: `shell` (no shell in the browser
or eval sandbox, `execute` covers scratch code), `patch` (our `edit` and
`write` own file changes) and `subagent`/`task` (single-turn loop;
deferred until a fixture proves the need).

## Suggested order

1. Project `grep` — shipped; `glob` only if the per-turn file list proves
   too narrow.
2. `question` for ambiguity, using the existing hook shape — shipped.
3. Skills-style split only when prompt size forces it.
4. Everything networked or recursive (fetch, subagents, MCP client)
   waits for a fixture that cannot pass without it.

Deferred until a gate trips, one line each: webfetch only when a fixture
requires an external catalog page and states its URL; subagents only when
single-turn complex-fixture pass rate plateaus for two eval passes after
grep + question ship; MCP client only when the tool count passes 20 or a
shared external registry exists. Shell stays out: `execute` covers it.

## Sources

- Seekvana tool_use loop: `tool_use{id,name,input}` + `tool_result[id]`, loop on `stop_reason` — https://seekvana.com/library/agentic-ai/how-tool-calling-works
- Temporal OpenAI loop example — https://docs.temporal.io/ai/cookbook/agentic-loop-tool-call-openai-python
- Vercel `ToolLoopAgent` (`tools`, `stopWhen`, `toolApproval`) — https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Tool-use standardization survey (MCP, Tool Search 34-64% token cut, agent-as-tool) — https://zylos.ai/research/2026-04-07-tool-use-function-calling-standards-benchmarks/
- Claude API skill (client vs server tools, MCP + Skills, compaction) — https://callsphere.ai/blog/inside-the-claude-api-skill-architecture-of-agentic-tooling
