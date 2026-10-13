# Editor lint, autocomplete and hover from the API index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag unknown API option keys, unknown function names and syntax errors in the editor and in the agent's `write`/`edit`/`run` results, and offer API-name autocomplete and hover docs, all from `packages/agent-loop/api/index.json`.

**Architecture:** One pure core in `packages/agent-loop/src/lint.js` over a caller-supplied Lezer tree, plus a thin `lintSource` that parses with `@lezer/javascript`. The app editor hands the core the tree CodeMirror already built; the tool paths call `lintSource` and merge tagged static warnings into the arrays they already return. Spec: `docs/superpowers/specs/2026-10-12-editor-api-lint-design.md`.

**Tech Stack:** Lezer (`@lezer/javascript`), CodeMirror 6 (`@codemirror/lint`, `@codemirror/autocomplete`, `@codemirror/language`, `@codemirror/view`, `@codemirror/lang-javascript`), Vitest.

## Global Constraints

- Parser is `@lezer/javascript` only; no TypeScript.
- Lint covers top-level API calls: bare identifiers (`cylinder(...)`), namespace members (`primitives.cylinder(...)`) and `jf.name(...)` factories. Fluent method chains (`shape.translate(...)`) are out of scope.
- Only the first argument of a call is inspected, and only when it is an object literal. `optionsAt` positions are out of scope.
- Diagnostics are capped at `MAX_DIAGNOSTICS = 20`.
- Tool-result static entries carry `source: 'static'`; runtime warning entries are unchanged.
- CodeMirror diagnostics carry `source: 'jscad'`.
- ESM, no semicolons, single quotes, explicit `.js` import extensions, JSDoc types.
- Unknown-name rule: a bare-identifier call whose first argument is an object literal, where the name is absent from the index, not declared anywhere in the file (declarations, params, destructuring, imports), and not a known JS global.

---

### Task 1: Lint core — tables, unknown-option rule, `lintSource`

**Files:**
- Create: `packages/agent-loop/src/lint.js`
- Modify: `packages/agent-loop/index.js`
- Modify: `packages/agent-loop/package.json` (add `@lezer/javascript`)
- Test: `packages/agent-loop/test/lint.test.js`

**Interfaces:**
- Consumes: `suggestOptions` and `explainWarning` (`./optionChecks.js`, `./hints.js`), `DEFAULT_API` (`./api.js`).
- Produces:
  - `lintTree(index, tree, { api, text }) → Diagnostic[]` (`text` is the source; identifier text is sliced from it, since a Lezer node's `name` is its type name)
  - `lintSource(index, source, { api }) → Promise<Diagnostic[]>` (async: lazily imports the parser)
  - `lookupName(index, name) → entry | null`
  - `MAX_DIAGNOSTICS = 20`
  - `Diagnostic = { from, to, severity, source: 'jscad', message, fn?, option?, suggestions?, line?, column? }`

- [ ] **Step 1: Add the parser dependency**

Add `"@lezer/javascript": "^1.4.7"` to `dependencies` in `packages/agent-loop/package.json` (after `@jscadui/format-common`). Then at the repo root run:

```bash
npm install
```

Expected: install completes; `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

Create `packages/agent-loop/test/lint.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { parser } from '@lezer/javascript'
import index from '../api/index.json'
import { lintSource, lintTree } from '../src/lint.js'

const lint = (source, api = 'modeling') => lintTree(index, parser.parse(source), { api, text: source })

const DESTRUCTURED = `const { cylinder } = require('@jscad/modeling').primitives\n`

describe('unknown option keys', () => {
  it('flags a misspelled option with suggestions', () => {
    expect(lint(`${DESTRUCTURED}cylinder({ heigth: 2 })`)).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'jscad', fn: 'primitives.cylinder', option: 'heigth', suggestions: ['height'] }),
    ])
  })

  it('accepts every known option', () => {
    expect(lint(`${DESTRUCTURED}cylinder({ radius: 1, height: 2, segments: 8 })`)).toEqual([])
  })

  it('resolves a namespace-member call', () => {
    expect(lint(`const { primitives } = require('@jscad/modeling')\nprimitives.cylinder({ radius: 1, heigth: 2 })`)).toEqual([
      expect.objectContaining({ fn: 'primitives.cylinder', option: 'heigth' }),
    ])
  })

  it('resolves a jf factory through its sameAs options', () => {
    expect(lint(`jf.roundedCuboid({ radius: 1 })`, 'fluent')).toEqual([
      expect.objectContaining({ fn: 'jf.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }),
    ])
  })

  it('ignores a call whose first argument is not an object literal', () => {
    expect(lint(`${DESTRUCTURED}cylinder(2)`)).toEqual([])
  })
})

describe('lintSource', () => {
  it('adds the line and column of the key', async () => {
    const [d] = await lintSource(index, `${DESTRUCTURED}cylinder({ heigth: 2 })`)
    expect(d).toMatchObject({ option: 'heigth', line: 2, column: 12 })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: FAIL — cannot resolve `../src/lint.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/agent-loop/src/lint.js`:

```js
import { DEFAULT_API } from './api.js'
import { explainWarning } from './hints.js'
import { suggestOptions } from './optionChecks.js'

export const MAX_DIAGNOSTICS = 20

const tables = new WeakMap()

// The names the model writes: a modeling function's last segment after a
// destructure, a jf.<name> factory as written, and every full entry name.
const tablesFor = (index) => {
  if (tables.has(index)) return tables.get(index)
  const byName = new Map()
  for (const entry of index) byName.set(entry.name, entry)
  const callables = new Map()
  for (const entry of index) {
    if (entry.kind !== 'function') continue
    if (entry.name.startsWith('jf.')) {
      callables.set(entry.name, entry)
      continue
    }
    const dot = entry.name.lastIndexOf('.')
    if (dot <= 0) continue
    if (!entry.name.slice(0, dot).includes('.')) callables.set(entry.name.slice(dot + 1), entry)
  }
  const table = { byName, callables }
  tables.set(index, table)
  return table
}

const optionsOf = (t, entry) => {
  const resolved = entry.sameAs ? t.byName.get(entry.sameAs) : entry
  return resolved?.options ?? null
}

const unquote = (text) => (text.length >= 2 && (text[0] === '"' || text[0] === "'") ? text.slice(1, -1) : text)

const firstArg = (argList) => {
  for (let node = argList.firstChild; node; node = node.nextSibling) {
    if (node.type.name === '(' || node.type.name === ',') continue
    return node
  }
  return null
}

// The keys of an object literal: an identifier or string key is checked, a
// computed, spread or method key is left alone. `text` is the source, since a
// Lezer node's name is its type name, not its text.
const objectKeys = (object, text) => {
  const keys = []
  for (let property = object.firstChild; property; property = property.nextSibling) {
    if (property.type.name !== 'Property') continue
    const key = property.firstChild
    if (key?.type.name === 'PropertyDefinition') keys.push({ name: text.slice(key.from, key.to), from: key.from, to: key.to })
    else if (key?.type.name === 'String') keys.push({ name: unquote(text.slice(key.from, key.to)), from: key.from, to: key.to })
  }
  return keys
}

const resolveCallee = (t, callee, text) => {
  if (!callee) return null
  if (callee.type.name === 'VariableName') return t.callables.get(text.slice(callee.from, callee.to)) ?? null
  if (callee.type.name === 'MemberExpression') {
    const object = callee.firstChild
    const property = callee.lastChild
    if (object?.type.name === 'VariableName' && property?.type.name === 'PropertyName') {
      const entry = t.byName.get(`${text.slice(object.from, object.to)}.${text.slice(property.from, property.to)}`)
      if (entry?.kind === 'function') return entry
    }
  }
  return null
}

/** @param {Array<object>} index @param {string} name */
export const lookupName = (index, name) => {
  if (!name) return null
  const t = tablesFor(index)
  return t.callables.get(name) ?? t.byName.get(name) ?? null
}

const withLocation = (diagnostic, text) => {
  if (typeof text !== 'string') return diagnostic
  let line = 1
  let lineStart = 0
  for (let i = 0; i < diagnostic.from && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lineStart = i + 1
    }
  }
  return { ...diagnostic, line, column: diagnostic.from - lineStart + 1 }
}

const lintCall = (t, call, text, api, push) => {
  const callee = call.firstChild
  const argList = call.getChild('ArgList')
  if (!callee || !argList) return
  const first = firstArg(argList)
  const entry = resolveCallee(t, callee, text)
  if (!entry) return
  if (first?.type.name !== 'ObjectExpression') return
  const options = optionsOf(t, entry)
  if (!options?.length) return
  const known = options.map((option) => option.name)
  for (const key of objectKeys(first, text)) {
    if (known.includes(key.name)) continue
    const suggestions = suggestOptions(key.name, known)
    const explained = explainWarning({ fn: entry.name, option: key.name, suggestions }, api)
    push({
      from: key.from,
      to: key.to,
      severity: 'warning',
      source: 'jscad',
      message: explained.hint ?? `unknown option ${key.name}`,
      fn: entry.name,
      option: key.name,
      suggestions: explained.suggestions ?? suggestions,
    })
  }
}

/**
 * @param {Array<object>} index api/index.json
 * @param {import('@lezer/common').Tree} tree
 * @param {{ api?: string, text?: string }} [options]
 */
export const lintTree = (index, tree, { api = DEFAULT_API, text = '' } = {}) => {
  const t = tablesFor(index)
  const diagnostics = []
  const push = (diagnostic) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(withLocation(diagnostic, text))
  }
  const cursor = tree.cursor()
  do {
    if (cursor.name === 'CallExpression') lintCall(t, cursor.node, text, api, push)
  } while (cursor.next())
  return diagnostics
}

/**
 * @param {Array<object>} index
 * @param {string} source
 * @param {{ api?: string }} [options]
 */
export const lintSource = async (index, source, options = {}) => {
  const { parser } = await import('@lezer/javascript')
  const text = String(source ?? '')
  return lintTree(index, parser.parse(text), { ...options, text })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: PASS (6 tests).

- [ ] **Step 6: Export the core**

In `packages/agent-loop/index.js`, add at the end:

```js
export { lintSource, lintTree, lookupName, MAX_DIAGNOSTICS } from './src/lint.js'
```

(`hoverTarget` is added to this line in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/src/lint.js packages/agent-loop/index.js packages/agent-loop/package.json packages/agent-loop/test/lint.test.js package-lock.json
git commit -m "feat(agent-loop): add the API lint core with the unknown-option rule"
```

---

### Task 2: Lint core — unknown-name and syntax-error rules, examples guard

**Files:**
- Modify: `packages/agent-loop/src/lint.js`
- Test: `packages/agent-loop/test/lint.test.js`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: no new exports; the same `lintTree` now also returns unknown-name and syntax-error diagnostics.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-loop/test/lint.test.js`:

```js
describe('unknown function names', () => {
  it('flags an undeclared call whose first argument is an object', () => {
    expect(lint(`frobnicate({ a: 1 })`)).toEqual([
      expect.objectContaining({ severity: 'warning', fn: 'frobnicate' }),
    ])
  })

  it('accepts a locally declared function', () => {
    expect(lint(`function frobnicate(options) { return options }\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts an arrow assigned to a const', () => {
    expect(lint(`const frobnicate = (options) => options\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts a destructured binding', () => {
    expect(lint(`const { frobnicate } = require('./helper')\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts a global', () => {
    expect(lint(`Math.max(1, 2)`)).toEqual([])
  })

  it('accepts a call whose first argument is not an object', () => {
    expect(lint(`frobnicate(1)`)).toEqual([])
  })
})

describe('syntax errors', () => {
  it('flags an incomplete statement', () => {
    expect(lint(`const x = `)).toContainEqual(expect.objectContaining({ severity: 'error', message: 'Syntax error' }))
  })
})

describe('real fluent examples', () => {
  it('raise no static warning', async () => {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs')
    const { join, relative } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const REPO = fileURLToPath(new URL('../../../', import.meta.url))
    const FLUENT = /require\(\s*['"]@jbroll\/jscad-fluent['"]\s*\)/
    const dirs = ['apps/jscad-web/examples', 'packages/agent-loop/prompt/examples']
    const files = dirs.flatMap((dir) => {
      const base = join(REPO, dir)
      return existsSync(base) ? readdirSync(base, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(base, f)) : []
    })
    const warned = []
    let ran = 0
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!FLUENT.test(source)) continue
      ran += 1
      const diagnostics = await lintSource(index, source)
      if (diagnostics.length) warned.push({ name: relative(REPO, file), diagnostics })
    }
    expect(warned).toEqual([])
    expect(ran).toBeGreaterThanOrEqual(5)
  }, 60_000)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: FAIL on the unknown-name and syntax-error cases (the option-rule tests from Task 1 still pass).

- [ ] **Step 3: Add the rules**

In `packages/agent-loop/src/lint.js`, add above `const tables = new WeakMap()`:

```js
// Bare calls the model is expected to have without declaring them.
const GLOBALS = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Function', 'Infinity', 'JSON',
  'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'Reflect',
  'RegExp', 'Set', 'String', 'Symbol', 'TypeError', 'WeakMap', 'WeakSet',
  'console', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'require', 'undefined',
])
```

Add above `const withLocation`:

```js
const collectDeclared = (tree, text) => {
  const names = new Set()
  const cursor = tree.cursor()
  do {
    if (cursor.name === 'VariableDefinition') names.add(text.slice(cursor.from, cursor.to))
    else if (cursor.name === 'PropertyName' && cursor.node.parent?.type.name === 'PatternProperty') names.add(text.slice(cursor.from, cursor.to))
  } while (cursor.next())
  return names
}
```

Change `lintCall` to take `declared` and add the unknown-name tail after the option loop's `return`:

```js
const lintCall = (t, call, text, declared, api, push) => {
  const callee = call.firstChild
  const argList = call.getChild('ArgList')
  if (!callee || !argList) return
  const first = firstArg(argList)
  const entry = resolveCallee(t, callee, text)
  if (entry) {
    if (first?.type.name !== 'ObjectExpression') return
    const options = optionsOf(t, entry)
    if (!options?.length) return
    const known = options.map((option) => option.name)
    for (const key of objectKeys(first, text)) {
      if (known.includes(key.name)) continue
      const suggestions = suggestOptions(key.name, known)
      const explained = explainWarning({ fn: entry.name, option: key.name, suggestions }, api)
      push({
        from: key.from,
        to: key.to,
        severity: 'warning',
        source: 'jscad',
        message: explained.hint ?? `unknown option ${key.name}`,
        fn: entry.name,
        option: key.name,
        suggestions: explained.suggestions ?? suggestions,
      })
    }
    return
  }
  if (callee.type.name !== 'VariableName') return
  const name = text.slice(callee.from, callee.to)
  if (declared.has(name) || GLOBALS.has(name)) return
  if (first?.type.name !== 'ObjectExpression') return
  push({ from: callee.from, to: callee.to, severity: 'warning', source: 'jscad', message: `unknown function ${name}; it is not in the API index`, fn: name })
}
```

Change `lintTree` to collect declared names, pass them to `lintCall`, and flag error nodes:

```js
export const lintTree = (index, tree, { api = DEFAULT_API, text = '' } = {}) => {
  const t = tablesFor(index)
  const declared = collectDeclared(tree, text)
  const diagnostics = []
  const push = (diagnostic) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(withLocation(diagnostic, text))
  }
  const cursor = tree.cursor()
  do {
    if (cursor.type.isError) {
      push({ from: cursor.from, to: Math.max(cursor.to, cursor.from + 1), severity: 'error', source: 'jscad', message: 'Syntax error' })
    } else if (cursor.name === 'CallExpression') {
      lintCall(t, cursor.node, text, declared, api, push)
    }
  } while (cursor.next())
  return diagnostics
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: PASS.

If the examples guard fails, the diagnostics name real false positives. Fix the rule: add missing globals to `GLOBALS`, or extend `collectDeclared` for the binding shape the example uses. Do not weaken the unknown-name rule to a typo-distance check.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/lint.js packages/agent-loop/test/lint.test.js
git commit -m "feat(agent-loop): add unknown-name and syntax-error lint rules"
```

---

### Task 3: App tool results carry static warnings

**Files:**
- Modify: `apps/jscad-web/src/aiDeps.js`
- Test: `apps/jscad-web/test/aiDeps.test.js`

**Interfaces:**
- Consumes: `lintSource` and `indexFor` (the app already has both); `getApi` and `loadIndex` from the existing `createProjectTools` deps.
- Produces: `write`, `edit` and `run` results gain `warnings` entries shaped `{ source: 'static', severity, message, line, column, fn?, option?, suggestions? }`.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/test/aiDeps.test.js`, append:

```js
describe('static lint warnings', () => {
  it('write answers the static warnings of the saved source', async () => {
    const { tools: t } = tools({ loadIndex: async () => index })
    const source = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ heigth: 2 })`
    const res = await t.write({ path: 'main.js', content: source })
    expect(res.warnings).toContainEqual(expect.objectContaining({ source: 'static', option: 'heigth', suggestions: ['height'] }))
  })

  it('run answers the static warnings of the snippet', async () => {
    const { tools: t } = tools({ loadIndex: async () => index })
    const res = await t.run(`cylindr({ radius: 1 })`)
    expect(res.warnings).toContainEqual(expect.objectContaining({ source: 'static', fn: 'cylindr' }))
  })

  it('adds no static warnings for clean source', async () => {
    const { tools: t } = tools({ loadIndex: async () => index })
    const source = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`
    expect((await t.write({ path: 'main.js', content: source })).warnings).toEqual([])
  })
})
```

`index` is already imported at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/aiDeps.test.js` (in `apps/jscad-web`)
Expected: FAIL — `res.warnings` is `[]` (no static entries).

- [ ] **Step 3: Implement the merge**

In `apps/jscad-web/src/aiDeps.js`, add `lintSource` to the `@jscadui/agent-loop` import list (line 1). Above `createProjectTools`, add:

```js
const staticWarnings = (diagnostics) =>
  diagnostics.map(({ from, to, source, ...rest }) => ({ source: 'static', ...rest }))

const mergeStatic = (result, diagnostics) =>
  diagnostics.length ? { ...result, warnings: [...(result.warnings ?? []), ...staticWarnings(diagnostics)] } : result
```

Inside `createProjectTools`, before `save`, add:

```js
const lint = async (content) => {
  if (typeof content !== 'string') return []
  const index = await indexFor(loadIndex)
  if (!index) return []
  try {
    return await lintSource(index, content, { api: getApi() })
  } catch {
    return []
  }
}
```

Change `save`'s return to:

```js
    return mergeStatic(writeReport(path, await build()), await lint(content))
```

In `run`, wrap both returns. Replace the `if (result.error) ...` and the success `return { ok: true, ... }` with:

```js
    const diagnostics = await lint(source)
    if (result.error) return mergeStatic({ ok: false, error: reportError(result.error, { api, index: await indexFor(loadIndex) }), ...out }, diagnostics)
    return mergeStatic({
      ok: true,
      ...out,
      ...(result.geometry ? { geometry: result.geometry } : {}),
      ...(result.returned !== undefined ? { returned: result.returned } : {}),
    }, diagnostics)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/aiDeps.test.js` (in `apps/jscad-web`)
Expected: PASS (existing tests plus the three new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiDeps.js apps/jscad-web/test/aiDeps.test.js
git commit -m "feat(jscad-web): return static lint warnings from write, edit and run"
```

---

### Task 4: Eval tool results carry static warnings

**Files:**
- Modify: `packages/agent-loop/eval/backend.js`
- Test: `packages/agent-loop/eval/backend.test.js`

**Interfaces:**
- Consumes: `lintSource` from `../src/lint.js`; `API_INDEX` (already at `eval/backend.js:30`); the `api` parameter of `createEvalBackend`.
- Produces: the eval's `write`, `edit` and `run` results gain the same tagged static warnings.

- [ ] **Step 1: Write the failing test**

In `packages/agent-loop/eval/backend.test.js`, add a case near the write tests:

```js
  it('adds the static warnings of the source to a write', async () => {
    const backend = createEvalBackend()
    const source = `const { cylinder } = require('@jscad/modeling').primitives\nconst main = () => cylinder({ heigth: 2 })\nmodule.exports = { main }`
    const report = await writeMain(source, backend)
    expect(report.warnings).toContainEqual(expect.objectContaining({ source: 'static', option: 'heigth', suggestions: ['height'] }))
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run eval/backend.test.js` (in `packages/agent-loop`)
Expected: FAIL — `report.warnings` is `[]`.

- [ ] **Step 3: Implement the merge**

In `packages/agent-loop/eval/backend.js`, add to the imports:

```js
import { lintSource } from '../src/lint.js'
```

Add helpers near the other module-level helpers:

```js
const staticWarnings = (diagnostics) =>
  diagnostics.map(({ from, to, source, ...rest }) => ({ source: 'static', ...rest }))

const mergeStatic = (result, diagnostics) =>
  diagnostics.length ? { ...result, warnings: [...(result.warnings ?? []), ...staticWarnings(diagnostics)] } : result
```

Change `saved` (note `api` is the parameter of `createEvalBackend`, already in scope):

```js
  const saved = async (next) => {
    files = next.files
    const report = await build()
    if (!report) return toolError('ResetError', 'the run was reset before the build finished')
    const diagnostics = await lintSource(API_INDEX, next.files[next.path] ?? '', { api })
    return writeReport(next.path, mergeStatic(report, diagnostics))
  }
```

Change `run` to merge on both branches:

```js
  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const loaded = await runModel({ ...files, [RUN_FILE]: source }, RUN_FILE, api, { wrapRequire: withProjectMains })
    const { warnings: warned, console: lines } = loaded
    const diagnostics = await lintSource(API_INDEX, source, { api })
    if (loaded.error) return mergeStatic({ ok: false, error: modelError(loaded.error, api), warnings: warned, console: lines }, diagnostics)
    const summary = summarizeRun({ hasMain: loaded.hasMain, value: loaded.hasMain ? loaded.value : loaded.exports }, measure, check)
    return mergeStatic({ ok: true, warnings: warned, console: lines, ...summary }, diagnostics)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run eval/backend.test.js` (in `packages/agent-loop`)
Expected: PASS.

Then run the existing guard:

Run: `npx vitest run eval/fluent-guard.test.js` (in `packages/agent-loop`)
Expected: PASS — this test asserts every fluent example writes with zero warnings, so it now also enforces that the static lint raises no false positive there. If it fails, fix the rule as in Task 2.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/eval/backend.js packages/agent-loop/eval/backend.test.js
git commit -m "feat(agent-loop): return static lint warnings from the eval's write, edit and run"
```

---

### Task 5: Editor lint extension

**Files:**
- Create: `apps/jscad-web/src/editorApi.js`
- Modify: `apps/jscad-web/src/editor.js`
- Modify: `apps/jscad-web/package.json` (declare the CodeMirror deps)
- Test: `apps/jscad-web/test/editor-api.test.js`

**Interfaces:**
- Consumes: `lintTree` from `@jscadui/agent-loop`; `createIndexLoader` from `./apiIndex.js`; `syntaxTree` from `@codemirror/language`; `linter` from `@codemirror/lint`.
- Produces:
  - `apiDiagnostics(index, state) → Diagnostic[]` (CodeMirror-shaped)
  - `apiExtensions(loadIndex) → Extension[]` (this task returns `[linter(...)]`; Tasks 6 and 7 extend it)

- [ ] **Step 1: Declare the CodeMirror dependencies**

In `apps/jscad-web/package.json`, add to `dependencies` (keep alphabetical order):

```json
    "@codemirror/autocomplete": "^6.9.0",
    "@codemirror/language": "^6.9.0",
    "@codemirror/lint": "^6.4.1",
    "@codemirror/view": "^6.18.1",
```

Then at the repo root run:

```bash
npm install
```

- [ ] **Step 2: Write the failing test**

Create `apps/jscad-web/test/editor-api.test.js`:

```js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import index from '@jscadui/agent-loop/api/index.json'
import { apiDiagnostics } from '../src/editorApi.js'

const stateFor = (doc) => EditorState.create({ doc, extensions: [javascript()] })

describe('editor lint diagnostics', () => {
  it('flags an unknown option', () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ heigth: 2 })`
    expect(apiDiagnostics(index, stateFor(doc))).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'jscad', fn: 'primitives.cylinder', option: 'heigth' }),
    ])
  })

  it('flags a syntax error', () => {
    expect(apiDiagnostics(index, stateFor('const x = '))).toEqual([expect.objectContaining({ severity: 'error' })])
  })

  it('is empty for clean code', () => {
    expect(apiDiagnostics(index, stateFor(`const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`))).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: FAIL — cannot resolve `../src/editorApi.js`.

- [ ] **Step 4: Write the module and wire it in**

Create `apps/jscad-web/src/editorApi.js`:

```js
import { lintTree } from '@jscadui/agent-loop'
import { syntaxTree } from '@codemirror/language'
import { linter } from '@codemirror/lint'

/**
 * The CodeMirror diagnostics of a document, from the API index.
 * @param {Array<object>} index api/index.json
 * @param {import('@codemirror/state').EditorState} state
 */
export const apiDiagnostics = (index, state) => lintTree(index, syntaxTree(state), { text: state.doc.toString() })

/**
 * The CodeMirror extensions the editor adds for API help.
 * @param {() => Promise<Array<object>>} loadIndex
 */
export const apiExtensions = (loadIndex) => [
  linter(async (view) => {
    let index
    try {
      index = await loadIndex()
    } catch {
      return []
    }
    return index ? apiDiagnostics(index, view.state) : []
  }),
]
```

In `apps/jscad-web/src/editor.js`:
- Add imports after line 8:

```js
import { apiExtensions } from './editorApi.js'
import { createIndexLoader } from './apiIndex.js'
```

- Above `export const init`, add the module-level loader:

```js
const loadApiIndex = createIndexLoader()
```

- In the `extensions` array (currently ends with the `keymap.of([...])` entry), add `...apiExtensions(loadApiIndex),` after `javascript(),`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: PASS.

Run the existing editor test to check nothing regressed:

Run: `npx vitest run test/editor.test.js` (in `apps/jscad-web`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/editorApi.js apps/jscad-web/src/editor.js apps/jscad-web/package.json apps/jscad-web/test/editor-api.test.js package-lock.json
git commit -m "feat(jscad-web): lint the editor from the API index"
```

---

### Task 6: Editor autocomplete

**Files:**
- Modify: `apps/jscad-web/src/editorApi.js`
- Test: `apps/jscad-web/test/editor-api.test.js`

**Interfaces:**
- Consumes: `lookupName` from `@jscadui/agent-loop`; `CompletionContext` from `@codemirror/autocomplete`; `javascriptLanguage` from `@codemirror/lang-javascript`; `docsTool` from `@jscadui/agent-loop`.
- Produces:
  - `completeApi(index, context) → CompletionResult | null`
  - `apiExtensions` now also returns a `javascriptLanguage.data.of({ autocomplete })` extension.

- [ ] **Step 1: Write the failing tests**

Append to `apps/jscad-web/test/editor-api.test.js`:

```js
import { CompletionContext } from '@codemirror/autocomplete'
import { completeApi } from '../src/editorApi.js'

const complete = (doc, pos) => completeApi(index, new CompletionContext(stateFor(doc), pos, false))

describe('editor autocomplete', () => {
  it('completes an API name by prefix', () => {
    const doc = 'cyli'
    const result = complete(doc, doc.length)
    expect(result.options.map((o) => o.label)).toContain('cylinder')
  })

  it('completes option keys inside a call object', () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({  })`
    const result = complete(doc, doc.indexOf('cylinder({') + 'cylinder({'.length)
    expect(result.options.map((o) => o.label)).toContain('height')
  })

  it('does not offer option keys outside an API call', () => {
    const doc = 'const x = {  }'
    expect(complete(doc, doc.indexOf('{ ') + 2)).toBe(null)
  })
})
```

Move the two new `import` lines to the top of the file with the others.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: FAIL — `completeApi` is not exported.

- [ ] **Step 3: Implement `completeApi` and register the source**

In `apps/jscad-web/src/editorApi.js`, extend the imports:

```js
import { docsTool, lintTree, lookupName } from '@jscadui/agent-loop'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { CompletionContext } from '@codemirror/autocomplete'
import { linter } from '@codemirror/lint'
```

`javascriptLanguage` comes from `@codemirror/lang-javascript`; `syntaxTree` stays imported from `@codemirror/language`, as in Task 5.

Add:

```js
const previousNonSpace = (state, pos) => {
  const text = state.doc.sliceString(0, pos)
  let i = text.length
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1
  return i > 0 ? text[i - 1] : ''
}

const calleeName = (callee, state) => {
  if (!callee) return null
  if (callee.type.name === 'VariableName') return state.sliceDoc(callee.from, callee.to)
  if (callee.type.name === 'MemberExpression') {
    const object = callee.firstChild
    const property = callee.lastChild
    if (object?.type.name === 'VariableName' && property?.type.name === 'PropertyName') return `${state.sliceDoc(object.from, object.to)}.${state.sliceDoc(property.from, property.to)}`
  }
  return null
}

// The options of an entry, following sameAs (a jf factory borrows its modeling function's).
const optionsFor = (index, entry) => {
  const source = entry.sameAs ? lookupName(index, entry.sameAs) : entry
  return source?.options ?? entry.options ?? []
}

// The entry whose options the object literal at `pos` is the first argument of.
const optionEntry = (index, state, pos) => {
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node && node.name !== 'ObjectExpression') node = node.parent
  if (!node) return null
  const argList = node.parent
  if (argList?.name !== 'ArgList') return null
  const call = argList.parent
  if (call?.name !== 'CallExpression') return null
  for (let child = argList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ',') continue
    if (child !== node) return null
    break
  }
  return lookupName(index, calleeName(call.firstChild, state))
}
```

Then:

```js
export const completeApi = (index, context) => {
  const word = context.matchBefore(/[A-Za-z_$][\w$]*/)
  const before = previousNonSpace(context.state, context.pos)
  if (before === '{' || before === ',') {
    const entry = optionEntry(index, context.state, context.pos)
    if (entry) {
      const from = word ? word.from : context.pos
      const prefix = context.state.sliceDoc(from, context.pos)
      const options = optionsFor(index, entry)
        .filter((option) => option.name.startsWith(prefix))
        .map((option) => ({
          label: option.name,
          type: 'property',
          detail: `${option.type ?? ''}${option.default != null ? ` = ${option.default}` : ''}`,
          info: option.description,
        }))
      if (options.length) return { from, options, validFor: /^[\w$]*$/ }
    }
  }
  if (!word && !context.explicit) return null
  const from = word ? word.from : context.pos
  const prefix = context.state.sliceDoc(from, context.pos)
  const names = new Map()
  for (const entry of index) {
    if (entry.kind === 'function') {
      if (entry.name.startsWith('jf.')) names.set(entry.name, entry)
      else if (!entry.name.slice(0, entry.name.lastIndexOf('.')).includes('.')) names.set(entry.name.slice(entry.name.lastIndexOf('.') + 1), entry)
    } else if (entry.kind === 'namespace' && !entry.name.includes('.')) {
      names.set(entry.name, entry)
    }
  }
  const options = [...names.entries()]
    .filter(([label]) => label.startsWith(prefix))
    .map(([label, entry]) => ({ label, type: entry.kind === 'namespace' ? 'namespace' : 'function', detail: entry.signature, info: () => docsTool(index, entry.name) }))
  return options.length ? { from, options, validFor: /^[\w$]*$/ } : null
}
```

Register the source in `apiExtensions`:

```js
export const apiExtensions = (loadIndex) => [
  linter(async (view) => {
    let index
    try {
      index = await loadIndex()
    } catch {
      return []
    }
    return index ? apiDiagnostics(index, view.state) : []
  }),
  javascriptLanguage.data.of({
    autocomplete: async (context) => {
      let index
      try {
        index = await loadIndex()
      } catch {
        return null
      }
      return index ? completeApi(index, context) : null
    },
  }),
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/editorApi.js apps/jscad-web/test/editor-api.test.js
git commit -m "feat(jscad-web): complete API names and options in the editor"
```

---

### Task 7: Editor hover and tooltip styling

**Files:**
- Modify: `packages/agent-loop/src/lint.js` (add `hoverTarget`)
- Modify: `packages/agent-loop/index.js` (export `hoverTarget`)
- Modify: `apps/jscad-web/src/editorApi.js`
- Test: `packages/agent-loop/test/lint.test.js`, `apps/jscad-web/test/editor-api.test.js`

**Interfaces:**
- Consumes: `docsTool` (`./docs.js`) for the entry text; the Task 1 helpers (`tablesFor`, `optionsOf`, `resolveCallee`, `firstArg`, `lookupName`).
- Produces:
  - `hoverTarget(index, tree, pos, text) → { from, to, text } | null`
  - `apiExtensions` now also returns `hoverTooltip(...)` and `EditorView.baseTheme(...)`.

- [ ] **Step 1: Write the failing core tests**

Append to `packages/agent-loop/test/lint.test.js`:

```js
import { hoverTarget } from '../src/lint.js'

describe('hoverTarget', () => {
  const src = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`

  it('answers the docs entry for a name', () => {
    const target = hoverTarget(index, parser.parse(src), src.indexOf('cylinder({') + 2, src)
    expect(target.text).toContain('primitives.cylinder')
    expect(target.text).toContain('Options:')
  })

  it('answers the option line for an option key', () => {
    const target = hoverTarget(index, parser.parse(src), src.indexOf('radius') + 1, src)
    expect(target.text).toBe('radius: Number = 1 - radius of cylinder (at both start and end)')
  })

  it('answers null away from any name', () => {
    expect(hoverTarget(index, parser.parse(src), 0, src)).toBe(null)
  })
})
```

Move the `hoverTarget` import to the top of the file with the others.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: FAIL — `hoverTarget` is not exported.

- [ ] **Step 3: Implement `hoverTarget`**

In `packages/agent-loop/src/lint.js`, add `import { docsTool } from './docs.js'` to the top imports, then add near the bottom:

```js
const optionLine = (option) =>
  `${option.name}${option.type ? `: ${option.type}` : ''}${option.default != null ? ` = ${option.default}` : ''}${option.description ? ` - ${option.description}` : ''}`

const dottedName = (node, text) => {
  const member = node.parent
  if (member?.type.name !== 'MemberExpression') return null
  const object = member.firstChild
  return object?.type.name === 'VariableName' ? `${text.slice(object.from, object.to)}.${text.slice(node.from, node.to)}` : null
}

const optionUnder = (t, node, text) => {
  if (node.type.name !== 'PropertyDefinition') return null
  const object = node.parent?.parent
  if (object?.type.name !== 'ObjectExpression') return null
  const argList = object.parent
  const call = argList?.parent
  if (argList?.type.name !== 'ArgList' || call?.type.name !== 'CallExpression') return null
  if (firstArg(argList) !== object) return null
  const entry = resolveCallee(t, call.firstChild, text)
  const options = entry ? optionsOf(t, entry) : null
  return options?.find((option) => option.name === text.slice(node.from, node.to)) ?? null
}

/**
 * The docs text for the name or option key at `pos`, or null.
 * @param {Array<object>} index
 * @param {import('@lezer/common').Tree} tree
 * @param {number} pos
 * @param {string} text the document source
 */
export const hoverTarget = (index, tree, pos, text) => {
  const node = tree.resolveInner(pos, -1)
  const name = node.type.name === 'PropertyName' ? dottedName(node, text) : node.type.name === 'VariableName' ? text.slice(node.from, node.to) : null
  const entry = lookupName(index, name)
  if (entry) return { from: node.from, to: node.to, text: docsTool(index, entry.name) }
  const option = optionUnder(tablesFor(index), node, text)
  if (option) return { from: node.from, to: node.to, text: optionLine(option) }
  return null
}
```

In `packages/agent-loop/index.js`, add `hoverTarget` to the lint export line from Task 1:

```js
export { hoverTarget, lintSource, lintTree, lookupName, MAX_DIAGNOSTICS } from './src/lint.js'
```

- [ ] **Step 4: Run the core test to verify it passes**

Run: `npx vitest run test/lint.test.js` (in `packages/agent-loop`)
Expected: PASS.

- [ ] **Step 5: Write the failing editor test**

Append to `apps/jscad-web/test/editor-api.test.js`:

```js
import { apiHover } from '../src/editorApi.js'

describe('editor hover', () => {
  it('builds a tooltip for an API name', async () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`
    const view = new EditorView({ state: stateFor(doc) })
    const source = apiHover(async () => index)
    const tooltip = await source(view, doc.indexOf('cylinder({') + 2)
    expect(tooltip).not.toBe(null)
    view.destroy()
  })
})
```

Add `import { EditorView } from '@codemirror/view'` with the other imports.

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: FAIL — `apiHover` is not exported.

- [ ] **Step 7: Implement `apiHover`, the tooltip theme, and register them**

In `apps/jscad-web/src/editorApi.js`, extend the imports:

```js
import { hoverTarget } from '@jscadui/agent-loop'
import { hoverTooltip, EditorView } from '@codemirror/view'
```

Add:

```js
/**
 * The hover tooltip over the API names and option keys.
 * @param {() => Promise<Array<object>>} loadIndex
 */
export const apiHover = (loadIndex) => async (view, pos) => {
  let index
  try {
    index = await loadIndex()
  } catch {
    return null
  }
  const target = index ? hoverTarget(index, syntaxTree(view.state), pos, view.state.doc.toString()) : null
  if (!target) return null
  return {
    pos: target.from,
    end: target.to,
    create: () => {
      const dom = document.createElement('pre')
      dom.className = 'cm-jscad-doc'
      dom.textContent = target.text
      return { dom }
    },
  }
}
```

`apiHover` returns the hover source function; wrap it with `hoverTooltip` when registering. In `apiExtensions`, append:

```js
  hoverTooltip(apiHover(loadIndex)),
  EditorView.baseTheme({
    '.cm-jscad-doc': { margin: '0', maxWidth: '42em', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.4' },
  }),
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/editor-api.test.js` (in `apps/jscad-web`)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/src/lint.js packages/agent-loop/index.js packages/agent-loop/test/lint.test.js apps/jscad-web/src/editorApi.js apps/jscad-web/test/editor-api.test.js
git commit -m "feat(jscad-web): show API docs on hover in the editor"
```

---

### Task 8: Docs and backlog

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md`
- Modify: `docs/backlog.md`
- Delete (working docs, per repo convention): `docs/superpowers/specs/2026-10-12-editor-api-lint-design.md`, `docs/superpowers/specs/dossier-editor-lint.md`, `docs/superpowers/plans/2026-10-12-editor-api-lint.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: user-facing documentation.

- [ ] **Step 1: Document the feature**

In `apps/jscad-web/docs/architecture.md`, in the "API style" section (near lines 886-934), add a short paragraph under the docs-tool description:

```markdown
The API index also drives the editor and the build tools. The pure core in
`packages/agent-loop/src/lint.js` walks a Lezer tree and flags an unknown option
key on a known API call, an unknown function name, and syntax errors; the
editor runs it through CodeMirror's linter and offers API-name and option-key
autocomplete and hover docs from the same index. `write`, `edit` and `run` run
the identical check on the source and add `source: 'static'` entries to their
`warnings`, beside the runtime option warnings.
```

- [ ] **Step 2: Delete the backlog item**

In `docs/backlog.md`, delete the whole "Editor lint, autocomplete and hover from the API index (jscad-web, agent-loop)." bullet (the "**Editor lint, autocomplete and hover...**" paragraph under "Remaining issues", around lines 555-565). Delete the item in this commit.

- [ ] **Step 3: Verify docs and the whole suite**

Run: `npm run lint` (repo root)
Expected: PASS.

Run: `npx vitest run test/lint.test.js eval/backend.test.js` (in `packages/agent-loop`)
Expected: PASS.

Run: `npx vitest run test/aiDeps.test.js test/editor-api.test.js test/editor.test.js` (in `apps/jscad-web`)
Expected: PASS.

- [ ] **Step 4: Delete the working docs and commit**

The spec, dossier and this plan are working documents; the repo deletes them in
the commit that lands the work.

```bash
rm docs/superpowers/specs/2026-10-12-editor-api-lint-design.md docs/superpowers/specs/dossier-editor-lint.md docs/superpowers/plans/2026-10-12-editor-api-lint.md
git add apps/jscad-web/docs/architecture.md docs/backlog.md docs/superpowers
git commit -m "docs(jscad-web): document the editor API help and drop the backlog item"
```

---

## Self-Review

**Spec coverage:**
- Unknown option key (spec Rule 2) → Task 1.
- Unknown function name (spec Rule 3) → Task 2.
- Syntax errors (spec Rule 1) → Task 2.
- `lintTree`/`lintSource` split and shared core → Tasks 1, 5.
- Editor lint (spec Editor plugins) → Task 5.
- Autocomplete names + options with defaults → Task 6.
- Hover full entry + single option → Task 7.
- Tool integration app and eval, tagged `source: 'static'` → Tasks 3, 4.
- Dependencies → Tasks 1 (agent-loop), 5 (app).
- Docs and backlog → Task 8.
- Guard on real fluent examples → Tasks 1/2 (direct) and 4 (`fluent-guard.test.js`).

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `lintTree`/`lintSource`/`lookupName`/`hoverTarget`/`apiDiagnostics`/`apiExtensions`/`completeApi`/`apiHover` keep the signatures declared in their task Interfaces blocks. `Diagnostic.source` is `'jscad'` in the editor and mapped to `'static'` by `staticWarnings` in the tools.

**Known limitation recorded in the spec:** only the first argument is inspected; `optionsAt` positions (`attachTo`/`alignTo`, `subtract`'s trailing object) are left to the runtime checks. Task 6's autocomplete uses a `{`/`,` heuristic and may offer option keys inside a comma-separated array nested in a call object; this is accepted for now.

**Noted deviations (minor):** the cap is named `MAX_DIAGNOSTICS` (the spec's prose says `MAX_WARNINGS`). Autocomplete completes names matching `[A-Za-z_$][\w$]*` rather than the spec's `[\w$.]*`, so a dotted prefix is not completed on its own. `staticWarnings`/`mergeStatic` are written twice, in the app tool path and the eval tool path; they are three lines each and live in different packages.

**Review fix:** identifier text is always `text.slice(node.from, node.to)` (or `state.sliceDoc` in the editor); a Lezer node's `name` is its type name (`'VariableName'`), never its source text.
