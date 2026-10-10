# Chat reliability batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat turns fail cleanly: a refused or failed turn leaves no poisoned user message behind, a storage failure reaches the model instead of a warning, and the degrees hint stops firing on float noise just over 2π.

**Architecture:** Restore the pre-turn transcript on turn error (aiChat); let the storage promise reject into the write tool (main.js one-liner, behavior pinned in aiDeps); gate the angle check on distance to the nearest multiple of τ (optionChecks).

**Tech Stack:** ES2022, vitest (`/** @vitest-environment jsdom */` for chat DOM tests).

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run package-scoped vitest files, not the full OpenSCAD suite locally.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0.
- YAGNI: drop (not mark) failed user messages; report (not retry) storage failures; no new tools, no fixtures.
- Commit each task separately on the current branch (working in place per user choice).
- The pre-commit hook is red on a pre-existing unrelated failure (`apps/jscad-web/test/storage-rowboat.test.js`, tracked in `docs/backlog.md` Remaining issues). When scoped gates are green and the hook blocks only on that failure, commit with `--no-verify` and say so in the report.

---

### Task 1: Drop a failed turn's user message from the stored transcript

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js`
- Test: `apps/jscad-web/test/aiChat.test.js`

**Interfaces:**
- Consumes: `runTurnLocal` in `apps/jscad-web/src/aiChat.js:293-358`; `prior` (pre-turn transcript) at `:301`; `persistTranscript()` writing `transcript` via storage.
- Produces: on a non-abort turn error, `transcript` is restored to `prior` and persisted, so a retry sends the message exactly once. The abort path (`stopped` reply) is unchanged; the on-screen error message is unchanged.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/test/aiChat.test.js`, inside the turn `describe` that holds the `openChat` helper (near the reasoning-persistence tests at `:318-361`), add:

```js
it('drops a failed turn\u2019s user message so a retry sends it once', async () => {
  const writeConversation = vi.fn(async () => {})
  const runTurnFn = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('the provider refused to answer'), { name: 'RefusalError' }))
    .mockImplementation(async ({ onText }) => {
      onText('ok')
      return { messages: [] }
    })
  const chat = openChat({ runTurnFn, storage: { readConversation: async () => null, writeConversation }, projectId: 'p1' })
  chat.type('first')
  await vi.waitFor(() => expect(chat.q('.chat-msg.error')?.textContent).toBe('the provider refused to answer'))
  await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toEqual([]))
  chat.type('second')
  await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(2))
  const sent = runTurnFn.mock.calls[1][0].conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)
  // buildMessages prepends a role-user project note, so the sent user roles
  // are [note, 'second'], not ['second'].
  expect(sent).not.toContain('first')
  expect(sent.at(-1)).toBe('second')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/test/aiChat.test.js -t "drops a failed"`
Expected: FAIL. The stored transcript keeps `[{role:'user',content:'first'}]` and the retry sends both messages.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/aiChat.js`, in the `catch` of `runTurnLocal` (`:343-346`), restore the pre-turn transcript on a non-abort error:

```js
} catch (err) {
  endReasoning()
  if (signal.aborted) stopped = true
  else {
    transcript = prior
    persistTranscript()
    addMessage(err.message, 'error')
  }
} finally {
```

Nothing else changes: the abort path still stores `reply({ stopped: true })`, success still appends the reply.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/aiChat.test.js`
Expected: PASS, all tests including the new one; existing persistence tests (`stores the reasoning with the reply`, `stores the reasoning of a stopped reply too`) unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js
git commit -m "fix(chat): drop a failed turn's user message so a retry sends it once"
```

### Task 2: Fail the write tool when storage fails instead of warning

**Files:**
- Modify: `apps/jscad-web/main.js`
- Test: `apps/jscad-web/test/aiDeps.test.js`

**Interfaces:**
- Consumes: `storeFile` dep of `createProjectTools` (`apps/jscad-web/src/aiDeps.js:47-58` `save()` awaits `storeFile` before `build`); wired in `apps/jscad-web/main.js:944-945` with a swallowing `.catch`.
- Produces: a storage rejection fails the write/edit tool with that error (the chat's `handleTool` already turns tool errors into `{ok:false}` results), `build` does not run, and no snapshot is recorded for the unwritten project.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/test/aiDeps.test.js`, inside `describe('storage', ...)` (after the mid-turn test at `:110-118`), add:

```js
it('fails the write when storage fails, instead of answering a build', async () => {
  const project = fakeProject({ 'main.js': 'v0' })
  const storeFile = vi.fn(async () => {
    throw new Error('offline')
  })
  const { deps, tools: t } = tools({ project, storeFile })
  await expect(t.write({ path: 'main.js', content: 'v1' })).rejects.toThrow('offline')
  expect(deps.build).not.toHaveBeenCalled()
})
```

(`fakeProject` and `tools()` are the file's existing helpers at `:10-50`; `t.write` rejects today only if `storeFile` rejects — with the default `vi.fn(async () => {})` it resolves, so this test fails only after the main.js wiring change is understood: note the test pins `save()` behavior, which already propagates. The RED comes from asserting the app wiring; see Step 3.)

- [ ] **Step 2: Run test to verify status**

Run: `npx vitest run apps/jscad-web/test/aiDeps.test.js -t "fails the write when storage fails"`
Expected: PASS even before the fix — `save()` already propagates a rejecting `storeFile`. This test locks the contract the app wiring must honor. (If it fails, the save path changed; stop and report NEEDS_CONTEXT.)

- [ ] **Step 3: Change the app wiring**

In `apps/jscad-web/main.js:943-945`, remove the swallowing catch so a failed rowboat write fails the chat write instead of leaving the cache ahead of storage:

```js
// Stored at once, so a reload mid-turn keeps it; a failure fails the
// write tool, so the model sees it and can retry instead of the cache
// silently running ahead of storage.
storeFile: (projectId, path, content) =>
  storageSession.writeThrough(projectId, path, content, { message: 'chat', version: false }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/aiDeps.test.js apps/jscad-web/test/disk-project.test.js`
Expected: PASS. (`disk-project.test.js:151` wires its own `storeFile` through to `writeThrough` without a catch, confirming the non-swallowing shape is already the tested pattern elsewhere.)

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/main.js apps/jscad-web/test/aiDeps.test.js
git commit -m "fix(chat): fail the write tool when storage fails instead of warning"
```

### Task 3: Ignore angles within float noise of a multiple of 2π

**Files:**
- Modify: `packages/agent-loop/src/optionChecks.js`
- Test: `packages/agent-loop/test/optionChecks.test.js`

**Interfaces:**
- Consumes: `degreeLike` in `packages/agent-loop/src/optionChecks.js:24-29` (`TAU`, `EPS`); exercised by `withOptionChecks` angle wrapping (existing test at `test/optionChecks.test.js:162-175`).
- Produces: values within 0.01 rad of any multiple of τ are not degree-flagged; 90, -180, 6.5 still are; exactly τ still is not. `EPS` (whose only use is the old gate) is removed.

- [ ] **Step 1: Write the failing test**

In `packages/agent-loop/test/optionChecks.test.js`, inside `describe('withOptionChecks: types, angles and thrown errors', ...)` after the angle test (`:162-175`), add:

```js
it('ignores an angle within float noise of 2π', () => {
  const rotateX = vi.fn((angle, shape) => shape)
  const warn = vi.fn()
  const wrapped = withOptionChecks({ transforms: { rotateX } }, typed, warn).transforms.rotateX
  wrapped(Math.PI * 2 + 0.0012, 's')
  wrapped(6.5, 's')
  expect(warn.mock.calls.map(([w]) => w)).toEqual([{ fn: 'transforms.rotateX', option: 'angle', value: 6.5 }])
  expect(rotateX).toHaveBeenCalledTimes(2)
})
```

(`typed` is the describe-scope fixture at `:143-148`; the new test must live inside that describe.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-loop/test/optionChecks.test.js -t "float noise"`
Expected: FAIL. `Math.PI * 2 + 0.0012` warns today.

- [ ] **Step 3: Write minimal implementation**

In `packages/agent-loop/src/optionChecks.js:24-29`, replace the gate:

```js
const TAU = Math.PI * 2
// Float noise lands just over a multiple of 2π (6.284386356666759 read as
// degrees once); values that close to a multiple are radians, not degrees.
const TAU_MARGIN = 0.01
const nearMultipleOfTau = (a) => {
  const r = Math.abs(a) % TAU
  return Math.min(r, TAU - r) <= TAU_MARGIN
}

const degreeLike = (angle) => [angle].flat().find((a) => typeof a === 'number' && Math.abs(a) > TAU && !nearMultipleOfTau(a))
```

(`EPS` at `:25` loses its only use; remove it. Line 101's EPS is prose in a comment and stays.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/agent-loop/test/optionChecks.test.js packages/agent-loop/test/hints.test.js`
Expected: PASS, including the existing `reports an angle over 2π` test (90/-180 still flagged, τ and -π still quiet) and the hints angle test (90 still hinted).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/optionChecks.js packages/agent-loop/test/optionChecks.test.js
git commit -m "fix(hints): ignore angles within float noise of a multiple of 2pi"
```
