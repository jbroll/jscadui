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
| Read files | `list`, `read`, `search` | Project-scoped, paths cannot leave project. Every turn already carries files + last build, so `list` is rarely needed. `search` finds `path:line` hits across the project, at most 60 per call. |
| Write files | `write`, `edit`, `delete` | Save + rebuild in one step, same `src/project.js` ops in app and eval. `edit` needs exact `oldString`. |
| Run code | `run` | Scratch snippet beside the project, never saved. Closest browser-safe analog of a shell. |
| Domain verbs | `measure`, `check`, `export`, `view` (app) | Geometry instead of tests/linter. `export` gives size; download stays in app. |
| Docs lookup | `docs` | Generated API index over modeling/fluent/jscad-text. Our version of a search tool, scoped to APIs we serve. |
| Context | `src/context.js`, `src/summarize.js` | 24k history + 24k project budgets, recency-pruned files, summary handoff. No live compaction block from provider. |
| Status/usage | `onStatus`, `onText`, `onReasoning`, `onUsage` | Thinking/retry/usage stream alongside content. |

## Standard tools we lack

Ordered by fit for a browser CAD loop. None is committed; each is a
candidate with its cost noted.

### 1. Search inside the project (`grep`, `glob`) — shipped

Shipped as `search(pattern, paths?)`: `path:line: text` hits sorted by
path, at most 60 per call with an overflow count, binary files skipped,
regex or plain text, read-only. No glob; `list` already gives every path
with its size each turn.

### 2. User question / approval (`ask_user`) — shipped

Shipped as `ask_user(question, options?)`, read-only: the route hands the
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

### 7. MCP client

MCP won the transport war for external tools (JSON-RPC Tools /
Resources / Prompts). Our tools are local and few, so a client buys
little today. The Tool Search pattern (one `search_tools` meta-tool
over a registry) matters only past dozens of tools. Keep the tool
interface MCP-shaped so a future bridge is easy; do not add a client
now.

### 8. Shell (`bash`)

Standard elsewhere, explicitly out here. The browser has no shell and
the eval sandbox forbids processes by design. `run` plus domain tools
cover the need. No work planned.

## Suggested order

1. Project `search` — shipped; glob only if `list` proves too narrow.
2. `ask_user` for ambiguity, using the existing hook shape — shipped.
3. Skills-style split only when prompt size forces it.
4. Everything networked or recursive (fetch, subagents, MCP client)
   waits for a fixture that cannot pass without it.

## Sources

- Seekvana tool_use loop: `tool_use{id,name,input}` + `tool_result[id]`, loop on `stop_reason` — https://seekvana.com/library/agentic-ai/how-tool-calling-works
- Temporal OpenAI loop example — https://docs.temporal.io/ai/cookbook/agentic-loop-tool-call-openai-python
- Vercel `ToolLoopAgent` (`tools`, `stopWhen`, `toolApproval`) — https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Tool-use standardization survey (MCP, Tool Search 34-64% token cut, agent-as-tool) — https://zylos.ai/research/2026-04-07-tool-use-function-calling-standards-benchmarks/
- Claude API skill (client vs server tools, MCP + Skills, compaction) — https://callsphere.ai/blog/inside-the-claude-api-skill-architecture-of-agentic-tooling
