# Question Tool Wiring + E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `question` tool end-to-end (it is currently unwired: `askUser` exists nowhere in `apps/jscad-web` source, so every model `question` call fails with a `TypeError` tool error) and cover it with unit + Playwright e2e tests.

**Architecture:** `initChat` gains an `ask(input, { signal })` control backed by a rendered `.chat-question` card (header, question text, option buttons, fallback text input); `main.js` wires `askUser` to it; `toolDetail` also surfaces `header`/`question` so the tool row and status line name the question; the eval backend gets a canned `askUser` matching its `cannedSearch`/`cannedFetch` pattern; e2e appends `question` tests to `e2e/ai-chat-tools.spec.js`.

**Tech Stack:** Vanilla JS + existing chat CSS (`apps/jscad-web/static/main.css`), vitest jsdom (`test/aiChat.test.js`), Playwright (`e2e/ai-chat-tools.spec.js`), agent-loop vitest (`packages/agent-loop/test/`).

**Spec:** User request 2026-10-17: "wire up the question tool and test it e2e." Contract: `dispatchTool` routes `question(args) → deps.askUser(args)` (`packages/agent-loop/src/dispatchTool.js:77`); schema `{question required, options?, header?}` (`src/tools.js:162-174`); docs: "the app supplies the chat-bubble UI and the eval a canned stub" (`docs/standard-tools.md:46-54`). Neither exists yet — the eval backend `tools` map (`eval/backend.js:345-362`) has no `askUser` either.

## Global Constraints

- Work continues on branch `e2e/chat-tools-testing` in the existing worktree; new tests append to `apps/jscad-web/e2e/ai-chat-tools.spec.js`, unit tests to `apps/jscad-web/test/aiChat.test.js` and `packages/agent-loop/test/`.
- Do NOT modify `e2e/ai-chat.spec.js`.
- `question` needs no websearch-style grant; it is always offered and always served.
- An unanswered question must never hang a turn: Stop (abort), project switch, and turn end all settle the pending promise (reject → tool-error result via the existing `handleTool` catch, never a throw).
- The answer returns as a plain string (handleTool passes strings through verbatim, like `docs` results); the tool row renders it as-is.

## Review Focus

- Answering via an option button and via typed custom text must both resolve exactly once; double-click/second submit after resolve is a no-op.
- Stop mid-question must end the turn with the partial transcript persisted and no unhandled rejection.
- Project switch with a pending question must reject it and keep the new project's view clean (no card leak into the wrong project).
- `toolDetail` change must not alter existing rows: only `header`/`question` keys are new, and no current tool sends them.
- Eval canned `askUser` with no matching entry must return a tool error, never throw, matching `searchCanned`/`fetchCanned` behavior.

---

### Task 1: Wire `askUser` (card UI + abort/switch semantics + unit tests)

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js` (ask control, card render, form-submit-as-answer, abort/switch rejection, return `ask` in controls)
- Modify: `apps/jscad-web/main.js` (wire `askUser` in `aiDeps` to the chat control)
- Modify: `apps/jscad-web/static/main.css` (`.chat-question*` styles beside `.chat-tool`)
- Modify: `packages/agent-loop/src/loop.js` (`toolDetail` also reads `header`, then `question`, truncated to 40 chars)
- Modify: `packages/agent-loop/eval/backend.js` (`cannedAsk` option + `askUser` in tools map)
- Test: `apps/jscad-web/test/aiChat.test.js` (ask flows), `packages/agent-loop/test/tools.test.js` or `loop.test.js` (toolDetail), eval backend test (canned ask)

**Model:** `sonnet` — multi-file UI + lifecycle coordination from prose.

**Interfaces:**
- Consumes: none (first task; reads existing `handleTool`, `setRunning`, `switchTo`, `newChat` in `aiChat.js`).
- Produces: `chatControls.ask(input: {question: string, options?: string[], header?: string}) => Promise<string>` (rejects on abort/switch); `toolDetail` extended signature (same name, wider keys); `createEvalBackend({ cannedAsk })` where entries are `{ match: string, answer: string }`.

- [ ] **Step 1: Write the failing unit tests**

In `apps/jscad-web/test/aiChat.test.js`, add `describe('askUser question card')`:
```js
it('resolves an option click as the answer and marks the tool row ok', ...)  // runTurnFn calls requestTool('question', {question:'Which size?', options:['10','20'], header:'Size'}); click second button; expect result '20', .chat-question.answered shows '20', tool mark ok
it('takes a custom typed answer when the user submits the chat input', ...)  // no options; type into .chat-input + submit; expect answer text
it('rejects on Stop so the turn ends with a tool error, not a hang', ...)  // heldTurn-style; click .chat-send (Stop); expect tool result ok:false, stopped line, Send restored
it('rejects on project switch without leaking the card', ...)  // switchTo('p2'); expect .chat-question gone in p2 view, tool error result
```
In `packages/agent-loop/test/`: `toolDetail({header:'Size'}) === 'Size'`; `toolDetail({question:'Which size?'}) === 'Which size?'`; existing path/query/format cases unchanged.
Eval: `createEvalBackend({cannedAsk:[{match:'size',answer:'20'}]}).requestTool('question',{question:'Which size?'})` → `'20'`; no match → `SearchUnavailableError`-shaped tool error (name `AskUnavailableError`? use `toolError('AskUnavailableError', ...)` — hmm, keep consistent: search uses `SearchUnavailableError`, fetch `FetchUnavailableError`; so `AskUnavailableError`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js` and `cd packages/agent-loop && npx vitest run test/loop.test.js` (whichever file holds the new cases)
Expected: FAIL (ask is not a function / toolDetail ignores header).

- [ ] **Step 3: Implement wiring**

`aiChat.js`: module-scope `pendingQuestion = null` per panel (`{resolve, reject, card}`); `ask(input)` validates `question` non-empty string else returns `toolError`-style rejected? No — return rejected promise with `ValidationError`-shaped result? Simplest: resolve path only; validation already happens in `dispatchTool` before `askUser` is called, so `ask` can assume shape but still guard `typeof question === 'string'` → else reject with `Error('question: missing question')` (becomes tool-error result via handleTool catch).
Card DOM (only when `live()`, else still resolve? If project switched before render, reject immediately): `details`-free plain div `.chat-question` with `.chat-question-header`, `.chat-question-text`, `.chat-question-options` buttons (one per option), or `.chat-question-form` (input + button) when no options. Click/submit → `answer(value)`: mark card answered, resolve. Form submit handler: if `pendingQuestion`, preventDefault turn-start and answer with input value (non-empty; empty → shake? just ignore). Stop: in the send click handler's abort path AND `setRunning(false)` cleanup, reject pending with `Object.assign(new Error('question dismissed'), {name:'AbortError'})`? AbortError makes runTurnLocal treat turn as stopped — check: handleTool catch returns JSON error result, turn continues; but signal.aborted → runTurn rejects → stopped path. Desired: Stop ends whole turn (consistent with heldTurn). So rejection reason should carry abort semantics: reject with the signal's abort error. Implement: `signal.addEventListener('abort', () => reject(abortError()), {once:true})` mirroring test helper. `switchTo`: reject pending with `Error('question dismissed by project switch')` and remove card. Return `ask` in controls object.
`main.js`: `askUser: (input) => chatControls?.ask(input) ?? Promise.reject(new Error('chat not ready'))` — placed in `aiDeps` beside `view` (main.js:982). `chatControls` assigned after init; question can only arrive mid-turn when chat mounted, but guard anyway.
`main.css`: `.chat-question` card styles mirroring `.chat-tool` (bg, border, radius), `.chat-question-option` buttons, `.answered` state.
`loop.js toolDetail`: `const value = [input?.path, input?.query, input?.format, input?.header, input?.question].find(...)`.
`eval/backend.js`: `cannedAsk = []` param; `askUser: (args) => { const q = args?.question ?? ''; const e = cannedAsk.find(...substring...); return e ? e.answer : toolError('AskUnavailableError', 'question: no canned answer matches in the eval harness') }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js` and agent-loop suite for touched files.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/main.js apps/jscad-web/static/main.css apps/jscad-web/test/aiChat.test.js packages/agent-loop/src/loop.js packages/agent-loop/eval/backend.js packages/agent-loop/test/
git commit -m "feat(chat): wire question tool to an inline ask UI with abort semantics"
```

### Task 2: E2E `question` flows through the relay stub

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (append 2 tests)
- Reuse: Task 1 `ask` + `openChatWithKey` helper from the spec file

**Model:** `sonnet` — Playwright interaction with mid-turn UI.

**Interfaces:**
- Consumes: `startStubRelay`, `openChatWithKey` from the existing spec; `chatControls.ask` from Task 1.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

```js
test('question shows options and the picked answer reaches the model', async ({ page }) => {
  // relay rounds: [{name:'question', args:{question:'Which size?', options:['10 mm','20 mm'], header:'Size'}},{text:'Building 20 mm.'}]
  // send 'model a bracket'; expect .chat-question visible with header 'Size' + 2 option buttons;
  // click '20 mm'; expect .chat-messages contains 'Building 20 mm.';
  // model-visible: stub.requests.at(-1) tool message content === '20 mm' (RAW string, not JSON —
  //   handleTool passes strings through verbatim like docs results; the plan's earlier '"20 mm"' was wrong);
  // tool row: .chat-tool-name 'question', target 'Size', mark 'ok'.
})
test('question takes a typed custom answer via the chat input', async ({ page }) => {
  // relay rounds: [{name:'question', args:{question:'Which printer?', header:'Printer'}},{text:'Sliced for mk3.'}]
  // send 'slice it'; expect .chat-question visible with text input (no options);
  // fill .chat-input with 'mk3' + click .chat-send (hybrid: non-empty Send answers the pending question);
  // expect .chat-messages contains 'Sliced for mk3.', tool content === 'mk3', mark ok.
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "question"`
Expected: FAIL (no `.chat-question`; answer never resolves → timeout).

- [ ] **Step 3: Implement the 2 tests**

Option-button click: `page.locator('.chat-question-option', {hasText:'20 mm'}).click()`. Typed path: fill `.chat-input`, click `.chat-send` (which while pending answers instead of starting a turn). For test 2, reuse Task-3-style `/api/search` relay stub + direct-MCP 429s; pre-condition: no grant (default), so round 1 denies. After answering 'Allow'... wait — answering the question does NOT set the grant; the grant gate is separate (`setWebsearchGranted`). Hmm: model asks "Allow search?", user says Allow, model must call... the gate still denies unless grant set. How does textual Allow become a grant? It doesn't automatically. Fix test design: after the typed answer, the model's next websearch still denies UNLESS the test also checks the allow checkbox. That breaks the narrative.

Ruling (record in ledger): test 2 instead answers via the **option button** 'Allow' AND the test driver checks the `.ai-websearch-allow` checkbox first? No — that skips the question's purpose.

Cleaner test 2: keep it purely about typed answers, no websearch: rounds `[{question:{question:'Which printer?', header:'Printer'}},{text:'Sliced for mk3.'}]`, type 'mk3' + Send, expect done. The grant-fulfillment narrative is dropped — the unit suite already covers gate text. Second test then: typed custom answer path. Rename: 'question takes a typed custom answer via the chat input'.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "question"`
Expected: PASS (2 passed). Then full file: `npx playwright test e2e/ai-chat-tools.spec.js` → 11 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat-tools.spec.js
git commit -m "e2e: cover chat question option-pick and typed-answer flows"
```
