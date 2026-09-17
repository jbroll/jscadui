# Browser-local agent loop — design

Date: 2026-09-17. Status: approved sections 1-3 in brainstorming.

## Goal

Let a local user drive JSCAD model generation from the browser with no app
server. The page owns the agent loop, tool execution, keys, and files. The
only network service is a CORS passthrough relay at `jscad.rkroll.com` that
holds nothing. Rowboat provides hierarchical folder storage for backup, sync,
and sharing, following the checklist app pattern.

## Background

A server-mediated loop already exists and is tested: SSE `text` /
`tool_request` / `done` / `error` transport
(`apps/jscad-studio/server/src/agent/routes.ts`,
`apps/jscad-web/src/aiChat.js`), seven tools
(`apps/jscad-studio/server/src/agent/tools.ts`,
`apps/jscad-web/src/aiBridge.js`, `apps/jscad-studio/src/toolBridge.js`),
browser execution against worker/viewer/editor
(`apps/jscad-web/main.js` `aiDeps`), unit routing tests
(`apps/jscad-web/test/aiBridge.test.js`), and a stub-server e2e turn with real
worker measurements (`apps/jscad-web/e2e/ai-chat.spec.js`). Separation of chat
prose from model code is a tool-protocol convention: code travels only in
`tool_request` input (`eval.source`, `writeModel.source`); no fence extractor
exists anywhere under `apps/`, and none is wanted.

The gap: `apps/jscad-web` ships no server yet its drawer POSTs to
`/api/chat/local`. This design removes that dependency.

## 1. Architecture

New `packages/agent-loop`, browser-safe with no Node imports. Exports:

- `runTurn`, ported from `server/src/agent/loop.ts` (same signature:
  `conversation`, `provider`, `requestTool`, `onText`, `signal`,
  `toolTimeoutMs`; same timeout/abort semantics; returns a new conversation).
- Provider adapters ported from `server/src/providers/anthropic.ts` and
  `openaiCompatible` (both already `fetch` + `ReadableStream`; replace
  `randomUUID` with `crypto.randomUUID`).

`apps/jscad-web/src/aiChat.js` becomes a thin view over `runTurn`: it calls
the loop directly, executes each `tool_use` via `src/aiBridge.js`
`handleToolRequest` against `main.js` `aiDeps`, feeds results back, and
streams text into bubbles. Provider HTTP targets the relay. Conversations,
files, versions, and settings live in rowboat via `@jbroll/rowboat-client`
sync (`projects/files/versions/conversations/settings` tables per studio plan
Task 10). The studio server loop is untouched for hosted use.

## 2. Tool channel and relay contract

All model interaction is tool calls. `text` events render as chat and are
never parsed for code. Tool schemas match the existing seven: `eval {source,
entry}`, `params`, `measure`, `check`, `view {preset, camera}`, `export
{format}`, `writeModel {source, entry, message}`. Execution routes through
`handleToolRequest` to worker (`eval`, `measure`, `check`, `export`),
`paramChangeCallback` (`params`), canvas `toDataURL` (`view`),
`editor.setSource` (`save`). Every path answers JSON; failure is `{ok:false,
error}`, never a throw.

Relay is CORS passthrough only. The browser sends the provider request with
the user key from `@jscadui/key-store` (session/device/synced modes per
`src/aiAccount.js`); the relay forwards to a provider host on an allowlist
(Anthropic default, configured OpenAI-compatible hosts, user `baseUrl`
restricted to public https), streams the SSE body back unmodified, and stores
nothing, logging no bodies or keys.

## 3. System prompt, storage, tests

System prompt is a versioned asset of the new package at
`packages/agent-loop/prompt.md`, bundling the `apps/jscad-web/llm.txt`
params conventions with tool policy: try with `eval`, verify with
`measure`/`check`/`view` before claiming done, persist with `writeModel`,
and the no-prose-parsing rule. History loads from and saves to the rowboat
`conversations` table per project.

Storage follows checklist: rowboat tenant as the synced store, file bytes via
rowboat file routes, linked local folder retained as a source-of-truth option
where the handle exists. `writeModel` and editor saves both write a version
row plus blobs.

Tests: loop against a fake provider and providers against recorded SSE in the
new package; existing `test/aiBridge.test.js` routing unchanged; e2e replays
the `e2e/ai-chat.spec.js` stub pattern against a stub relay with real worker
measurements; relay tests assert nothing persisted and non-allowlisted hosts
refused.

## Non-goals

Markdown fence extraction, server-side model execution, hosted shared keys,
background turns with no open tab, STEP/B-rep export.
