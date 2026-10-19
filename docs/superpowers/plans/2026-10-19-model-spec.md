# Model Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durable per-project user instructions persist in `notes/model-spec.md`, inline whole every turn, maintained by the agent via a `model-spec` skill.

**Architecture:** New `src/modelSpec.js` module owns the spec path, budget, and section renderer, wired into `projectMessage` ahead of code-file trimming; new `prompt/skills/model-spec.md` skill registered in `SKILLS`; one Tool-policy line in `prompt.md`.

**Tech Stack:** ES2022 modules, vitest, existing agent-loop budgets and file tools (no new tool, no new dependency).

**Spec:** `docs/superpowers/specs/2026-10-19-model-spec-design.md`

## Global Constraints

- Skill bodies are capped at `SKILL_BUDGET` (2000 chars, `packages/agent-loop/src/skills.js:4`); starter skills stay under 250 words (`test/skills-content.test.js:5`).
- The whole turn stays under `TOTAL_BUDGET` (55,000 chars); project files ride under `PROJECT_BUDGET` (24,000) (`src/context.js:4-13`).
- `test/` and `notes/` paths never build and never run the code-write test gate (`isTestOrNotesPath`, `src/project.js:176`; `isCodePath`, `src/project.js:202`).
- No app-only wiring: the eval backend shares `projectMessage` and the file tools, so the spec path works identically in eval and app.
- The spec is a plain project file; no hidden storage, no new tool, no `dispatchTool` change.

## Review Focus

- A `write` to `notes/model-spec.md` must not trigger a geometry build or the test suite — expect `isCodePath('notes/model-spec.md')` false and eval-backend write answering without build output.
- A huge `main.js` beside a present spec must keep the full spec and trim code files instead — expect the project message to contain the complete spec body.
- An oversized spec keeps its newest lines and marks the cut — expect a `[truncated]` note and the tail content present.
- A missing spec changes nothing — expect no `Model spec` heading anywhere in the message.
- A skill body that drifts past budget silently degrades — expect the word-count test to cover the new skill id.

---

### Task 1: `model-spec` skill file and registration

**Files:**
- Create: `packages/agent-loop/prompt/skills/model-spec.md`
- Modify: `packages/agent-loop/prompt/index.js:19-41`
- Test: `packages/agent-loop/test/skills-content.test.js:4-10`

**Model:** `haiku` — transcribe the exact body below, add one import plus one index line, extend an id list; no design judgment.

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `SKILLS['model-spec']` body string; `description: Keep the project's model spec current with durable user instructions.` for Task 3's prompt test (auto-covered by the existing index loop).

**Exact skill body** (transcribe verbatim; 130 words, well under both caps):

```markdown
---
description: Keep the project's model spec current with durable user instructions.
---

1. Spec-worthy test: would this still apply to a different part or a future task here? Printer, units, clearances, fits, style: yes. One-off sizes, debugging, turn-local choices: no.
2. On a durable instruction or correction, read notes/model-spec.md (absent means create it), then merge with minimal edits: one line per rule, sections Intent, Constraints & preferences, Decisions.
3. Newest wins: replace contradicted lines, never append contradictions. Retractions ("forget X") delete the line.
4. A one-off override applies to this turn only and never touches the spec.
5. Keep it compact: merge redundancies when nearing length; chat-behavior preferences stay out.
```

Registration follows the existing pattern: `import modelSpecSkill from './skills/model-spec.md?raw'` plus `model-spec: modelSpecSkill,` in `SKILLS`, alphabetical placement beside the other skill imports.

- [ ] **Step 1: Write the failing test** — in `test/skills-content.test.js`, extend the id list to `['brainstorming', 'writing-plans', 'executing-plans', 'systematic-debugging', 'model-spec']` (same 250-word assertion, no other change).
- [ ] **Step 2: Run it to verify it fails** — Run: `npx vitest run test/skills-content.test.js` in `packages/agent-loop`. Expected: FAIL (`SKILLS['model-spec']` undefined).
- [ ] **Step 3: Create the skill file and register it** — transcribe the body above to `prompt/skills/model-spec.md`; add the `?raw` import and `SKILLS` entry in `prompt/index.js`.
- [ ] **Step 4: Run the skill and prompt tests to verify they pass** — Run: `npx vitest run test/skills-content.test.js test/prompt.test.js test/skills.test.js` in `packages/agent-loop`. Expected: PASS (the prompt index loop in `prompt.test.js:86-97` covers the new skill automatically).
- [ ] **Step 5: Commit** — `git add packages/agent-loop/prompt/skills/model-spec.md packages/agent-loop/prompt/index.js packages/agent-loop/test/skills-content.test.js` with message `feat(agent-loop): model-spec skill for durable user instructions`.

### Task 2: Spec section inlined in every project message

**Files:**
- Create: `packages/agent-loop/src/modelSpec.js`
- Modify: `packages/agent-loop/src/context.js:97-109` (`projectMessage`)
- Test: `packages/agent-loop/test/modelSpec.test.js` (new)

**Model:** `sonnet` — new module plus budgeting interplay in `projectMessage` needs judgment within the invariants below.

**Interfaces:**
- Consumes: `SKILLS` registration from Task 1 (only the path string `notes/model-spec.md`, already fixed — no code dependency; tasks are parallel-safe).
- Produces: `SPEC_PATH = 'notes/model-spec.md'`, `SPEC_BUDGET = 4000`, `SPEC_HEADER = 'Model spec:'`, `specSection(files, budget = SPEC_BUDGET) -> string | null` for Task 4's e2e assertions.

**Invariants (pin these, mechanism is the builder's):**
- `specSection` returns `null` when `files[SPEC_PATH]` is not a non-empty string; otherwise `` `${SPEC_HEADER}\n\n${body}` `` where `body` is the full file when it fits `SPEC_BUDGET`, else the last `SPEC_BUDGET` chars cut at a line boundary prefixed with a `[truncated: showing the newest N of M characters]` note (newest lines always survive).
- `projectMessage` includes the spec section whenever non-null, positioned after the files listing and before the build section; it is never subject to `filesSection` trimming.
- Under `PROJECT_BUDGET` pressure the full spec survives and code files trim first (reduce the files budget by the spec section length or equivalent — builder's choice, test below decides).
- Binary (non-string) content at `SPEC_PATH` reads as absent, never throws.

- [ ] **Step 1: Write the failing tests** in `test/modelSpec.test.js`:
  - `returns null when the spec file is absent, empty, or binary`
  - `inlines the whole spec under the Model spec header when it fits`
  - `keeps the newest lines with a truncated note when over budget` (build a >4000-char body with distinct first/last lines; assert last line present, first line absent, note present)
  - `projectMessage carries the full spec while trimming code files under budget pressure` (large `main.js` + small spec + tight `projectBudget`; assert full spec present and `main.js` trimmed/listed)
  - `projectMessage with no spec file contains no Model spec heading`
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run test/modelSpec.test.js` in `packages/agent-loop`. Expected: FAIL (`src/modelSpec.js` not defined).
- [ ] **Step 3: Implement `src/modelSpec.js` and wire it into `projectMessage`** per the invariants above.
- [ ] **Step 4: Run the loop test suites to verify nothing regressed** — Run: `npx vitest run test/modelSpec.test.js test/context.test.js test/context-compression.test.js test/notes.test.js` in `packages/agent-loop`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add packages/agent-loop/src/modelSpec.js packages/agent-loop/src/context.js packages/agent-loop/test/modelSpec.test.js` with message `feat(agent-loop): inline model spec in every project message`.

### Task 3: Tool-policy line and user docs

**Files:**
- Modify: `packages/agent-loop/prompt.md:51-92` (one line in Tool policy)
- Modify: `packages/agent-loop/test/prompt.test.js` (one assertion)
- Modify: `packages/agent-loop/docs/user-manual.md` (short subsection)

**Model:** `haiku` — one dictated sentence, one assertion, one prose subsection; transcription only.

**Interfaces:**
- Consumes: `SKILLS['model-spec']` description from Task 1.
- Produces: nothing (terminal docs task).

**Exact prompt line** (append to the Tool policy list in `prompt.md`):
`- Fold durable user instructions into \`notes/model-spec.md\` (load the \`model-spec\` skill); one-off values stay out of it.`

User-manual subsection (place near the project/chat description; ~100 words): what `notes/model-spec.md` is (durable instructions the agent maintains), that it loads every turn, that the user can edit it directly and the agent merges minimally around hand-edits, that one-off requests stay out, that deleting the file resets it.

- [ ] **Step 1: Write the failing test** — in `test/prompt.test.js`, add `it.each(APIS)('%s: tells the model to fold durable instructions into the model spec', ...)` asserting the prompt contains `notes/model-spec.md` and `` `model-spec` ``.
- [ ] **Step 2: Run it to verify it fails** — Run: `npx vitest run test/prompt.test.js` in `packages/agent-loop`. Expected: FAIL (no `model-spec` line in prose).
- [ ] **Step 3: Add the prompt line and the user-manual subsection** as specified above.
- [ ] **Step 4: Run the prompt tests** — Run: `npx vitest run test/prompt.test.js` in `packages/agent-loop`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add packages/agent-loop/prompt.md packages/agent-loop/test/prompt.test.js packages/agent-loop/docs/user-manual.md` with message `docs(agent-loop): model spec policy line and user manual`.

### Task 4: End-to-end spec write and carry

**Files:**
- Test: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (append one test) — follow the existing `view captures` test setup (`startStubRelay`, `openChatWithKey`).
- Test: `apps/jscad-web/test/aiChat.test.js` or agent-loop eval backend test if the e2e proves too heavy (builder's fallback, same assertions at unit level).

**Model:** `sonnet` — e2e stub choreography and fallback judgment.

**Interfaces:**
- Consumes: `specSection`/`projectMessage` behavior from Task 2; `model-spec` skill from Task 1.
- Produces: nothing (terminal verification task; no commit of production code).

**Assertions:** seed a project with `notes/model-spec.md` containing a marker line; run a stub-relay turn; assert the model-bound messages (captured from `stub.requests`) contain the marker, and assert a `write` to the spec path answers without a build report tying it to geometry (notes-path exclusion holds end to end).

- [ ] **Step 1: Write the test** per the assertions above, mirroring the `view captures` test's relay-stub pattern, plus a negative control: the same turn with the spec file deleted carries no `Model spec` heading.
- [ ] **Step 2: Run it to verify the positive assertions fail without the feature** — temporarily point the test at a project without `notes/model-spec.md` (or `git stash` Tasks 1–2) and run: `npx playwright test e2e/ai-chat-tools.spec.js -g "model spec"` in `apps/jscad-web`. Expected: FAIL on the marker assertion, PASS on the negative control. Then restore.
- [ ] **Step 3: Confirm it passes on the implemented tree** — same command. Expected: PASS. If e2e is intractable in the sandbox, implement the same assertions against the eval backend (`createEvalBackend`) in `packages/agent-loop/test/` instead and note the substitution in the commit message.
- [ ] **Step 4: Run the neighboring suites** — Run: `npx vitest run test/aiChat.test.js` in `apps/jscad-web`. Expected: PASS.
- [ ] **Step 5: Commit** — test files only, message `test: model spec carried end to end`.
