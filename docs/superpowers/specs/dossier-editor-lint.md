# Dossier: Editor lint, autocomplete and hover from the API index

## Task

Add CodeMirror 6 lint/autocomplete/hover plugins to `apps/jscad-web/src/editor.js`, driven by the API index (`packages/agent-loop/api/index.json`): lint calls to known functions whose first argument is an object literal (unknown option keys, unknown function names) plus Lezer syntax errors; autocomplete function/option names with defaults; hover shows the `docs` entry. The same check is a pure function over a Lezer tree, so `write`, `edit` and `run` return static warnings beside the runtime ones.

- **Classification:** feature (new shared module + plugins + tool-result changes)
- **Scope:** medium-large (3-6 source files + tests; cross-package)
- Requirement text: `docs/backlog.md:555-565`

## Files to touch

| Path | Role |
|---|---|
| `apps/jscad-web/src/editor.js` | Editor construction; add lint/autocomplete/hover extensions (`init` at 79-156; extensions array 103-122) |
| `packages/agent-loop/src/lint.js` | **New.** Pure lint over a Lezer tree + index; no browser/DOM |
| `packages/agent-loop/index.js` | Export the shared lint (exports list 1-15) |
| `apps/jscad-web/src/aiDeps.js` | Merge static warnings into `write`/`edit`/`run` results (save 56-67, run 83-104, write 111, edit 112) |
| `packages/agent-loop/eval/backend.js` | Same for the eval path (saved 273-277, run 288-295, write 302, edit 303) |
| `apps/jscad-web/src/apiIndex.js` | Reuse index loader for editor plugins (`createIndexLoader` 15-22, `createDocs` 29) |
| `packages/agent-loop/src/tools.js` | Optionally update `write`/`edit`/`run` descriptions (33-78) to mention static warnings |
| tests | see Test setup |

## 1. Editor setup (CodeMirror 6)

- Imports, `apps/jscad-web/src/editor.js:1-5`: `defaultKeymap` from `@codemirror/commands`; `javascript` from `@codemirror/lang-javascript`; `keymap` from `@codemirror/view`; `EditorView, basicSetup` from `codemirror`; `readAsText` from `@jscadui/fs-provider`.
- View construction, `editor.js:102-124`: `new EditorView({ extensions: [basicSetup, javascript(), updateListener, keymap.of([...])], parent: editorDiv })`. Reset/destroy at 85-88 and 306-315.
- The document string is read via `view.state.doc.toString()` (70, 117, 162). Cursor/edits at 165-178.
- **No lint, autocomplete, hover, or `linter()` extension exists today** (grep for `linter|hoverTooltip|autocompletion|syntaxTree|javascriptLanguage` in `apps/jscad-web/src` returned nothing).
- The Lezer tree for the live document: `syntaxTree(view.state)` from `@codemirror/language`; the JS parser is `javascriptLanguage.parser` from `@codemirror/lang-javascript`. `basicSetup` already installs `autocompletion()` (so a custom source is added via `autocompletion({ override })` or `javascriptLanguage.data.of({ autocomplete })`); it does **not** install lint.

### CodeMirror/Lezer packages available

Declared in `apps/jscad-web/package.json`: `@codemirror/lang-javascript ^6.1.9` (L24), `@codemirror/state ^6.2.1` (L25), `codemirror ^6.0.1` (L54). Everything else is transitive and would need declaring if imported directly.

Resolved versions (`package-lock.json`):

| Package | Version | Lock line |
|---|---|---|
| `@codemirror/lang-javascript` | 6.2.1 | 2590 |
| `@codemirror/state` | 6.2.1 | 2637 |
| `@codemirror/view` | 6.18.1 | 2642 |
| `@codemirror/commands` | 6.2.5 | 2579 |
| `@codemirror/language` | 6.9.0 | 2604 |
| `@codemirror/lint` | 6.4.1 | 2617 |
| `@codemirror/autocomplete` | 6.9.0 | 2562 |
| `@codemirror/search` | 6.5.2 | 2627 |
| `codemirror` | 6.0.1 | 8972 |
| `@lezer/javascript` | 1.4.7 | 4723 |
| `@lezer/common` | 1.0.4 | 4710 |
| `@lezer/highlight` | 1.1.6 | 4715 |
| `@lezer/lr` | 1.3.10 | 4732 |

`@codemirror/lang-javascript` itself depends on `@codemirror/autocomplete`, `@codemirror/lint`, `@codemirror/language`, `@codemirror/state`, `@codemirror/view`, `@lezer/common`, `@lezer/javascript` (lock 2594-2602). `codemirror` depends on `@codemirror/lint` and `@codemirror/autocomplete` (lock 8976-8984).

## 2. Docs tool and API index shape

The docs tool is **not** `src/docs.js` in the app; it is split:

- `apps/jscad-web/src/apiIndex.js` — `API_INDEX_BUNDLE = 'build/bundle.api-index.js'` (L6); `createIndexLoader` (15-22) lazily imports the bundle and caches it; `createDocs(loadIndex, getApi)` (L29) calls `docsTool(await loadIndex(), query, { api: getApi() })`.
- `apps/jscad-web/src/apiHelp.js` — `showApiHelp` panel (169-220) uses `createDocs` (L175).
- `apps/jscad-web/main.js` — `const loadApiIndex = createIndexLoader()` (L314); `aiDeps.docs = createDocs(loadApiIndex, getChatApi)` (L946); index passed around as `Array<object>`.
- `packages/agent-loop/src/docs.js` — `docsTool(index, query, options)` (503-506) returns text or `JSON.stringify({ok:false,error})`; `lookupDocs` (491-501) is the structured entry point; `renderFunction` (43-54) + `optionLine` (16-17) format exactly the "docs entry" (signature, description, params, options with defaults).

### Index JSON shape

`packages/agent-loop/api/index.json`: flat JSON **array**, one object per line (`formatIndex`, `build-index.js:186`). 730 lines total (L1 `[`, L730 `]`) → ~728 entries; ~260 KB (`apiIndex.js:3`; `apps/jscad-web/docs/architecture.md:929`). JSDoc: `@param {Array<object>} index` (`docs.js:486`). Generated by `buildIndex()` (`build-index.js:91-97`) → `[...modeling, ...fluent, ...text, ...parts]`; `pkg` ∈ `@jscad/modeling`, `@jbroll/jscad-fluent`, `@jscadui/jscad-text`, `@jscadui/parts` (99).

Common fields: `name`, `pkg`, `kind` (`namespace | function | class | part`).

**Function entry** (e.g. `primitives.roundedCuboid`, and `primitives.cylinder` index.json L7):
```json
{"name":"primitives.cylinder","pkg":"@jscad/modeling","kind":"function",
 "signature":"cylinder(options) → geom3","description":"Construct a Z axis-aligned cylinder...",
 "optionsFirst":true,
 "options":[{"name":"height","type":"Number","default":"2","description":"height of cylinder"}, ...],
 "params":[{"name":"...","type":"...","description":"..."}],
 "example":"let myshape = cylinder({height: 2, radius: 10})"}
```
- Option defaults are **strings** (`"2"`, `"[2,2,2]"`, `"TAU"`, `"'counterclockwise'"`) or `null` when the JSDoc has none.
- `sameAs` borrows another entry's options/params (e.g. `FluentPath2.offset` L600 `"sameAs":"expansions.offset"`); `optionsOf`/`params` resolution in `docs.js:48-51,71`.
- `extends` names a fluent parent for inherited methods.

**Namespace/class entry** (e.g. `primitives`, `index.json:2`): same header plus `members:[{name, summary}]`.

**Part entry** (`kind:"part"`, e.g. `parts.bosl2.nut`, index.json L709): `family`, `preferred`, `description`, `require`, `scad`, `signature`, `sizes[]`, `options` (a **name→description map**, not a list), `license`, `measured[]`, `example`. Parts are 41 entries (index.json L689-729).

The same build also emits `packages/agent-loop/api/optionTable.js` (`OPTION_TABLES`, generated; header L1) — the runtime option-name/type source (see §4).

## 3. agent-loop tools: write/edit/run and where static warnings land

- Schemas: `packages/agent-loop/src/tools.js` — `write` 33-43, `edit` 44-57, `run` 69-78, `docs` 130-138; `BUILDS` blurb 10-11.
- Routing: `packages/agent-loop/src/dispatchTool.js:3-15` (`write→deps.write`, `edit→deps.edit`, `run→deps.run(source)`), errors returned not thrown (25-31).
- **App handlers:** `apps/jscad-web/src/aiDeps.js` `createProjectTools(...)`:
  - `save({files,path})` 56-67 → returns `writeReport(path, await build())` (L66). `write` 111, `edit` 112 funnel through it.
  - `run` 83-104 → `const out = { warnings: result.warnings ?? [], console: result.console ?? [] }` (L96); both success (98-103) and error (97) paths spread `...out`.
- **Eval handlers:** `packages/agent-loop/eval/backend.js` `saved(next)` 273-277 → `writeReport(next.path, report)`; `run` 288-295 → `{ ok, warnings: warned, console: lines, ... }` (L292-294); tools table 299-314 (`write` 302, `edit` 303, `run` 308, `docs` 313).
- **Warning slot:** `packages/agent-loop/src/buildReport.js` `buildReport()` puts `warnings` on the report (63-65); `writeReport` (95-99) spreads it under `saved`. So static warnings merge into `report.warnings` (write/edit) and the run result's `warnings` (run). They must keep the runtime warning shape (§4) or be clearly tagged.

### Where the shared module can live

- Dependency direction: `apps/jscad-web` depends on `@jscadui/agent-loop` (`apps/jscad-web/package.json:32`); `@jscadui/agent-loop` depends **only** on `@jscadui/format-common` (`packages/agent-loop/package.json:27-29`) and does **not** depend on jscad-web. So the shared code must live in `packages/agent-loop/src/lint.js` and be re-exported from `packages/agent-loop/index.js` (export list 1-15); the app imports it from `@jscadui/agent-loop`. The reverse (agent-loop importing app code) is impossible.
- `agent-loop` currently has **no JS parser** dependency (grep for `acorn|@babel/parser|lezer|parser.parse` in `packages/agent-loop`: none). A pure tree-walker that only uses the Lezer runtime API (`tree.cursor()`, `node.type.name`, `node.from/to`, `node.getChild`) needs no `@lezer/*` import at runtime — JSDoc `@typedef {import('@lezer/common').Tree}` suffices. The caller supplies the tree.
- For `write`/`edit`/`run` in the **eval** (node) a tree must be parsed too, which needs `@lezer/javascript` (+ `@lezer/common`); it is not a declared dependency of `agent-loop`. Options: add it, or pass a parse function/tree in from the caller (the app already has `javascriptLanguage.parser`). This is a design choice the dossier flags, not decides.
- Lezer note from backlog: use `lang-javascript` (JS only), **not** TypeScript ("too heavy", `docs/backlog.md:557`).

## 4. Runtime option-check machinery to mirror

`packages/agent-loop/src/optionChecks.js`:

- `withOptionChecks(api, table, warn)` 330-362 wraps API functions; `checked(fnName, fn, spec, warn)` 204-273 does the work.
- **Unknown option key:** `allowed = new Set(spec.known)`; loops `optionIndices(spec,args)` (191-196) and `for (const option of Object.keys(object))` (226-238); reports `{ fn: fnName, option, suggestions: suggestOptions(option, spec.known) }` (L231). Only a **plain object** first arg is inspected (`isPlainObject`, 8-12, 228).
- `suggestOptions(option, known)` 15-22 (edit distance ≤3, containment; note `radius → roundRadius`).
- Types/angles/outline/boolean extra checks 234-270; `EXTRA_SPECS` 146-158; method wrapping `wrapFluentMethods` 403-418.
- **Unknown function name is NOT detected here.** It surfaces as a thrown runtime error, explained from the index by `explainError` (`packages/agent-loop/src/hints.js:243-269`) / `explainUndefined` (223-234), keyed off `lookupFor(index)` (190-212) and the message regexes at 219-220. The static lint must reproduce this "known function names" judgement from the index, not from `optionChecks`.
- Runtime known-option source: `OPTION_TABLES` in `packages/agent-loop/api/optionTable.js` (generated, header L1; per function `options[path]=[...names]`, `types`, `optionsAt`, `methods`). The index's `options[].name` is the richer equivalent (with defaults) and is the natural source for lint/autocomplete.
- **Warning object shape** (what `warn` receives / what the collector emits): `{ fn, option, suggestions? }` then `explainWarning` adds `hint` (`hints.js:132-144`). Collector `createWarningCollector` (`optionChecks.js:424-447`) dedupes and adds `{file,line}` from the stack; returns `list()`.
- App wiring: `apps/jscad-web/src_frame/optionWarnings.js` `installOptionWarnings` 25-39 (`createWarningCollector({base: PROJECT_BASE})`, wraps modeling + fluent).
- Tests to mirror: `packages/agent-loop/test/optionChecks.test.js` (555 lines); `apps/jscad-web/test/option-warnings.test.js`; `apps/jscad-web/test/option-hints.test.js`; shared case table `packages/agent-loop/test/warningCases.js` (`expectCase` asserts `warnings.map(({fn,option}) => ...)`, `suggestions`, `hint`); eval guard `packages/agent-loop/eval/fluent-guard.test.js` (asserts real fluent examples produce **zero** warnings — a static lint must not regress it).

## 5. Conventions, tests, workspace boundaries

- **Framework:** Vitest 4. Test dirs: `packages/agent-loop/test/*.test.js` and `packages/agent-loop/eval/*.test.js`; `apps/jscad-web/test/*.test.js`.
- `apps/jscad-web/vitest.config.js`: `environment: 'node'`, `include: ['**/*.test.js']`, excludes `build*`, `testTimeout: 30000`. Editor tests opt into DOM with `// @vitest-environment jsdom` (`apps/jscad-web/test/editor.test.js:2`), and build `#editor*` DOM in `beforeEach` (10-19). A CodeMirror lint/autocomplete/hover test will need the same jsdom pragma.
- `packages/agent-loop/vitest.config.js`: `testTimeout: 20000`, `hookTimeout: 30000`.
- **Commands:**
  - App: `npm test -w apps/jscad-web` (runs `vitest run`); single file from `apps/jscad-web`: `npx vitest run test/editor.test.js`.
  - agent-loop: `npm test -w @jscadui/agent-loop`; from the dir: `npx vitest run`.
  - Root: `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run validate` (`package.json:28-38`).
- **Style:** ESM, no semicolons, single quotes, JSDoc type annotations, explicit `.js` import extensions. Naming: `camelCase` functions, `SCREAMING_SNAKE` constants.
- **Workspaces:** root `workspaces: ["packages/*","file-format/*","apps/*"]` (`package.json:8-12`). Cross-package imports are bare specifiers (`@jscadui/agent-loop`, and deep subpath `@jscadui/agent-loop/src/optionChecks.js` is used at `apps/jscad-web/src_frame/optionWarnings.js:1` — note `agent-loop` `files` publishes `src`, `api`, `index.js`).

## 6. Existing plan/spec docs

- Requirement: `docs/backlog.md:555-565` (this item; explicitly "Next spec after the docs tool").
- `apps/jscad-web/docs/architecture.md:886-934` "API style" — docs tool wiring and the **tool table** (918-927; `docs` row 927, `write`/`edit` row 923); index bundling 929-934. `apps/jscad-web/docs/architecture.md:1081` mentions `optionTable.js` generated with the API index.
- `docs/architecture.md:33-37` — API index as agent doc source.
- `docs/superpowers/specs/` contains only `2026-10-02-lego-examples-design.md` and `2026-10-01-chat-logging-and-shared-keys-design.md` — **no docs-tool/editor spec**. No in-tree spec for the docs tool was found.

## Key types/interfaces

- API index entry (function): `{ name, pkg, kind:'function', signature, description, optionsFirst?, options?:{name,type,default,description}[], params?:{name,type,description}[], example?, sameAs?, extends? }`; namespace/class add `members:{name,summary}[]`; part uses `family, preferred, require, scad, sizes, options{name:desc}, license, measured`.
- `docsTool(index, query, {api}) → string` (`docs.js:503`); `lookupDocs(index, query, {api}) → {ok,text}|{ok:false,error}` (491).
- `withOptionChecks(api, table, warn) → api` (`optionChecks.js:330`); warning fact `{fn, option, suggestions?}`; collector entry `{fn, option, hint?, file?, line?}`.
- `buildReport({...warnings})` / `writeReport(path, report)` (`buildReport.js:63,95`) — the `warnings` array both tool paths already carry.
- `javascriptLanguage.parser` / `syntaxTree(state)` (CodeMirror) — the Lezer tree source for the pure lint.

## Test setup (exact)

```bash
# App (editor + tool-result tests); editor tests need jsdom pragma
cd apps/jscad-web && npx vitest run test/editor.test.js
npm test -w apps/jscad-web

# agent-loop (shared lint + option checks + eval guard)
cd packages/agent-loop && npx vitest run test/optionChecks.test.js
npm test -w @jscadui/agent-loop
```

## Dependencies

CodeMirror plugins: `@codemirror/lint` (`linter`), `@codemirror/autocomplete` (`autocompletion`, `CompletionContext`, `completeFromList`), `@codemirror/view` (`hoverTooltip`, already a dep), `@codemirror/language` (`syntaxTree`, `LRLanguage`), `@codemirror/state`, `@codemirror/lang-javascript` (`javascript`, `javascriptLanguage`), `@lezer/javascript`, `@lezer/common`. Reuse from agent-loop: `docs.js` `lookupDocs`/`renderFunction` (hover text), `optionChecks.js` `suggestOptions` (lint suggestions), `api.js` `APIS`/`DEFAULT_API`, and the `api/index.json` loader in `apps/jscad-web/src/apiIndex.js`.

---

## Most important findings

1. **API index shape** — `packages/agent-loop/api/index.json` is a flat JSON array (~728 entries, ~260 KB, 730 lines, one object per line). Function entries carry `options:[{name,type,default,description}]` with **string** defaults; namespaces/classes carry `members:[{name,summary}]`; parts use an `options{name→desc}` map. The generated `api/optionTable.js` (`OPTION_TABLES`) is the runtime known-option/type source; `optionChecks.js` checks only the first plain-object argument, so the static lint must mirror `suggestOptions` and the `{fn,option,suggestions}` fact shape.
2. **CodeMirror packages** — only `@codemirror/lang-javascript` 6.2.1, `@codemirror/state` 6.2.1, `codemirror` 6.0.1 are *declared* (`apps/jscad-web/package.json:24-25,54`). `@codemirror/lint` 6.4.1, `@codemirror/autocomplete` 6.9.0, `@codemirror/language` 6.9.0, `@codemirror/view` 6.18.1, `@lezer/javascript` 1.4.7, `@lezer/common` 1.0.4 are installed transitively — new direct imports must be added to `package.json`. `editor.js` today has no lint/hover/autocomplete extension; `basicSetup` already includes `autocompletion()`.
3. **Shared-module placement** — `jscad-web → agent-loop` only (no cycle), so the shared lint lives at `packages/agent-loop/src/lint.js`, exported from `packages/agent-loop/index.js`. As a pure function over a caller-supplied Lezer tree it needs no `@lezer` runtime import; parsing stays with the caller. To parse inside agent-loop's eval (`write`/`edit`/`run`) would require adding `@lezer/javascript` there, or injecting a parser/tree.
