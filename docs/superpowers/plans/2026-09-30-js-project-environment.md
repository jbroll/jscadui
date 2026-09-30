# JS project environment for the chat agent

The chat model works in a JavaScript project the way a coding agent does:
standard file tools, a Node-style entry point, and a watched build that runs
on every write. Working document; delete before merge after folding the
design into `packages/agent-loop/docs/architecture.md` and
`apps/jscad-web/docs/architecture.md`.

Branch: `chat-review-4` (on top of the baseline-review fixes). One CI eval run
measures everything at the end.

## Contract

### Tools (agent-loop `src/tools.js`, mirrored in `apps/jscad-web/server/src/agent/tools.ts`)

Names and argument shapes follow the common coding-agent tools, so models
use them without teaching:

| tool | input | result |
|---|---|---|
| `list` | none | project file paths with sizes |
| `read` | `path`, optional `offset`, `limit` (lines) | the file with line numbers |
| `write` | `path`, `content` | build report (below) |
| `edit` | `path`, `oldString`, `newString`, optional `replaceAll` | build report; error if `oldString` is missing or not unique (unless `replaceAll`) |
| `run` | `source` | scratch run of a snippet, never saved: console output, return value summary, errors with line/column. Replaces `eval` for experiments. |
| `measure` | as today | unchanged, on the current build |
| `check` | as today | unchanged, on the current build |
| `export` | as today | unchanged |
| `docs` | as today | unchanged |

Removed: `eval`, `writeModel`, `params` (the build report carries the
parameters). A write is a save: there is no separate save step and no
`notSaved` notice. Deleting a file: `write` with empty content is not a
delete; add `delete` only if a fixture needs it (not now).

### Entry resolution

Node style: `package.json` `main` if present, else `index.js`, else
`main.js`. The prompt explains this layout. Model code stays CommonJS with
`module.exports = { main }` as today.

### Build report (result of every `write` and `edit`)

Short, JSON:

```
{ ok, entry, error?: { message, file, line, column },
  warnings: [...], console: [...],
  params: [{ name, type, default, ... }],
  geometry?: { parts, boundingBox, dimensions, volume, watertight } }
```

`geometry` only when the build succeeds. Units mm. Same shape in the app and
the eval.

### Project state with each user message

The per-turn header (`src/context.js` `buildMessages`) carries the project
files, as today, plus the last build report for the project, so the model
starts each turn knowing whether it builds and what it produces (including
breakage from the user's own editor changes).

### App behaviour

- Every `write`/`edit` updates the project file cache and triggers the same
  build the editor uses; the report comes from that build.
- A failed build keeps the last good render on screen and shows the error;
  it does not clear the viewer.
- Versions: one version per chat turn (the turn's final state), not per
  write.
- The editor shows the file the model last wrote.

### Eval

- The eval backend implements the same tools and build report in the
  sandboxed executor (crt), with the same entry resolution.
- Fixtures: `requires` uses `write` (or `write`/`edit`) instead of
  `writeModel`; `transcript`/`files` fixtures work unchanged.
- Grading scores the project's final state (the last successful build of the
  entry). A run whose final state does not build gets geometry 0.
- Conservation: counts failed builds and failed tool calls, not writes.
  Saving often never costs points.
- `--regrade` handles old result files (writeModel/eval transcripts) and new
  ones.

### Prompt

`prompt.md` Tool policy and project section rewritten for the new tools:
the project layout and entry rules; edit small changes with `edit`, write new
files with `write`; every write builds and reports; use `measure`/`check` to
verify; `run` for scratch. The save-policy and notSaved lines go. Keep the
millimetre line. Examples stay single-file `main.js` models.

## Tasks

1. **agent-loop + eval** (packages/agent-loop, eval backend, executor
   protocol, sandbox, grader, regrade, fixtures' `requires`, prompt, docs).
   Defines the tool schemas and build report every other task consumes.
2. **app** (apps/jscad-web: aiBridge/aiDeps/aiChat/aiEvaluate, save tracker
   removal, per-turn versions, keep-last-good render, server `tools.ts`,
   worker/frame plumbing if needed, docs).
3. **Final review** of the whole branch, then one CI eval run against the
   regraded 18-fixture baseline.
