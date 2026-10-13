# Project-files recency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project-files block's recency trim work in the app and the eval by carrying a lean `mentions` path list on assistant turns.

**Architecture:** A transcript message gains an optional `mentions: string[]`, the project-file paths its tools touched in call order. `mentionedPaths` in the agent-loop reads it (keeping the `toolCalls` branch the eval feeds it), so `buildMessages` ranks the block without any provider seeing a `mentions` field. The app records the paths in `handleTool` and stores them on the assistant reply; the eval derives them from the loop's new messages and adds them to its `prior`.

**Tech Stack:** JavaScript ES modules, npm workspaces, Vitest (jsdom for the app suite).

**Spec:** `docs/superpowers/specs/2026-10-12-project-files-recency-design.md`

## Global Constraints

- `mentions` is a `string[]` of project-file paths, in tool-call order, duplicates kept. It is the only recency source.
- Provider adapters must never send `mentions`. They rebuild messages from named fields, so no adapter change is allowed.
- `mentionedPaths` reads `m.mentions` first, then `m.toolCalls[].input.path`.
- No storage-schema change: `Conversation.messages` is already `z.array(z.unknown())`.
- No new code comments except updating the `forModel` comment that names tool calls.
- Run a package's tests with `npx vitest run <path>` from that package directory (`workdir`). Committing runs the repo pre-commit gate (full test suite); let it pass.
- Do not add or change any provider serialization behaviour.

## File Structure

- `packages/agent-loop/src/context.js` — `mentionedPaths` gains the `mentions` branch (Task 1).
- `packages/agent-loop/index.js` — exports `mentionedPaths` (Task 1).
- `apps/jscad-web/src/aiChat.js` — records and forwards `mentions` (Task 2).
- `packages/agent-loop/eval/run-eval.js` — carries `mentions` into `prior` (Task 3).
- Docs: `apps/jscad-web/docs/architecture.md`, `packages/agent-loop/docs/architecture.md`, `packages/agent-loop/docs/user-manual.md`, `docs/backlog.md` (Task 4).

---

### Task 1: agent-loop `mentions` recency channel

**Files:**
- Modify: `packages/agent-loop/src/context.js:26-35`
- Modify: `packages/agent-loop/index.js:6`
- Test: `packages/agent-loop/test/context.test.js`
- Test: `packages/agent-loop/test/providers.test.js`

**Interfaces:**
- Produces: `mentionedPaths(transcript) → string[]`, exported from `packages/agent-loop/src/context.js` and re-exported by `packages/agent-loop/index.js`. Reads `m.mentions` (array of strings) and `m.toolCalls[].input.path`.
- Produces: `buildMessages` unchanged signature; a transcript assistant turn carrying `mentions` ranks the project files under `projectBudget`.

- [ ] **Step 1: Write the failing test**

In `packages/agent-loop/test/context.test.js`, add this test inside the `describe('project files budget', ...)` block (after the `'ranks never-mentioned files after mentioned ones and alphabetically among themselves'` test at line 141, before the closing `})`):

```js
  it('ranks files by the mentions an assistant turn carries', () => {
    const byPath = (path) => ({ role: 'assistant', content: '', mentions: [path] })
    const transcript = [byPath('a.js'), byPath('b.js'), byPath('c.js')]
    const [, project] = buildMessages({ systemPrompt: 'S', transcript, files: three, message: 'new', projectBudget: 100 })
    expect(project.content).toContain('### b.js')
    expect(project.content).toContain('### c.js')
    expect(project.content).not.toContain('### a.js')
  })
```

Then add a new `describe` block at the end of the file, after the `project files budget` block:

```js
describe('mentionedPaths', () => {
  it('is exported from the package entry', () => {
    expect(mentionedPaths([{ role: 'assistant', mentions: ['a.js'] }])).toEqual(['a.js'])
  })
})
```

Update the import at the top of `packages/agent-loop/test/context.test.js` (line 2) to add `mentionedPaths` from the package entry:

```js
import { buildMessages, CONTEXT_BUDGET, EMPTY_PROJECT, PROJECT_BUDGET, PROJECT_NOTE } from '../src/context.js'
import { mentionedPaths } from '../index.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `packages/agent-loop`): `npx vitest run test/context.test.js`
Expected: FAIL. `mentionedPaths` is not exported (import fails) and the mentions test keeps `### a.js`.

- [ ] **Step 3: Write minimal implementation**

In `packages/agent-loop/src/context.js`, replace the `mentionedPaths` function (lines 26-35) with:

```js
// Paths the model touched, in order; the last mention of a file is the recent one.
export const mentionedPaths = (transcript) => {
  const paths = []
  for (const m of transcript) {
    for (const path of m.mentions ?? []) {
      if (typeof path === 'string') paths.push(path)
    }
    for (const call of m.toolCalls ?? []) {
      if (typeof call.input?.path === 'string') paths.push(call.input.path)
    }
  }
  return paths
}
```

In `packages/agent-loop/index.js`, change line 6 to export it:

```js
export { buildMessages, CONTEXT_BUDGET, mentionedPaths, projectMessage } from './src/context.js'
```

- [ ] **Step 4: Add the provider guard test**

In `packages/agent-loop/test/providers.test.js`, add this test inside the top-level `describe('providers', ...)` block (after the `'rejects unknown provider kinds'` test at line 76):

```js
  it('never sends a message mentions field to a provider', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'done', mentions: ['main.js'] },
    ]
    const posted = async (selection) => {
      fetchMock.mockClear()
      fetchMock.mockResolvedValue(new Response(sseBody('')))
      const provider = createProvider(selection)
      for await (const e of provider.send(messages, [])) void e
      return JSON.stringify(JSON.parse(fetchMock.mock.calls.at(-1)[1].body))
    }
    expect(await posted({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })).not.toContain('mentions')
    expect(await posted({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })).not.toContain('mentions')
    expect(await posted({ kind: 'meta', apiKey: 'k', model: 'muse-spark-1.3' })).not.toContain('mentions')
  })
```

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir `packages/agent-loop`): `npx vitest run test/context.test.js test/providers.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/src/context.js packages/agent-loop/index.js packages/agent-loop/test/context.test.js packages/agent-loop/test/providers.test.js
git commit -m "feat(agent-loop): rank project files by a mentions list"
```

---

### Task 2: app records and forwards mentions

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js` (`forModel` ~30-35, module scope ~106, `handleTool` ~339, `runTurnLocal` ~379-382)
- Test: `apps/jscad-web/test/aiChat.test.js` (rewrite the `'keeps stored tool calls...'` test at ~791; add tests in `describe('conversation context')` and `describe('stored conversation')`)

**Interfaces:**
- Consumes: `buildMessages`'s `mentions` recency from Task 1 (an assistant turn's `mentions` ranks the block).
- Produces: a live turn's persisted assistant message carries `mentions: string[]`; `forModel` forwards `mentions` and no longer forwards `toolCalls`.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/test/aiChat.test.js`, replace the test `'keeps stored tool calls in the transcript so the context can rank project files'` (lines 791-810) with:

```js
  it('keeps a stored mentions list so the context can rank project files', async () => {
    const stored = [
      { role: 'user', content: 'make a cube' },
      { role: 'assistant', content: 'done', mentions: ['cube.js'] },
    ]
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const { q, type } = openChat({
      runTurnFn,
      storage: { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation: vi.fn(async () => {}) },
      projectId: 'p1',
    })
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('done'))
    type('again')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(runTurnFn.mock.calls[0][0].conversation.messages[2]).toEqual({
      role: 'assistant',
      content: 'done',
      mentions: ['cube.js'],
    })
  })
```

In `describe('stored conversation', ...)` (after the `'loads a stored conversation and persists the turn'` test at line 514), add:

```js
  it('records the paths a turn touched as mentions on the persisted reply', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const writeConversation = vi.fn(async () => {})
    initChat({
      container,
      requestTool: async () => ({ ok: true }),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn: async ({ requestTool, onText }) => {
        await requestTool('write', { path: 'src/a.js', content: 'x' })
        await requestTool('list', {})
        onText('done')
        return { messages: [] }
      },
      storage: { readConversation: async () => null, writeConversation },
      projectId: 'p1',
    })
    container.querySelector('.chat-input').value = 'add a file'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({
      role: 'assistant',
      content: 'done',
      mentions: ['src/a.js'],
    }))
  })

  it('keeps the mentions of a stopped turn', async () => {
    const writeConversation = vi.fn(async () => {})
    const storage = { readConversation: async () => null, writeConversation }
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void (async () => {
          await options.requestTool('write', { path: 'a.js', content: 'x' })
          options.onText('Writing')
        })()
      }))
    const { q, type } = openChat({ runTurnFn, requestTool: async () => ({ ok: true }), storage, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('Writing'))
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(writeConversation.mock.calls.at(-1)[1]).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Writing', stopped: true, mentions: ['a.js'] },
    ])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `apps/jscad-web`): `npx vitest run test/aiChat.test.js`
Expected: FAIL. The stored-mentions test gets `messages[2]` without `mentions`; the live-turn tests get no `mentions` on the persisted reply.

- [ ] **Step 3: Implement the app change**

In `apps/jscad-web/src/aiChat.js`, replace the `forModel` comment and body (lines 27-35) with:

```js
// A stopped reply may be empty, and providers refuse an empty assistant message.
// Stored reasoning stays on the page: the model never gets it back. A reply's
// mentions come through, since `buildMessages` reads their paths for recency.
const forModel = (m) => {
  const base = { role: m.role, content: m.content }
  if (m.stopped) base.content = m.content ? `${m.content}\n\n${STOPPED_NOTE}` : STOPPED_NOTE
  if (m.role === 'assistant' && m.mentions?.length > 0) base.mentions = m.mentions
  return base
}
```

Add a module-scope list beside `turnReasoning` (after line 106, `let turnReasoning = []`):

```js
  let turnMentions = []
```

In `handleTool` (line 339), record the path as the first statement:

```js
  const handleTool = async (name, input) => {
    if (typeof input?.path === 'string') turnMentions.push(input.path)
    if (live()) { endReasoning(); assistantEl = null }
```

In `runTurnLocal`, reset the list where `turnReasoning` is reset (line 381):

```js
    turnReasoning = []
    turnMentions = []
```

In `runTurnLocal`, replace the `reply` builder (line 382) with:

```js
    const reply = (fields) => ({ role: 'assistant', content: assistantText, ...fields, ...(turnMentions.length > 0 ? { mentions: [...turnMentions] } : {}), ...(turnReasoning.length > 0 ? { reasoning: turnReasoning } : {}) })
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `apps/jscad-web`): `npx vitest run test/aiChat.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js
git commit -m "feat(jscad-web): record the paths a turn touched for file recency"
```

---

### Task 3: eval carries mentions into `prior`

**Files:**
- Modify: `packages/agent-loop/eval/run-eval.js:9,282-283`
- Test: `packages/agent-loop/eval/followups.test.js:42-45`

**Interfaces:**
- Consumes: `mentionedPaths` from Task 1 (`../index.js`).
- Produces: each rebuild of `prior` in the eval carries the turn's touched paths as `mentions` on its assistant entry.

- [ ] **Step 1: Update the failing test**

In `packages/agent-loop/eval/followups.test.js`, replace the assertion at lines 42-45 with:

```js
    expect(second.slice(1, 3)).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Here is a cube. Saved.', mentions: ['main.js'] },
    ])
```

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `packages/agent-loop`): `npx vitest run eval/followups.test.js`
Expected: FAIL. The second provider call's assistant entry has no `mentions`.

- [ ] **Step 3: Implement the eval change**

In `packages/agent-loop/eval/run-eval.js`, change the import at line 9 to add `mentionedPaths`:

```js
import { buildMessages, buildSystemPrompt, createProvider, DEFAULT_API, mentionedPaths, runTurn } from '../index.js'
```

Replace lines 282-283 with:

```js
    const reply = replyText(turnMessages.slice(messages.length))
    const mentions = mentionedPaths(turnMessages.slice(messages.length))
    prior = [...prior, { role: 'user', content: message }, ...(reply ? [{ role: 'assistant', content: reply, ...(mentions.length > 0 ? { mentions } : {}) }] : [])]
```

- [ ] **Step 4: Run test to verify it passes**

Run (workdir `packages/agent-loop`): `npx vitest run eval/followups.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/eval/run-eval.js packages/agent-loop/eval/followups.test.js
git commit -m "feat(agent-loop): carry mentions into the eval's follow-up context"
```

---

### Task 4: docs, backlog, and working-document cleanup

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md:789-792`
- Modify: `packages/agent-loop/docs/architecture.md:179-181`
- Modify: `packages/agent-loop/docs/user-manual.md:36-37,786-787`
- Modify: `docs/backlog.md` (delete the API16 bullet and its Finding-ID table row)
- Delete: `docs/superpowers/specs/2026-10-12-project-files-recency-design.md`
- Delete: `docs/superpowers/plans/2026-10-12-project-files-recency.md`

**Interfaces:**
- Consumes: the `mentions` channel from Tasks 1-3.

- [ ] **Step 1: Update the app architecture doc**

In `apps/jscad-web/docs/architecture.md`, replace lines 789-792:

```
the oldest-mentioned are dropped first, ordered by the `toolCalls[].input.path`
the transcript carries. `forModel` in `src/aiChat.js` passes an assistant
reply's tool calls through so an earlier call can order the block, and drops
the stored reasoning before `buildMessages` sees it.
```

with:

```
the oldest-mentioned are dropped first, ordered by the `mentions` paths the
transcript carries. `forModel` in `src/aiChat.js` passes an assistant reply's
`mentions` — the project paths its tools touched — through so an earlier call
can order the block, and drops the stored reasoning before `buildMessages`
sees it.
```

- [ ] **Step 2: Update the agent-loop architecture doc**

In `packages/agent-loop/docs/architecture.md`, replace lines 179-181:

```
files have their own 24,000-character budget (`PROJECT_BUDGET`); past it the
files mentioned longest ago go first, ordered by the `toolCalls[].input.path`
their turns carry, so those the model touched most recently stay. Binary files
```

with:

```
files have their own 24,000-character budget (`PROJECT_BUDGET`); past it the
files mentioned longest ago go first, ordered by the `mentions` paths their
turns carry, so those the model touched most recently stay. Binary files
```

- [ ] **Step 2b: Update the agent-loop user manual**

In `packages/agent-loop/docs/user-manual.md`, replace lines 36-37:

```
default); when they exceed it the oldest-mentioned go first, ranked by the
paths in the transcript's `toolCalls`, and binary files are skipped. The
```

with:

```
default); when they exceed it the oldest-mentioned go first, ranked by the
paths in the transcript's `mentions` (or `toolCalls[].input.path`), and binary
files are skipped. The
```

And replace lines 786-787:

```
app sends a later message: the earlier messages and the text of each reply
(tool calls left out), then the project's files and its build, after the
```

with:

```
app sends a later message: the earlier messages and the text of each reply,
each carrying the paths its tools touched as `mentions`, then the project's
files and its build, after the
```

- [ ] **Step 3: Delete the backlog item**

In `docs/backlog.md`, delete the bullet beginning `- Recency ordering for the project-files block is inert in the app.` (the whole 8-line bullet) and the table row `| API16 | Chat API help | Low | \`apps/jscad-web/src/aiChat.js\` |`.

- [ ] **Step 4: Delete the working documents**

```bash
git rm docs/superpowers/specs/2026-10-12-project-files-recency-design.md docs/superpowers/plans/2026-10-12-project-files-recency.md
```

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/docs/architecture.md packages/agent-loop/docs/architecture.md packages/agent-loop/docs/user-manual.md docs/backlog.md
git commit -m "docs: document the mentions recency channel and drop the backlog item"
```

---

## Self-Review

**Spec coverage:**
- `mentions` field and flow → Tasks 1-3.
- `mentionedPaths` reads `mentions` and keeps `toolCalls` → Task 1.
- Export → Task 1.
- App live/resume/stop → Task 2.
- Eval `prior` → Task 3.
- Provider adapters unchanged, guard test → Task 1 Step 4.
- Docs and backlog → Task 4.
- No storage schema change → no task needed (verified already).

**Placeholder scan:** none.

**Type consistency:** `mentionedPaths(transcript) → string[]` defined in Task 1, imported from `../index.js` in Task 3. `mentions: string[]` on assistant messages used identically in Tasks 1-3. `forModel` forwards `m.mentions`; `reply()` writes `turnMentions`.
