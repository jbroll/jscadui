# Parts trust batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the parts catalog trustworthy to trial: agent-visible dimension caveats, no SyntaxError on second-library insert, Insert usable when the entry view opens before the editor.

**Architecture:** Record-source-of-truth fix (summaries carry the drawn-vs-vendor deviation so `description` shows it), pure-function insert planner fix with aliasing, entry-view click-time editor check instead of render-time disable.

**Tech Stack:** ES2022, vitest (node default; `/** @vitest-environment jsdom */` for browser DOM tests), CodeMirror `ChangeSet` in insert tests.

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run package-scoped vitest files, not the full OpenSCAD suite locally.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0.
- YAGNI: no facade, no second sweep axis, no schema migration in this batch.
- Commit each task separately on the current branch (working in place per user choice).

---

### Task 1: Surface drawn-vs-vendor deviations in agent-visible summaries

**Files:**
- Modify: `packages/parts/catalog/nopscadlib/bearing_block.json`
- Modify: `packages/parts/catalog/nopscadlib/standoff.json`
- Modify: `packages/parts/catalog/nopscadlib/pillow_block.json`
- Modify: `packages/parts/test/build.test.js`
- Regenerate: `packages/agent-loop/api/parts.json`, `packages/agent-loop/prompt/parts.md`, `packages/agent-loop/api/index.json` via the documented catalog build

**Interfaces:**
- Consumes: `docsEntry(entry)` in `packages/parts/bin/build.js:71-92` copies `entry.summary` to `description` verbatim.
- Produces: summaries whose deviation sentences reach `description` with no code change to `build.js`.

- [ ] **Step 1: Write the failing test**

In `packages/parts/test/build.test.js`, inside `describe('buildAgentDocs', ...)`, add:

```js
it('carries drawn-vs-vendor deviations in the description', () => {
  const deviated = {
    id: 'n/bearing_block', family: 'bearing_block', library: 'N', license: 'GPL-3.0',
    file: 'N/bearing_block.scad', call: 'scs_bearing_block',
    summary: 'SCS..UU housing. Note: library draws x 36.2 while the vendor width is 34.',
    sizes: { names: ['SCS8UU'] }, example: 'scs_bearing_block(SCS8UU)', checks: [],
  }
  const dd = { 'n/bearing_block': { signature: { params: [{ name: 'type' }] }, sizes: ['SCS8UU'], measured: [], transpileMs: 1, buildMs: { max: 1, mean: 1 } } }
  const { json } = buildAgentDocs(buildCatalog([deviated], dd).entries)
  expect(json[0].description).toContain('vendor width is 34')
})
```

Also add a records-level assertion that the three real summaries contain their vendor numbers:

```js
it('real group1 deviation summaries name the vendor dimension', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
  expect(read('../catalog/nopscadlib/bearing_block.json').summary).toMatch(/vendor.*34/)
  expect(read('../catalog/nopscadlib/standoff.json').summary).toMatch(/5\.5 AF/)
  expect(read('../catalog/nopscadlib/pillow_block.json').summary).toMatch(/commonly listed as 29/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/parts/test/build.test.js`
Expected: FAIL on the new tests (summaries lack the sentences).

- [ ] **Step 3: Edit the three summaries (minimal)**

`bearing_block.json` summary becomes:

```
SCS..UU linear bearing housing with its LM..UU bearing, shaft axis on z through the origin, base down along -y. Note: the library draws SCS8UU 36.2 wide while the vendor width is 34.
```

`standoff.json` summary appends:

```
 ...despite its name. Note: the library draws the M3 hex standoff 5 AF while real M3 brass hex standoffs are 5.5 AF.
```

Full new summary:

```
Threaded standoff (brass, steel or nylon, hex or round), body from z = 0 up; a male thread goes below z = 0 or above the body depending on the type (M2x16_brass_pillar's is on top). The library draws M4x17_nylon_pillar 20 mm tall despite its name. Note: the library draws the M3 hex standoff 5 AF while real M3 brass hex standoffs are 5.5 AF.
```

`pillow_block.json` summary appends:

```
 Note: the library draws KP08 29.5 tall while it is commonly listed as 29.
```

Full new summary:

```
KP zinc pillow block with its ball bearing, shaft axis on z through the origin, base down along -y. Note: the library draws KP08 29.5 tall while it is commonly listed as 29.
```

No change to `checks[].size` values (they stay the drawn dimensions the sweep verifies).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/parts/test/build.test.js`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 5: Regenerate the agent docs from the edited records**

Run: `npm run catalog -w @jscadui/parts -- --out /tmp/parts-catalog-out && npm run api-index -w @jscadui/agent-loop`
Expected: `packages/agent-loop/api/parts.json` descriptions for `bearing_block`, `standoff`, `pillow_block` contain the new Note sentences; `api/index.json` updated.

Verify: `npx vitest run packages/agent-loop/test/api-index.test.js packages/agent-loop/test/agent-outputs.test.js` PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/parts/catalog/nopscadlib/bearing_block.json packages/parts/catalog/nopscadlib/standoff.json packages/parts/catalog/nopscadlib/pillow_block.json packages/parts/test/build.test.js packages/agent-loop/api/parts.json packages/agent-loop/prompt/parts.md packages/agent-loop/api/index.json
git commit -m "fix(parts): surface drawn-vs-vendor deviations in agent descriptions"
```

### Task 2: Alias the insert when the call name is already bound from another library

**Files:**
- Modify: `apps/jscad-web/src/partsInsert.js`
- Test: `apps/jscad-web/src/partsInsert.test.js`

**Interfaces:**
- Consumes: `planInsert({ doc, cursor, path, entry, size })` returns `{ changes, cursor }`; `entry` has `{ call, require, scadIncludes, insertArgs? }`.
- Produces: same shape, but when `entry.call` is already destructured from a *different* require path, the new require uses `const { nut: nut2 } = require('...')` and the inserted call uses the alias (`nut2(...)`). Alias picks `call + '2'`, then `call + '3'`, until neither the alias nor `call: alias` binding exists in the doc.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/src/partsInsert.test.js`, inside `describe('planInsert', ...)`, add:

```js
it('aliases the call when the name is already bound from another library', () => {
  const doc = "const { nut } = require('NopSCADlib/vitamins/nuts.scad')\n\n"
  const boslNut = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
  const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.js', entry: boslNut, size: '"M3"' }))
  expect(out).toBe("const { nut } = require('NopSCADlib/vitamins/nuts.scad')\nconst { nut: nut2 } = require('_catalog/BOSL2/screws.scad')\n\nnut2(\"M3\")")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/src/partsInsert.test.js`
Expected: FAIL. Current code emits a second `const { nut } = require(...)` (duplicate binding, SyntaxError).

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/partsInsert.js`, add above `jsRequireChange`:

```js
/** All `const { a, b: c } = require('...')` bindings in the doc: { names bound, paths per name }. */
const existingBindings = (doc) => {
  const bound = new Map()
  const re = /const\s*\{([^}]*)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g
  let m
  while ((m = re.exec(doc))) {
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const alias = part.split(':').map((s) => s.trim())
      bound.set(alias.length === 2 ? alias[1] : alias[0], m[2])
    }
  }
  return bound
}

const freeAlias = (doc, call) => {
  if (!existingBindings(doc).has(call)) return null
  let n = 2
  while (existingBindings(doc).has(`${call}${n}`)) n++
  return `${call}${n}`
}
```

Change `jsRequireChange(doc, entry, size)` to compute `const alias = freeAlias(doc, entry.call)` first. When `alias` is set and the doc has no require for `entry.require`, return:

```js
return { from: 0, to: 0, insert: `const { ${entry.call}: ${alias} } = require('${entry.require}')\n`, alias }
```

When the require for `entry.require` already exists, keep the existing missing-name merge but merge the alias form (`nut: nut2`) instead of the bare call. Return the alias alongside the change so `planInsert` can use it.

In `planInsert`, use the returned alias for the call text:

```js
const callName = prefixAlias ?? entry.call
const callText = scad ? `${callName}(${args});` : `${callName}(${args})`
```

Size-name binding (`M3_nut` destructured size) stays as is; only the call name aliases (the backlog issue is same-name parts).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/src/partsInsert.test.js`
Expected: PASS, all tests including the new alias test; no existing test changes.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/partsInsert.js apps/jscad-web/src/partsInsert.test.js
git commit -m "fix(parts): alias insert when the call name is bound from another library"
```

### Task 3: Keep Insert usable when the entry view opens before the editor is ready

**Files:**
- Modify: `apps/jscad-web/src/partsBrowser.js`
- Test: `apps/jscad-web/test/parts-browser.test.js`

**Interfaces:**
- Consumes: `renderEntry(content, entry, { getEditor, onBack })` in `apps/jscad-web/src/partsBrowser.js:295-350`; `getEditor()` returns the editor or null.
- Produces: Insert button never stuck disabled; click re-checks `getEditor()` at click time and inserts when available, otherwise shows the not-ready note.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/test/parts-browser.test.js`, add:

```js
it('inserts once the editor arrives after the entry view opened', async () => {
  const { showPartsBrowser } = await import('../src/partsBrowser.js')
  let editor = null
  const applyEdit = vi.fn()
  showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
  await flush()
  document.querySelectorAll('.parts-entry')[0].click()
  document.querySelector('.parts-insert').click()
  expect(applyEdit).not.toHaveBeenCalled()
  editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
  document.querySelector('.parts-insert').click()
  expect(applyEdit).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/test/parts-browser.test.js`
Expected: FAIL. Current `renderEntry` captures `editorReady` once at render (`partsBrowser.js:310`) and disables the button, so the second click can never insert.

- [ ] **Step 3: Write minimal implementation**

In `renderEntry` (`apps/jscad-web/src/partsBrowser.js:309-328`), stop disabling at render. Replace:

```js
const editorReady = Boolean(getEditor?.())
const insertBtn = el('button', {
  className: 'parts-insert',
  ...(editorReady ? {} : { disabled: true }),
  onclick: () => {
    const editor = getEditor?.()
    if (!editor) return
    ...
```

with:

```js
const notReady = () => content.querySelector('.parts-not-ready')
const insertBtn = el('button', {
  className: 'parts-insert',
  onclick: (e) => {
    const editor = getEditor?.()
    if (!editor) {
      if (!notReady()) e.target.after(el('p', { className: 'parts-not-ready' }, 'Editor not ready yet.'))
      return
    }
    notReady()?.remove()
    const size = formatSize(entry, selectedSize)
    const plan = planInsert({
      doc: editor.getSource(),
      cursor: editor.getCursor(),
      path: editor.getPath(),
      entry,
      size,
    })
    editor.applyEdit(plan)
  },
}, 'Insert')
```

And in the view body (`:330-349`), render the not-ready note only when `!getEditor?.()` at render, same as today, but never set `disabled` on the button.

Update the existing test at `test/parts-browser.test.js:82-91` (`disables Insert and shows a not-ready note when no editor is available`): change `expect(insertBtn.disabled).toBe(true)` to `expect(insertBtn.disabled).toBe(false)` and keep the not-ready note assertion plus the no-throw click.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/parts-browser.test.js apps/jscad-web/src/partsInsert.test.js`
Expected: PASS, including the new late-editor test and the updated disabled assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/partsBrowser.js apps/jscad-web/test/parts-browser.test.js
git commit -m "fix(parts): keep Insert usable when the entry view opens before the editor"
```
