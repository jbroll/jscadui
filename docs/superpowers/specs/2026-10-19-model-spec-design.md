# Model spec — per-project long-lived instructions — design

Date: 2026-10-19. Worktree: wt1.

How it gets made: a `model-spec` skill plus a per-project spec file the agent maintains with the tools it already has, inlined into every turn.

## Intent and why

The user repeats themselves. They open a chat and say "model in mm, my printer is a Prusa MK3, I like rounded corners, holes must fit M3 screws" — and two chats later the agent has forgotten all of it, because transcript history evicts and summaries compress. Corrections suffer the same fate: "no, always leave 0.2 mm clearance" fixes this turn and vanishes the next.

The idea: a long-lived model spec per project. Positive, durable user instructions — initial prompts and later corrections alike — get integrated into one living document the agent itself maintains, and that document rides every turn, so every chat starts knowing what this user wants from this model.

Success: a user states a preference once, and chats tomorrow still honor it without being reminded.

## Goals

- One spec file per project holds durable user instructions about the model: design intent, units, printer, fits and clearances, style and conventions.
- The agent writes the first version from the user's initial prompt and merges later corrections into it, unprompted, as part of normal turns.
- The full spec body loads every turn, so it survives history eviction and summarization.
- The user can read and edit the file directly; it lives with the project files.
- A `model-spec` skill teaches the agent the maintenance procedure (what counts as spec-worthy, when to update, how to merge); it is listed in the default skill index like the other starter skills.

## Non-goals (my call)

- No cross-project memory. Each project carries its own spec; a user's printer living in project A does not leak into project B. A global profile is follow-up work, not this spec.
- No version history or diff UI for the spec beyond what the file already gives (it is a normal project file).
- No new tool. The agent maintains the spec with `read`/`write`/`edit`, which keeps the tool catalog and `dispatchTool` untouched.
- No automatic backfill: existing chats do not get a spec synthesized from old transcripts. The spec starts at the next user instruction.

## Anti-goals (my call)

- Writing ephemeral content into the spec fails even if the plumbing works: one-off sizes ("make it 42 mm"), throwaway debugging, and turn-local decisions must stay out, or the spec rots into a second transcript.
- Loading the spec through an extra model round-trip fails on cost: no `read` call per turn to fetch it; it arrives with the turn's existing project state.
- A spec the user cannot see or edit fails on trust: no hidden storage, no localStorage sidecar. It is a project file, persisted and synced exactly like `main.js`.

## Constraints

- Skill bodies are capped at `SKILL_BUDGET` (2000 chars, `packages/agent-loop/src/skills.js:4`): the `model-spec` procedure must fit, so it stays a tight checklist, not an essay.
- The wire body stays under the relay's 1 MB limit via `TOTAL_BUDGET` (55,000 chars, `packages/agent-loop/src/context.js:13`); the spec rides inside the project message's `PROJECT_BUDGET` (24,000), so it gets its own sub-budget with truncation, never an unbounded inline.
- `test/` and `notes/` paths are excluded from builds and entry resolution (`isTestOrNotesPath`, `packages/agent-loop/src/project.js:176`) and note bodies never inline in `filesSection` (`context.js:52`): the spec path must either live under `notes/` with an explicit inline carve-out, or live outside `notes/` and accept appearing in the files listing. Builder picks; the document assumes `notes/model-spec.md` (my call) since build-exclusion and user expectations around notes already fit.
- The eval backend shares `projectMessage` and the file tools (`project.js:1-3`), so whatever loads the spec must work identically in eval and app — no app-only wiring.
- Chat logging already persists project files; the spec inherits that handling, including its privacy posture. Nothing new to decide there.

## The parts as decided

- **File:** `notes/model-spec.md` (my call). Created on the first spec-worthy instruction, updated as instructions arrive. Absent until then: no empty template, no heading, nothing sent — mirroring how `partsBlock` adds nothing when empty (`prompt.js:34-35`).
- **Per-turn loading:** the full body inlines in the project message under its own header (e.g. `Model spec:`), capped to a sub-budget (suggested 4000 chars, builder sets the constant). Overflow truncates the oldest lines first with a `[truncated]` note, so newest corrections always survive. It counts against `PROJECT_BUDGET`, not `NOTES_BUDGET`, and it bypasses the notes index — it is content, not a pointer.
- **Skill:** `model-spec` added to `SKILLS` (`prompt/index.js:36`), so its one-line description joins the default system-prompt index and the body serves through the existing `skill` tool. "Loaded by default" means exactly this: indexed in every system prompt like the other starter skills, with the spec body itself inlined every turn — no new load path, no prompt surgery beyond the index line the skill gets for free.
- **Procedure (the skill body):** when the user states a durable preference or corrects the agent ("always…", "remember…", "from now on…", plus durable content inside initial prompts), merge it into `notes/model-spec.md` with `read` then `write`/`edit`: one line per rule, newest wins on conflict (replace, don't append contradictions), keep sections `Intent`, `Constraints & preferences`, `Decisions`. Never write one-off values, turn-local choices, or anything the user flagged as temporary. The update happens in the same turn as the modeling work, with the file tools the turn already uses — no separate pass, no user confirmation for routine merges; the file is visible for the user to fix.
- **Discovery:** one line in the Tool policy section of `prompt.md` pointing at the skill (builder words it), so the model knows spec maintenance is part of every turn, not just when it thinks to load the skill.

## Builder-check resolutions (my call)

- **In-turn override vs rewrite:** an instruction that contradicts the spec applies to the current turn as-is. It rewrites the spec only when phrased as durable ("always", "from now on", "remember") or when the user repeats it after being told the spec says otherwise. One-offs never poison the spec; durable rules are never silently ignored.
- **File-level pruning:** the skill also tells the agent to compact the file when it approaches the sub-budget: merge redundant lines, drop superseded rules, keep one line per rule. Prompt truncation is the backstop, not the strategy, so no rule is ever silently shadow-banned.
- **Spec-worthy test (one line for the skill):** would this still apply to a different part or a future task in this project? Printer, units, clearances, fits, style, conventions: yes. A specific size, a debugging step, a turn-local choice: no.
- **Scope:** model and project instructions only (intent, units, printer, fits, style, conventions). Chat-behavior preferences ("explain before writing") stay out; that is a different memory, not this spec.
- **Retractions:** "forget X" / "stop doing Y" deletes the line entirely, never strikes or keeps it. A revoked rule must not ride another turn.
- **Budget priority:** the spec reserves its sub-budget first; project code files give way under `PROJECT_BUDGET` pressure. The spec is small and the point is that it survives every turn on large projects too.
- **Hand-edits:** the agent merges with minimal `edit` calls on specific lines and never rewrites the whole file to re-impose the schema. User structure and prose survive agent merges; no edit wars.

## What's left to the builder

- Exact header text, budget constant name and value, and truncation direction in `context.js` (`projectMessage`/`filesSection` area), plus the `notes/model-spec.md` carve-out from the `notes/` inline exclusion.
- Exact `model-spec` skill body within `SKILL_BUDGET`, and the one Tool-policy line in `prompt.md`.
- `SKILLS` registration in `prompt/index.js` and any asset wiring the build needs for a new skill markdown file (follow the existing `?raw` imports).
- Tests: spec inlines every turn when present and absent when missing; overflow truncates with the note; skill serves via the `skill` tool; `write`/`edit` of the spec path never triggers geometry builds or the code-write test gate (confirm `isTestOrNotesPath` already covers it — it should, since the path is under `notes/`).
- E2E: a turn with a durable instruction writes/merges the spec file; the next turn's project message carries it.
- Docs: user-manual entry for the spec file (what it is, that the user can edit it), and whether the chat panel surfaces spec updates in the tool row like other writes (it will, as a `write`/`edit` row, for free).
