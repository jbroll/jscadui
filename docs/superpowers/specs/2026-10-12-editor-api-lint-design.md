# Editor lint, autocomplete and hover from the API index — design

Backlog item: `docs/backlog.md`, "Editor lint, autocomplete and hover from the
API index (jscad-web, agent-loop)", the first spec after the docs tool.

## Problem

The editor is a plain CodeMirror 6 `javascript()` view (`apps/jscad-web/src/editor.js:102-124`).
It flags nothing until the model runs: an unknown option key, a call to a name
that does not exist, or a syntax error all surface only as a runtime failure
from the frame or the chat's `run`. The API index
(`packages/agent-loop/api/index.json`) already carries every function's options,
types, defaults and doc text, and the docs tool already reads it. The editor
and the agent's `write`/`edit`/`run` tools can use the same index to flag these
mistakes before anything runs.

## Goals

- Editor lint: unknown option keys on a known API call, unknown function names,
  and Lezer syntax errors, shown as CodeMirror squiggles.
- Editor autocomplete: API names, and option keys with their type and default.
- Editor hover: the docs entry for a name, the option line for an option key.
- The same check runs on `write`, `edit` and `run`, so their results carry
  static warnings beside the runtime option warnings.
- One pure implementation shared by the editor and the tools.

## Non-goals

- No lint of fluent method chains (`shape.translate({...})`). Runtime option
  checks still cover them.
- No TypeScript; the parser is `@lezer/javascript`, matching the language the
  editor already builds.
- No completion of option values (enums).
- Static analysis sees only inline object literals. A built or spread options
  object is left to the runtime wrapper.
- No change to the runtime option checks, their warning shape, or the docs tool.

## Architecture

One pure core in `packages/agent-loop/src/lint.js`, re-exported from
`packages/agent-loop/index.js`. It depends only on the index and a Lezer tree,
so it imports no parser. Two entry points:

- `lintTree(index, tree, { api }) → Diagnostic[]` — the pure walk.
- `lintSource(index, source, { api }) → Diagnostic[]` — parses `source` with a
  lazily imported `@lezer/javascript` and calls `lintTree`.

The app's editor hands `lintTree` the tree CodeMirror already built
(`syntaxTree(state)`) and never re-parses. The tool paths call `lintSource`.

`jscad-web` depends on `@jscadui/agent-loop` and not the reverse, so the core
lives in agent-loop. The editor plugins that need the DOM live in the app.

### Index tables

Built once per index in a `WeakMap`, like `lookupFor` in `hints.js`. From the
index's `kind: 'function'` entries:

- A map from callable name to entry. A bare modeling name is the entry's last
  segment (`primitives.cylinder` → `cylinder`); a `jf.name` entry is keyed as
  the model writes it. A namespace-member call (`primitives.cylinder(...)`) is
  resolved by the same map against the member's full name.
- `sameAs` is followed, so a fluent entry borrows its modeling function's
  options and `optionsFirst` (mirroring `optionsOf` in `docs.js:71`).
- A set of known JS globals (`Math`, `Object`, `JSON`, `require`, `console`,
  `Number`, `Array`, `String`, …) so a bare call to one is never "unknown".

The runtime equivalent is `specsOf` in `optionChecks.js`; the lint mirrors its
verdicts but reads the richer index (option names with defaults, not only the
`known` name list).

## Diagnostics

`Diagnostic`: `{ from, to, severity: 'error' | 'warning', message, source:
'jscad', line, column, fn?, option?, suggestions? }`. Capped at
`MAX_WARNINGS` (20), like the runtime collector.

### Rule 1 — syntax errors

Walk the tree; every node with `type.isError` becomes a `severity: 'error'`
diagnostic over its range. This is what the model's parser rejects, surfaced in
the editor.

### Rule 2 — unknown option key

For a `CallExpression` whose callee resolves to an entry with known options,
when the first argument is an `ObjectExpression`, every key not in the entry's
option set yields a `severity: 'warning'` diagnostic carrying `suggestions`
from `suggestOptions` (`optionChecks.js:15`). The first argument is the one
the index describes; positions named by the runtime's `optionsAt`
(`attachTo`/`alignTo` anchors, `subtract`'s trailing object) are a deliberate
limit — the runtime check covers them.

### Rule 3 — unknown function name

A `CallExpression` whose callee is a bare `Identifier`, whose first argument is
an `ObjectExpression`, where the name is absent from the index, not bound
anywhere in the file (one pre-pass over declarations, params and imports), and
not a known global, yields a `severity: 'warning'` diagnostic. The
object-literal-first test is what keeps `Math.max(1, 2)` and ordinary local
calls out.

## Editor plugins

New file `apps/jscad-web/src/editorApi.js`, importing the core from
`@jscadui/agent-loop` and the index loader from `./apiIndex.js`. It exports
`apiExtensions(loadIndex)` returning the three extensions plus the pure helpers
below, which the tests drive directly. `editor.js` adds
`...apiExtensions(loadApiIndex)` to its extensions array and creates one
module-level `loadApiIndex = createIndexLoader()`.

The index is loaded once, as a single awaited promise. It is already loaded for
the docs tool, so this costs nothing new.

**Lint.** `linter(async (view) => …)` maps `lintTree(await loadIndex(),
syntaxTree(view.state))` to CodeMirror `Diagnostic`s. No gutter; squiggles and
the tooltip. `linter` debounces.

**Autocomplete.** One `CompletionSource` registered through
`javascriptLanguage.data.of({ autocomplete })`, so it adds to the JavaScript
completions `basicSetup` already installed rather than replacing them. Two
contexts:

- Name — `[\w$.]*` before the cursor offers index callables filtered by prefix;
  `detail` is the signature or kind, `info` the full docs entry.
- Option key — when the cursor is inside an `ObjectExpression` that is the
  relevant argument of a resolved call, offers that entry's option names;
  `detail` is `type = default`, `info` the option's description. Opens after
  `{` or `,` inside such an object.

**Hover.** `hoverTooltip((view, pos) => …)` resolves the innermost node at
`pos`; a name matching an entry shows the full docs entry, a property key
inside a resolved call's object literal shows that option's line, otherwise
`null`. Rendered in a `<pre>` tooltip with a small CSS rule.

## Tool integration

The static entries merge into the warning arrays the tools already return.

**App (`apps/jscad-web/src/aiDeps.js`).** `createProjectTools` already receives
`loadIndex`. `save` lints the saved file's `content`; `run` lints the snippet
source. Both use `indexFor(loadIndex)` and append the diagnostics, tagged, to
the report's `warnings`.

**Eval (`packages/agent-loop/eval/backend.js`).** `saved(next)` lints
`next.files[next.path]`; `run(source)` lints `source`; both merge into
`warnings`. `API_INDEX` is already in scope.

**Shape.** Each static entry is `{ source: 'static', severity, message, line,
column, fn?, option?, suggestions? }`. Option warnings build their message with
`explainWarning` from `hints.js`, so the wording matches the runtime's; syntax
errors and unknown names use short messages of their own. Runtime entries are
unchanged.

## Dependencies

- `packages/agent-loop`: add `@lezer/javascript` (used by `lintSource`).
- `apps/jscad-web`: declare `@codemirror/lint`, `@codemirror/autocomplete`,
  `@codemirror/language` and `@codemirror/view` as direct dependencies (they are
  currently reached transitively). `@codemirror/lang-javascript` is declared.

The executor bundle in the eval grows by the parser; it is small, but worth
watching.

## Testing

- `packages/agent-loop/test/lint.test.js` — core rules: unknown option with
  suggestions, `sameAs` options, unknown name and its suppression for declared
  names, params, imports and globals, syntax errors, non-object first argument
  ignored, namespace-member and `jf.name` resolution, and clean code producing
  no diagnostics. Uses the `@lezer/javascript` parser directly.
- `apps/jscad-web/test/editor-api.test.js` (`// @vitest-environment jsdom`) —
  `completionsAt` for names and option keys with defaults, `hoverAt` for a full
  entry and a single option, and lint diagnostics for representative sources.
- Tool merge — extend `apps/jscad-web/test/option-warnings.test.js` (or a
  sibling) to assert write/edit/run carry tagged static entries, and the same on
  the eval backend.
- Guard — linting the repository's real fluent examples yields zero static
  warnings, mirroring `packages/agent-loop/eval/fluent-guard.test.js`, so the
  editor never squiggles valid code.

## Docs

Update the "API style" section of `apps/jscad-web/docs/architecture.md` to
describe the editor lint/autocomplete/hover and the static warnings in tool
results. Delete the backlog item in the commit that lands the work.
