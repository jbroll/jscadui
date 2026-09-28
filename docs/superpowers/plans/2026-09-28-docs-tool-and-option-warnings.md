# Docs Tool and Unknown-Option Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat model a `docs` tool that answers JSCAD API lookups from a generated index, and return unknown-option warnings with `eval` results, in the app and in the eval harness.

**Architecture:** A generator in `packages/agent-loop/api/` parses the modeling JSDoc, the fluent `.d.ts` files and the jscad-text JSDoc into a committed `api/index.json` plus a small `api/optionTable.js`. A pure `docs.js` answers lookups from the index in the page and in the eval backend. `optionChecks.js` builds a copy of a module's exports whose options-first functions report unknown keys; `@jscadui/require` hands that copy only to project files (`setUserModuleWrapper`), the frame worker collects warnings per run, and the eval backend wraps inside its CDN stub.

**Tech Stack:** Node 22 ESM, vitest 4, esbuild (app and frame bundles), Playwright via simple-ci only.

**Spec:** `docs/superpowers/specs/2026-09-28-docs-tool-and-option-warnings-design.md`

## Global Constraints

- Modern browsers only, ES2022+, no polyfills or compat shims.
- No new dependencies. JSDoc and `.d.ts` are parsed by the in-repo code in `api/jsdoc.js` and `api/fluent.js` (bracket scanning and regexes), not by `jsdoc` or `typescript`.
- Comments: default to none; a comment states a non-obvious why in one or two lines.
- Tests are vitest. Run one file from the repo root with `npx vitest run --root <pkgdir> <file>`.
- Never run Playwright locally. e2e runs only on simple-ci: `../simple-ci/sci push jscadui/web` from the repo root, then `../simple-ci/sci wait <job>` under Bash `run_in_background`.
- Never run the OpenSCAD full suite locally.
- No `sleep`, `while`/`until` loops, `watch` or `tail -f`. One command per Bash call.
- Stay on branch `docs-tool`. Commit at the end of each task and let the pre-commit hook run; never `--no-verify`. Never push, never open a PR. Implementers end commit messages with their harness's own `Co-Authored-By` line.
- Library code must never receive a wrapped exports object; the require cache holds the real one.
- A warning is `{ fn, option, suggestions }`; a run keeps each `fn`+`option` once and at most 20 warnings.
- A `docs` answer is at most 3,000 characters, truncated with a note.
- Live evals spend API budget: run one only after the user says yes (Task 11).

## Decisions that differ from the spec

The executor should read these before Task 1; each task's code already follows them.

1. **`FluentGeom3.extrudeLinear` does not exist.** `extrudeLinear` is a `FluentGeom2` method (it turns a 2D shape into a `FluentGeom3`). Tests and the tool description use `FluentGeom2.extrudeLinear`.
2. **Index size is about 130 KB, not 20-40 KB.** Modeling alone is 65 KB. To keep it there, a fluent entry whose options are a modeling function's carries `sameAs` without a copy of the options (`docs.js` and the option table resolve it), and the array classes carry `extends: 'FluentGeometryArray'` instead of repeating inherited methods. Empty fields (`options`, `example`, `sameAs`, `optionsFirst: false`) are omitted. The test bound is 150 KB.
3. **Suggestions also match by containment.** `radius` to `roundRadius` is edit distance 5, so the target stumble would get no suggestion under "within edit distance 3". A known option is suggested when its distance is at most 3 or one name contains the other, case-insensitively.
4. **Error shape.** A `docs` miss returns `{ ok: false, error: { name: 'NotFoundError', message: 'no entry <q>; closest: a, b, c' } }`, the shape every other tool error uses and the prompt tells the model to read (`error.message`). A hit is plain text, not JSON.
5. **Bare names that hit several packages.** `roundedCuboid` matches `primitives.roundedCuboid` and `jf.roundedCuboid`. When exactly one hit is from `@jscad/modeling`, `docs` answers it and lists the others on an `Also:` line; otherwise it lists the candidates.
6. **`minkowski` is indexed.** It is a public modeling namespace the spec's list left out.
7. **Options JSDoc misses.** The generator adds a function's `defaults` literal keys when the file exports that one function (`extrudeLinear`'s `repair`), and `PASS_THROUGH` adds the options `extrudeRectangular` hands to `expand` and `extrudeLinear`. Without these, correct calls warn.
8. **Option table shape** is `{ [pkg]: { prefix, options: { [path]: string[] } } }`, so a fluent warning names `jf.cube` while the wrapper walks `cube`.
9. **Fluent class methods are documented but not checked.** The wrapper covers functions reachable from the exports object. Class prototypes are shared with library code, so wrapping them would warn on internal calls. Recorded in the backlog.
10. **The app's `eval` result keeps its shape**, `{ entityCount }`, and gains `warnings` only when there are some. It has never carried `ok: true`.
11. **The collector lives behind `setRunWarnings(collector)` in `packages/worker/worker.js`**, so the worker package needs no agent-loop code. A parameter-change `jscadMain` without a new `jscadScript` reports the load's warnings plus its own, deduplicated.

---

### Task 1: API index from JSDoc (modeling and jscad-text)

**Files:**
- Create: `packages/agent-loop/api/jsdoc.js`
- Create: `packages/agent-loop/api/jsdocEntries.js`
- Create: `packages/agent-loop/api/build-index.js`
- Create (generated): `packages/agent-loop/api/index.json`, `packages/agent-loop/api/optionTable.js`
- Create: `packages/agent-loop/test/api-index.test.js`
- Modify: `packages/agent-loop/package.json` (script `api-index`, `files` gains `api`)
- Modify: `packages/agent-loop/README.md` (new `## API index` section before `## Eval`, line 63)

**Model:** `sonnet` — several new files with full code, but the generator runs against real sources and small drift must be judged.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `api/jsdoc.js`: `parseParam(body: string) → { type, name, default: string|null, description }`, `parseBlock(raw) → { description, params, returns, example: string|null }`, `declarationOf(source, name) → { kind: 'function'|'value', doc } | null`, `leadingBlock(source)`, `firstSentence(text) → string`.
  - `api/jsdocEntries.js`: `modelingEntries(srcDir) → Entry[]`, `jscadTextEntries(srcDir) → Entry[]`, `functionEntry(...)`.
  - `api/build-index.js`: `buildIndex() → Entry[]`, `optionTables(entries) → { [pkg]: { prefix, options } }`, `formatIndex(entries) → string`, `formatOptionTable(tables) → string`.
  - `api/index.json`: `Entry[]`, one JSON object per line. `Entry = { name, pkg, kind: 'namespace'|'class'|'function'|'value', signature?, description, optionsFirst?, options?: {name,type,default,description}[], example?, sameAs?, extends?, members?: {name,summary}[] }`.
  - `api/optionTable.js`: `export const OPTION_TABLES = { '@jscad/modeling': { prefix: '', options: { 'primitives.roundedCuboid': ['center','roundRadius','segments','size'], ... } }, '@jbroll/jscad-fluent': { prefix: 'jf.', options: {} } }` (fluent fills in Task 2).

- [ ] **Step 1: Write the failing test**

Create `packages/agent-loop/test/api-index.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildIndex, formatIndex, formatOptionTable, optionTables } from '../api/build-index.js'
import { declarationOf, parseParam } from '../api/jsdoc.js'
import { OPTION_TABLES } from '../api/optionTable.js'

const entries = buildIndex()
const entry = (name) => entries.find((e) => e.name === name)

describe('JSDoc parsing', () => {
  it('reads an optional option with a default', () => {
    expect(parseParam('{Number} [options.roundRadius=0.2] - radius of rounded edges')).toEqual({
      type: 'Number', name: 'options.roundRadius', default: '0.2', description: 'radius of rounded edges',
    })
  })

  it('keeps brackets inside a default and trims spaces around =', () => {
    expect(parseParam('{Array} [options.center=[0,0,0]] - center').default).toBe('[0,0,0]')
    expect(parseParam("{Array} [options.modes = ['center', 'min']] - modes").default).toBe("['center', 'min']")
  })

  it('reads a description without a dash and a rest parameter', () => {
    expect(parseParam('{Boolean} [options.snap=false] the geometries should be snapped').description).toBe('the geometries should be snapped')
    expect(parseParam('{...Object} objects - the objects to translate')).toEqual({
      type: '...Object', name: 'objects', default: null, description: 'the objects to translate',
    })
  })

  it('finds the block right above a declaration', () => {
    const source = 'const x = 1\n/** other */\nconst y = 2\n\n/**\n * Make a thing.\n * @param {Object} options - opts\n */\nconst make = (options) => options\n'
    const decl = declarationOf(source, 'make')
    expect(decl.kind).toBe('function')
    expect(decl.doc.description).toBe('Make a thing.')
    expect(declarationOf(source, 'x')).toEqual({ kind: 'value', doc: null })
  })
})

describe('API index', () => {
  it('documents roundedCuboid with its options and defaults', () => {
    const e = entry('primitives.roundedCuboid')
    expect(e).toMatchObject({ pkg: '@jscad/modeling', kind: 'function', signature: 'roundedCuboid(options) → geom3', optionsFirst: true })
    expect(e.options.find((o) => o.name === 'roundRadius')).toEqual({
      name: 'roundRadius', type: 'Number', default: '0.2', description: 'radius of rounded edges',
    })
    expect(e.example).toContain('roundRadius: 2')
  })

  it('lists a namespace with one-line member summaries', () => {
    const ns = entry('primitives')
    expect(ns.kind).toBe('namespace')
    expect(ns.members).toContainEqual({
      name: 'roundedCuboid', summary: 'Construct an axis-aligned solid cuboid in three dimensional space with rounded corners.',
    })
  })

  it('signs positional and rest parameters', () => {
    expect(entry('transforms.translate').signature).toBe('translate(offset, ...objects) → Object|Array')
  })

  it('leaves out maths and geometries', () => {
    expect(entries.some((e) => /^(maths|geometries)(\.|$)/.test(e.name))).toBe(false)
  })

  it('adds the options JSDoc omits', () => {
    expect(entry('extrusions.extrudeLinear').options.map((o) => o.name)).toContain('repair')
    expect(entry('extrusions.extrudeRectangular').options.map((o) => o.name)).toEqual(
      expect.arrayContaining(['size', 'height', 'corners', 'segments', 'twistAngle']),
    )
  })

  it('documents jscad-text', () => {
    expect(entry('jscadText.text2d').options.map((o) => o.name)).toContain('halign')
    expect(entry('jscadText').kind).toBe('namespace')
  })

  it('tables the option names of optionsFirst functions', () => {
    const modeling = OPTION_TABLES['@jscad/modeling']
    expect(modeling.prefix).toBe('')
    expect(modeling.options['primitives.roundedCuboid']).toEqual(['center', 'roundRadius', 'segments', 'size'])
    expect(Object.keys(modeling.options)).not.toContain('transforms.translate')
  })

  it('matches a fresh generation', () => {
    expect(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8')).toBe(formatIndex(entries))
    expect(readFileSync(new URL('../api/optionTable.js', import.meta.url), 'utf8')).toBe(formatOptionTable(optionTables(entries)))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/api-index.test.js`
Expected: FAIL, the suite cannot load `../api/build-index.js` (file does not exist).

- [ ] **Step 3: Write the JSDoc parser**

Create `packages/agent-loop/api/jsdoc.js`:

```js
const balanced = (text, open, close) => {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === open) depth += 1
    else if (text[i] === close && --depth === 0) return i
  }
  return -1
}

const squash = (text) => text.replace(/\s+/g, ' ').trim()

export const parseParam = (body) => {
  let rest = body.trim()
  let type = ''
  if (rest.startsWith('{')) {
    const end = balanced(rest, '{', '}')
    type = rest.slice(1, end).trim()
    rest = rest.slice(end + 1).trimStart()
  }
  let name
  let value = null
  if (rest.startsWith('[')) {
    const end = balanced(rest, '[', ']')
    const inner = rest.slice(1, end)
    rest = rest.slice(end + 1)
    const eq = inner.indexOf('=')
    name = (eq === -1 ? inner : inner.slice(0, eq)).trim()
    if (eq !== -1) value = inner.slice(eq + 1).trim()
  } else {
    name = /^\S*/.exec(rest)[0]
    rest = rest.slice(name.length)
  }
  return { type, name, default: value, description: squash(rest.replace(/^\s*-\s*/, '')) }
}

export const parseBlock = (raw) => {
  const lines = raw.split('\n').map((line) => line.replace(/^\s*\*? ?/, ''))
  const description = []
  const tags = []
  for (const line of lines) {
    const tag = /^@(\w+)\s?(.*)$/.exec(line)
    if (tag) tags.push({ tag: tag[1], lines: [tag[2]] })
    else if (tags.length) tags[tags.length - 1].lines.push(line)
    else description.push(line)
  }
  const example = tags.find((t) => t.tag === 'example')
  const returns = tags.find((t) => t.tag === 'returns' || t.tag === 'return')
  return {
    description: squash(description.join(' ')),
    params: tags.filter((t) => t.tag === 'param').map((t) => parseParam(t.lines.join(' '))),
    returns: returns ? parseParam(returns.lines.join(' ')).type : '',
    example: example ? example.lines.join('\n').trim() || null : null,
  }
}

export const declarationOf = (source, name) => {
  const decl = new RegExp(`^[ \\t]*(?:export\\s+)?(?:async\\s+)?(const|let|var|function|class)\\s+${name}\\b(.*)$`, 'm').exec(source)
  if (!decl) return null
  const callable = decl[1] === 'function' || /=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(decl[2])
  let doc = null
  for (const block of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const end = block.index + block[0].length
    if (end <= decl.index && source.slice(end, decl.index).trim() === '') doc = parseBlock(block[1])
  }
  return { kind: callable ? 'function' : 'value', doc }
}

export const leadingBlock = (source) => {
  const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source)
  return block ? parseBlock(block[1]) : null
}

export const firstSentence = (text) => {
  const end = text.search(/\.(\s|$)/)
  const sentence = end === -1 ? text : text.slice(0, end + 1)
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence
}
```

- [ ] **Step 4: Write the modeling and jscad-text walkers**

Create `packages/agent-loop/api/jsdocEntries.js`:

```js
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { declarationOf, firstSentence, leadingBlock } from './jsdoc.js'

// maths and geometries are internals the chat model should not build with.
export const MODELING_NAMESPACES = [
  'primitives', 'booleans', 'transforms', 'extrusions', 'expansions', 'hulls', 'minkowski',
  'modifiers', 'colors', 'measurements', 'curves', 'text', 'utils',
]

const MODELING = '@jscad/modeling'
const JSCAD_TEXT = '@jscadui/jscad-text'
const MEMBER = /^\s*([A-Za-z_$][\w$]*)\s*:\s*require\('(\.[^']+)'\)(?:\.([A-Za-z_$][\w$]*))?/gm
const REEXPORT = /^export \{([^}]*)\} from '(\.[^']+)'/gm
const read = (file) => readFileSync(file, 'utf8')

const moduleFile = (dir, rel) => {
  const file = join(dir, `${rel}.js`)
  return existsSync(file) ? file : join(dir, rel, 'index.js')
}

const soleExport = (source) => /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*$/m.exec(source)?.[1]

// Options the function reads from its defaults literal but its JSDoc omits
// (extrudeLinear's repair), so a correct call never draws a warning.
const defaultsOf = (source) => {
  const block = /const defaults = \{\n([\s\S]*?)\n\s*\}/.exec(source)
  if (!block) return []
  return block[1].split('\n').flatMap((line) => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.*?),?\s*$/.exec(line)
    return m ? [{ name: m[1], default: m[2] }] : []
  })
}

export const functionEntry = ({ name, pkg, kind, doc, extraDefaults = [] }) => {
  const short = name.slice(name.lastIndexOf('.') + 1)
  if (kind !== 'function') return { name, pkg, kind, signature: short, description: doc?.description ?? '' }
  const params = doc?.params ?? []
  const top = params.filter((p) => !p.name.includes('.'))
  const options = params
    .filter((p) => /^options\.[A-Za-z_$][\w$]*$/.test(p.name))
    .map((p) => ({ name: p.name.slice('options.'.length), type: p.type, default: p.default, description: p.description }))
  const optionsFirst = top[0]?.name === 'options'
  if (optionsFirst) {
    for (const extra of extraDefaults) {
      if (!options.some((o) => o.name === extra.name)) options.push({ name: extra.name, type: '', default: extra.default, description: '' })
    }
  }
  const args = top.map((p) => (p.type.startsWith('...') ? `...${p.name}` : p.name)).join(', ')
  const entry = {
    name,
    pkg,
    kind,
    signature: `${short}(${args})${doc?.returns ? ` → ${doc.returns}` : ''}`,
    description: doc?.description ?? '',
  }
  if (optionsFirst) entry.optionsFirst = true
  if (options.length) entry.options = options
  if (doc?.example) entry.example = doc.example
  return entry
}

const namespaceEntries = (indexFile, name) => {
  const source = read(indexFile)
  const dir = dirname(indexFile)
  const members = []
  const entries = []
  for (const [, member, rel, prop] of source.matchAll(MEMBER)) {
    const file = moduleFile(dir, rel)
    const qualified = `${name}.${member}`
    if (file.endsWith('index.js') && !prop) {
      const nested = namespaceEntries(file, qualified)
      members.push({ name: member, summary: firstSentence(nested[0].description) })
      entries.push(...nested)
      continue
    }
    const fileSource = read(file)
    const local = prop ?? soleExport(fileSource) ?? member
    const decl = declarationOf(fileSource, local) ?? { kind: 'function', doc: null }
    const extraDefaults = !prop && soleExport(fileSource) ? defaultsOf(fileSource) : []
    const entry = functionEntry({ name: qualified, pkg: MODELING, kind: decl.kind, doc: decl.doc, extraDefaults })
    members.push({ name: member, summary: firstSentence(entry.description) })
    entries.push(entry)
  }
  const doc = leadingBlock(source)
  return [{ name, pkg: MODELING, kind: 'namespace', description: doc?.description ?? '', members }, ...entries]
}

export const modelingEntries = (srcDir) => {
  const root = read(join(srcDir, 'index.js'))
  const files = new Map([...root.matchAll(MEMBER)].map(([, member, rel]) => [member, moduleFile(srcDir, rel)]))
  return MODELING_NAMESPACES.flatMap((ns) => namespaceEntries(files.get(ns), ns))
}

export const jscadTextEntries = (srcDir) => {
  const indexSource = read(join(srcDir, 'index.js'))
  const found = [...indexSource.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)]
    .map(([, name]) => ({ name, local: name, source: indexSource }))
  for (const [, list, rel] of indexSource.matchAll(REEXPORT)) {
    const source = read(join(srcDir, rel))
    for (const item of list.split(',')) {
      const [local, alias] = item.trim().split(/\s+as\s+/)
      if (local) found.push({ name: alias ?? local, local, source })
    }
  }
  const entries = found.flatMap(({ name, local, source }) => {
    const decl = declarationOf(source, local)
    if (decl?.kind !== 'function' || !decl.doc) return []
    return [functionEntry({ name: `jscadText.${name}`, pkg: JSCAD_TEXT, kind: 'function', doc: decl.doc })]
  })
  const description = 'Text as 2D geometry: Hershey stroke fonts and TTF/OTF outline fonts. Call init(jscad) before text2d.'
  const members = entries.map((e) => ({ name: e.name.slice('jscadText.'.length), summary: firstSentence(e.description) }))
  return [{ name: 'jscadText', pkg: JSCAD_TEXT, kind: 'namespace', description, members }, ...entries]
}
```

- [ ] **Step 5: Write the generator**

Create `packages/agent-loop/api/build-index.js`:

```js
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jscadTextEntries, modelingEntries } from './jsdocEntries.js'

const require = createRequire(import.meta.url)

// Functions that hand their own options object to another public function.
const PASS_THROUGH = {
  'extrusions.extrudeRectangular': ['expansions.expand', 'extrusions.extrudeLinear'],
}

const addPassThrough = (entries) => {
  const byName = new Map(entries.map((e) => [e.name, e]))
  for (const [name, targets] of Object.entries(PASS_THROUGH)) {
    const entry = byName.get(name)
    for (const target of targets) {
      for (const option of byName.get(target).options ?? []) {
        if (!entry.options.some((o) => o.name === option.name)) entry.options.push(option)
      }
    }
  }
  return entries
}

export const buildIndex = () => {
  const modeling = addPassThrough(modelingEntries(dirname(require.resolve('@jscad/modeling'))))
  const text = jscadTextEntries(fileURLToPath(new URL('../../jscad-text/src', import.meta.url)))
  return [...modeling, ...text]
}

const PACKAGE_PREFIX = { '@jscad/modeling': '', '@jbroll/jscad-fluent': 'jf.' }

export const optionTables = (entries) => {
  const byName = new Map(entries.map((e) => [e.name, e]))
  const tables = {}
  for (const [pkg, prefix] of Object.entries(PACKAGE_PREFIX)) {
    const options = {}
    for (const e of entries) {
      if (e.pkg !== pkg || !e.optionsFirst || !e.name.startsWith(prefix)) continue
      const source = e.sameAs ? byName.get(e.sameAs) : e
      options[e.name.slice(prefix.length)] = (source.options ?? []).map((o) => o.name).sort()
    }
    tables[pkg] = { prefix, options }
  }
  return tables
}

export const formatIndex = (entries) => `[\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`

export const formatOptionTable = (tables) => {
  const packages = Object.entries(tables).map(([pkg, { prefix, options }]) => {
    const rows = Object.entries(options).map(([path, names]) => `      ${JSON.stringify(path)}: ${JSON.stringify(names)},`)
    return `  ${JSON.stringify(pkg)}: {\n    prefix: ${JSON.stringify(prefix)},\n    options: {\n${rows.join('\n')}\n    },\n  },`
  })
  return `// Generated by api/build-index.js; do not edit. Run: npm run api-index -w @jscadui/agent-loop\nexport const OPTION_TABLES = {\n${packages.join('\n')}\n}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = buildIndex()
  writeFileSync(new URL('./index.json', import.meta.url), formatIndex(entries))
  writeFileSync(new URL('./optionTable.js', import.meta.url), formatOptionTable(optionTables(entries)))
  console.log(`api-index: ${entries.length} entries`)
}
```

In `packages/agent-loop/package.json`, add `"api"` to `files` (after `"src"`) and add to `scripts`:

```json
    "api-index": "node api/build-index.js",
```

- [ ] **Step 6: Generate the index**

Run: `npm run api-index -w @jscadui/agent-loop`
Expected: `api-index: 139 entries` (128 modeling, 11 jscad-text). `packages/agent-loop/api/index.json` and `api/optionTable.js` now exist; the fluent table is `options: {\n\n    }` until Task 2.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/api-index.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 8: Document the index**

In `packages/agent-loop/README.md`, insert before `## Eval`:

```markdown
## API index

`api/index.json` describes the public API of `@jscad/modeling`, from the
pinned checkout's JSDoc (every namespace but `maths` and `geometries`), and of
`@jscadui/jscad-text`, from its JSDoc. It has one entry per namespace or
function: `name` (`primitives.roundedCuboid`, `jscadText.text2d`), `pkg`,
`kind`, `signature`, `description`, `example`, and for a function that takes
an options object first, `optionsFirst` and `options` (name, type, default,
description). `api/optionTable.js` holds only the option names, for the
unknown-option checks.

Both files are generated and committed:

    npm run api-index -w @jscadui/agent-loop

A test fails when either differs from a fresh generation, so a
`@jscad/modeling` pin update needs a regeneration in the same commit. Where
JSDoc misses an option the generator adds it: a function's `defaults` literal
keys (`extrudeLinear`'s `repair`), and the options `PASS_THROUGH` in
`api/build-index.js` names (`extrudeRectangular` hands its options to
`expand` and `extrudeLinear`).
```

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/api packages/agent-loop/test/api-index.test.js packages/agent-loop/package.json packages/agent-loop/README.md
git commit -m "feat(agent-loop): generate an API index from modeling and jscad-text JSDoc"
```

---

### Task 2: Fluent entries in the API index

**Files:**
- Create: `packages/agent-loop/api/fluent.js`
- Modify: `packages/agent-loop/api/build-index.js` (`buildIndex`)
- Regenerate: `packages/agent-loop/api/index.json`, `packages/agent-loop/api/optionTable.js`
- Modify: `packages/agent-loop/test/api-index.test.js` (new `describe('fluent entries')`)
- Modify: `packages/agent-loop/README.md` (`## API index`)

**Model:** `sonnet` — a `.d.ts` scanner with full code; the implementer checks its output against the installed fluent 0.6.1 types.

**Interfaces:**
- Consumes: `parseBlock`, `firstSentence` from `api/jsdoc.js`; modeling `Entry[]` from `modelingEntries`.
- Produces: `fluentEntries(distDir: string, modeling: Entry[]) → Entry[]` with names `jf`, `jf.<factory>`, `jf.colors`, `jf.colors.<fn>`, `FluentGeom2|FluentGeom3|FluentPath2|FluentGeometryArray|FluentGeom2Array|FluentGeom3Array|FluentPath2Array` (kind `class`, `members`, optional `extends`) and `<Class>.<method>`. A factory or method whose options are a modeling function's carries `sameAs: '<modeling name>'` and `optionsFirst: true`, no `options`. `OPTION_TABLES['@jbroll/jscad-fluent'].options` keys are factory names without `jf.`.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-loop/test/api-index.test.js`:

```js
describe('fluent entries', () => {
  it('points a factory with modeling options at the modeling entry', () => {
    expect(entry('jf.roundedCuboid')).toMatchObject({ pkg: '@jbroll/jscad-fluent', sameAs: 'primitives.roundedCuboid', optionsFirst: true })
    expect(entry('jf.roundedCuboid').options).toBeUndefined()
    expect(entry('jf.arc').sameAs).toBe('primitives.arc')
  })

  it('keeps polygon as a points array, not options', () => {
    expect(entry('jf.polygon').signature).toBe('polygon(points: Point2[]) → FluentGeom2')
    expect(entry('jf.polygon').optionsFirst).toBeUndefined()
  })

  it('lists the options of fluent-only factories', () => {
    expect(entry('jf.cylinder').options.map((o) => o.name)).toEqual(['height', 'segments', 'center', 'angle', 'radius', 'outer', 'inner', 'wall'])
    expect(entry('jf.polyhedron').options.map((o) => o.name)).toEqual(['points', 'faces'])
  })

  it('documents class methods and maps option types to modeling', () => {
    expect(entry('FluentGeom2.extrudeLinear')).toMatchObject({
      sameAs: 'extrusions.extrudeLinear', signature: 'extrudeLinear(options: ExtrudeLinearOptions) → FluentGeom3',
    })
    expect(entry('FluentGeom3').members.map((m) => m.name)).toContain('translate')
    expect(entry('FluentGeom3Array')).toMatchObject({ kind: 'class', extends: 'FluentGeometryArray' })
  })

  it('reads nested namespace JSDoc without comment markers', () => {
    expect(entry('jf.colors.hexToRgb').description).toBe('Convert hex color notation to RGB or RGBA.')
  })

  it('tables fluent factory options under names without jf.', () => {
    const fluent = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(fluent.prefix).toBe('jf.')
    expect(fluent.options.roundedCuboid).toEqual(['center', 'roundRadius', 'segments', 'size'])
    expect(fluent.options.cylinder).toEqual(['angle', 'center', 'height', 'inner', 'outer', 'radius', 'segments', 'wall'])
    expect(Object.keys(fluent.options)).not.toContain('polygon')
  })

  it('stays under 150 KB', () => {
    expect(formatIndex(entries).length).toBeLessThan(150_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/api-index.test.js`
Expected: FAIL on every `fluent entries` test (`entry(...)` is undefined).

- [ ] **Step 3: Write the fluent scanner**

Create `packages/agent-loop/api/fluent.js`:

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstSentence, parseBlock } from './jsdoc.js'

const FLUENT = '@jbroll/jscad-fluent'
const CLASSES = ['FluentGeom2', 'FluentGeom3', 'FluentPath2', 'FluentGeometryArray', 'FluentGeom2Array', 'FluentGeom3Array', 'FluentPath2Array']

const read = (file) => readFileSync(file, 'utf8')
const squash = (text) => text.replace(/\s+/g, ' ').trim()
const lcfirst = (s) => s[0].toLowerCase() + s.slice(1)

// Splits a type-literal or class body on the semicolons at its own depth,
// keeping each member's leading JSDoc.
export const members = (body) => {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (body.startsWith('/*', i)) {
      i = body.indexOf('*/', i) + 1
      continue
    }
    if ('({['.includes(c)) depth += 1
    else if (')}]'.includes(c)) depth -= 1
    else if (c === ';' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  return out.map((text) => {
    const doc = /^\s*\/\*\*([\s\S]*?)\*\/\s*/.exec(text)
    const raw = doc ? text.slice(doc[0].length) : text
    return { doc: doc ? parseBlock(doc[1]) : null, raw, text: squash(raw) }
  }).filter((m) => m.text)
}

const bodyAfter = (source, marker) => {
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`fluent types: no "${marker}"`)
  const open = source.indexOf('{', at + marker.length - 1)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`fluent types: unbalanced "${marker}"`)
}

const closeParen = (text, open) => {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

const method = (text) => {
  const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text)
  if (!m) return null
  const open = m[0].length - 1
  const close = closeParen(text, open)
  return { name: m[1], params: text.slice(open + 1, close).trim(), returns: text.slice(close + 1).replace(/^\s*:\s*/, '').trim() }
}

export const fluentEntries = (distDir, modeling) => {
  const modelingFn = new Map()
  for (const e of modeling) {
    if (e.kind !== 'function') continue
    const bare = e.name.slice(e.name.lastIndexOf('.') + 1)
    if (!modelingFn.has(bare)) modelingFn.set(bare, e)
  }
  const byName = new Map(modeling.map((e) => [e.name, e]))
  const sameAs = (target) => ({ sameAs: target.name, ...(target.optionsFirst ? { optionsFirst: true } : {}) })

  // A destructuring pattern names its own keys; an inline `options: {...}` or
  // a named *Options type passes through to the modeling function.
  const optionsOf = (name, params) => {
    if (params.startsWith('{')) {
      const keys = /^\{([^}]*)\}/.exec(params)[1].split(',').map((k) => k.trim()).filter(Boolean)
      return { optionsFirst: true, options: keys.map((k) => ({ name: k, type: '', default: null, description: '' })) }
    }
    const typed = /^(\w+)\s*:\s*(\w+)?/.exec(params)
    if (!typed) return {}
    const [, param, type] = typed
    const named = type && /^(\w+)Options$/.exec(type)
    const target = named ? modelingFn.get(lcfirst(named[1])) : param === 'options' ? modelingFn.get(name) : null
    return target ? sameAs(target) : {}
  }

  const fromModeling = (bare) => {
    const target = modelingFn.get(bare)
    return target ? firstSentence(target.description) : ''
  }

  const index = read(join(distDir, 'index.d.ts'))
  const declared = new Map()
  for (const m of index.matchAll(/^declare function ([A-Za-z_$][\w$]*)(\([^\n]*);$/gm)) {
    if (!declared.has(m[1])) declared.set(m[1], method(`${m[1]}${m[2]}`))
  }

  const cylinderSource = read(join(distDir, 'cylinder.d.ts'))
  const flex = members(bodyAfter(cylinderSource, 'interface FlexCylinderOptions {'))
  const cylinderDoc = parseBlock(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*export declare function cylinder/.exec(cylinderSource)[1])

  const factory = (prefix, { doc, text }) => {
    const typeofRef = /^([A-Za-z_$][\w$]*)\s*:\s*typeof\s+([\w.]+)$/.exec(text)
    if (typeofRef) {
      const [, name, ref] = typeofRef
      const qualified = `${prefix}.${name}`
      if (ref === 'cylinder') {
        return {
          name: qualified, pkg: FLUENT, kind: 'function',
          signature: 'cylinder(options: FlexCylinderOptions) → FluentGeom3',
          description: cylinderDoc.description,
          optionsFirst: true,
          options: flex.map((m) => ({
            name: /^(\w+)/.exec(m.text)[1], type: squash(m.text.replace(/^\w+\??\s*:\s*/, '')), default: null, description: m.doc?.description ?? '',
          })),
          ...(cylinderDoc.example ? { example: cylinderDoc.example } : {}),
        }
      }
      const fn = declared.get(ref)
      if (fn) return { name: qualified, pkg: FLUENT, kind: 'function', signature: `${name}(${fn.params}) → ${fn.returns}`, description: doc?.description || fromModeling(name) }
      const target = byName.get(ref)
      if (target) {
        return {
          name: qualified, pkg: FLUENT, kind: target.kind, signature: target.signature.replace(/^\w+/, name),
          description: doc?.description || target.description, sameAs: target.name,
        }
      }
      return { name: qualified, pkg: FLUENT, kind: 'value', signature: name, description: doc?.description ?? '' }
    }
    const m = method(text)
    if (!m) return null
    return {
      name: `${prefix}.${m.name}`, pkg: FLUENT, kind: 'function',
      signature: `${m.name}(${squash(m.params)}) → ${m.returns}`,
      description: doc?.description || fromModeling(m.name),
      ...optionsOf(m.name, m.params),
    }
  }

  const namespace = (name, description, body) => {
    const entries = []
    const list = []
    for (const member of members(body)) {
      const nested = /^([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(member.text)
      if (nested) {
        const inner = member.raw.slice(member.raw.indexOf('{') + 1, member.raw.lastIndexOf('}'))
        const sub = namespace(`${name}.${nested[1]}`, member.doc?.description ?? '', inner)
        list.push({ name: nested[1], summary: firstSentence(sub[0].description) })
        entries.push(...sub)
        continue
      }
      const entry = factory(name, member)
      if (!entry) continue
      list.push({ name: entry.name.slice(name.length + 1), summary: firstSentence(entry.description) })
      entries.push(entry)
    }
    return [{ name, pkg: FLUENT, kind: 'namespace', description, members: list }, ...entries]
  }

  const jfDoc = /\/\*\*([\s\S]*?)\*\/\s*declare const jscadFluent/.exec(index)
  const entries = namespace('jf', jfDoc ? parseBlock(jfDoc[1]).description : '', bodyAfter(index, 'declare const jscadFluent: {'))

  for (const cls of CLASSES) {
    const source = read(join(distDir, 'gen', `${cls}.d.ts`))
    const head = new RegExp(`export declare class ${cls}(?:<[^>]*>)?(?: extends (\\w+)(?:<[^>]*>)?)?[^{]*\\{`).exec(source)
    const methodEntries = members(bodyAfter(source, head[0]))
      .map((m) => m.text)
      .filter((t) => !/^(private|readonly|static|constructor)\b/.test(t))
      .map(method)
      .filter(Boolean)
      .map((m) => ({
        name: `${cls}.${m.name}`, pkg: FLUENT, kind: 'function',
        signature: `${m.name}(${squash(m.params)}) → ${m.returns}`,
        description: fromModeling(m.name),
        ...optionsOf(m.name, m.params),
      }))
    entries.push(
      {
        name: cls, pkg: FLUENT, kind: 'class',
        description: `Methods of a fluent ${cls.replace(/^Fluent/, '')}; each returns a new object, so calls chain.`,
        ...(head[1] ? { extends: head[1] } : {}),
        members: methodEntries.map((e) => ({ name: e.name.slice(cls.length + 1), summary: firstSentence(e.description) })),
      },
      ...methodEntries,
    )
  }
  return entries
}
```

In `packages/agent-loop/api/build-index.js`, import `import { fluentEntries } from './fluent.js'` and change `buildIndex` to:

```js
export const buildIndex = () => {
  const modeling = addPassThrough(modelingEntries(dirname(require.resolve('@jscad/modeling'))))
  const fluent = fluentEntries(dirname(require.resolve('@jbroll/jscad-fluent')), modeling)
  const text = jscadTextEntries(fileURLToPath(new URL('../../jscad-text/src', import.meta.url)))
  return [...modeling, ...fluent, ...text]
}
```

- [ ] **Step 4: Regenerate the index**

Run: `npm run api-index -w @jscadui/agent-loop`
Expected: `api-index: 331 entries`. `api/index.json` is about 129 KB.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/api-index.test.js`
Expected: PASS, 19 tests.

- [ ] **Step 6: Document fluent in the index**

In `packages/agent-loop/README.md` `## API index`, change the first paragraph to name the three sources and the fluent shape:

```markdown
`api/index.json` describes the public API of `@jscad/modeling`, from the
pinned checkout's JSDoc (every namespace but `maths` and `geometries`),
`@jbroll/jscad-fluent`, from its installed `dist/*.d.ts`, and
`@jscadui/jscad-text`, from its JSDoc. It has one entry per namespace, class
or function: `name` (`primitives.roundedCuboid`, `jf.cube`,
`FluentGeom2.extrudeLinear`, `jscadText.text2d`), `pkg`, `kind`, `signature`,
`description`, `example`, and for a function that takes an options object
first, `optionsFirst` and `options` (name, type, default, description). A
fluent entry whose options are a modeling function's names it in `sameAs`
instead of copying them, and the fluent array classes name their base class
in `extends`. `api/optionTable.js` holds only the option names, for the
unknown-option checks.
```

and change "so a `@jscad/modeling` pin update needs" to "so a `@jscad/modeling` pin update or a fluent upgrade needs".

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/api packages/agent-loop/test/api-index.test.js packages/agent-loop/README.md
git commit -m "feat(agent-loop): index jscad-fluent factories and classes from its type declarations"
```

---

### Task 3: `docs` lookup

**Files:**
- Create: `packages/agent-loop/src/editDistance.js`
- Create: `packages/agent-loop/src/docs.js`
- Create: `packages/agent-loop/test/docs.test.js`

**Model:** `haiku` — two files with the complete code and tests below.

**Interfaces:**
- Consumes: `api/index.json` (`Entry[]`) from Tasks 1-2.
- Produces:
  - `editDistance(a: string, b: string) → number`
  - `MAX_ANSWER = 3000`
  - `lookupDocs(index: Entry[], query: string) → { ok: true, text: string } | { ok: false, error: { name: 'QueryError'|'NotFoundError', message: string } }`
  - `docsTool(index: Entry[], query: string) → string` (the text on a hit, the JSON of the error result on a miss)

- [ ] **Step 1: Write the failing test**

Create `packages/agent-loop/test/docs.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { docsTool, lookupDocs, MAX_ANSWER } from '../src/docs.js'
import { editDistance } from '../src/editDistance.js'

const index = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))
const text = (query) => {
  const res = lookupDocs(index, query)
  expect(res.ok).toBe(true)
  return res.text
}

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('roundedcube', 'roundedcuboid')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('docs lookup', () => {
  it('answers a bare name with the modeling entry and lists the others', () => {
    const answer = text('roundedCuboid')
    expect(answer.startsWith('primitives.roundedCuboid (@jscad/modeling)\nroundedCuboid(options) → geom3')).toBe(true)
    expect(answer).toContain('  roundRadius: Number = 0.2 - radius of rounded edges')
    expect(answer).toContain('Example:\n  let mycube = roundedCuboid(')
    expect(answer.endsWith('Also: jf.roundedCuboid')).toBe(true)
  })

  it('answers a qualified name alone', () => {
    expect(text('primitives.roundedCuboid')).not.toContain('Also:')
  })

  it('lists a namespace', () => {
    const answer = text('primitives')
    expect(answer.startsWith('primitives (@jscad/modeling) namespace')).toBe(true)
    expect(answer).toContain('Members:\n  arc - ')
    expect(answer).toContain('  roundedCuboid - Construct an axis-aligned solid cuboid')
  })

  it('gives a fluent factory the modeling options it shares', () => {
    const answer = text('jf.roundedCuboid')
    expect(answer).toContain('Same options as primitives.roundedCuboid.')
    expect(answer).toContain('  roundRadius: Number = 0.2')
  })

  it('answers a fluent method and follows inherited class methods', () => {
    expect(text('FluentGeom2.extrudeLinear')).toContain('Same options as extrusions.extrudeLinear.')
    expect(text('FluentGeom3Array.translate').startsWith('FluentGeometryArray.translate (@jbroll/jscad-fluent)')).toBe(true)
    expect(text('FluentGeom3Array')).toContain('Inherited from FluentGeometryArray:')
  })

  it('lists the candidates when no modeling entry settles a bare name', () => {
    expect(text('append')).toMatch(/^append matches several entries; query one of: FluentGeom2\.append, /)
  })

  it('suggests the closest names on a miss', () => {
    const res = lookupDocs(index, 'roundedCube')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('NotFoundError')
    expect(res.error.message).toMatch(/^no entry roundedCube; closest: primitives\.roundedCuboid, /)
  })

  it('refuses an empty query', () => {
    expect(lookupDocs(index, '  ').error.name).toBe('QueryError')
    expect(lookupDocs(index, undefined).error.name).toBe('QueryError')
  })

  it('caps an answer at 3,000 characters with a note', () => {
    const big = [{
      name: 'big', pkg: 'x', kind: 'namespace', description: '',
      members: Array.from({ length: 500 }, (_, i) => ({ name: `member${i}`, summary: 'a member' })),
    }]
    const res = lookupDocs(big, 'big')
    expect(res.text.length).toBe(MAX_ANSWER)
    expect(res.text.endsWith('\n[truncated: query a qualified name for less]')).toBe(true)
  })

  it('returns text for a hit and error JSON for a miss', () => {
    expect(docsTool(index, 'jf.polygon')).toContain('polygon(points: Point2[]) → FluentGeom2')
    expect(JSON.parse(docsTool(index, 'nope'))).toMatchObject({ ok: false, error: { name: 'NotFoundError' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/docs.test.js`
Expected: FAIL, `../src/docs.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-loop/src/editDistance.js`:

```js
export const editDistance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}
```

Create `packages/agent-loop/src/docs.js`:

```js
import { editDistance } from './editDistance.js'

export const MAX_ANSWER = 3000
const TRUNCATED = '\n[truncated: query a qualified name for less]'

const cap = (text) => (text.length <= MAX_ANSWER ? text : text.slice(0, MAX_ANSWER - TRUNCATED.length) + TRUNCATED)
const lastSegment = (name) => name.slice(name.lastIndexOf('.') + 1)

const optionLine = (o) =>
  `  ${o.name}${o.type ? `: ${o.type}` : ''}${o.default != null ? ` = ${o.default}` : ''}${o.description ? ` - ${o.description}` : ''}`

const memberLine = (m) => `  ${m.name}${m.summary ? ` - ${m.summary}` : ''}`

const renderFunction = (entry, byName) => {
  const lines = [`${entry.name} (${entry.pkg})`, entry.signature]
  if (entry.description) lines.push(entry.description)
  const source = entry.sameAs ? byName.get(entry.sameAs) : entry
  if (entry.sameAs) lines.push(`Same options as ${entry.sameAs}.`)
  if (source?.options?.length) lines.push('Options:', ...source.options.map(optionLine))
  if (entry.example) lines.push('Example:', ...entry.example.split('\n').map((l) => `  ${l}`))
  return lines.join('\n')
}

const renderMembers = (entry, byName) => {
  const lines = [`${entry.name} (${entry.pkg}) ${entry.kind}`]
  if (entry.description) lines.push(entry.description)
  lines.push('Members:', ...entry.members.map(memberLine))
  const parent = entry.extends && byName.get(entry.extends)
  if (parent) lines.push(`Inherited from ${parent.name}:`, ...parent.members.map(memberLine))
  return lines.join('\n')
}

const render = (entry, byName) => (entry.members ? renderMembers(entry, byName) : renderFunction(entry, byName))

// FluentGeom3Array.translate lives on FluentGeometryArray.
const inherited = (index, query) => {
  const dot = query.lastIndexOf('.')
  const owner = dot === -1 ? null : index.find((e) => e.name === query.slice(0, dot) && e.extends)
  return owner ? index.filter((e) => e.name === `${owner.extends}.${query.slice(dot + 1)}`) : []
}

const matches = (index, query) => {
  const exact = index.filter((e) => e.name === query)
  if (exact.length) return exact
  const parent = inherited(index, query)
  if (parent.length) return parent
  const suffix = index.filter((e) => e.name.endsWith(`.${query}`))
  if (suffix.length) return suffix
  const lower = query.toLowerCase()
  return index.filter((e) => e.name.toLowerCase() === lower || e.name.toLowerCase().endsWith(`.${lower}`))
}

const closest = (index, query) => {
  const q = query.toLowerCase()
  return index
    .map((e, i) => ({ name: e.name, i, d: Math.min(editDistance(q, e.name.toLowerCase()), editDistance(q, lastSegment(e.name).toLowerCase())) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, 3)
    .map((c) => c.name)
}

export const lookupDocs = (index, query) => {
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) return { ok: false, error: { name: 'QueryError', message: 'docs needs a query: a function, class or namespace name' } }
  const hits = matches(index, q)
  if (!hits.length) return { ok: false, error: { name: 'NotFoundError', message: `no entry ${q}; closest: ${closest(index, q).join(', ')}` } }
  const byName = new Map(index.map((e) => [e.name, e]))
  if (hits.length === 1) return { ok: true, text: cap(render(hits[0], byName)) }
  const modeling = hits.filter((e) => e.pkg === '@jscad/modeling')
  if (modeling.length === 1) {
    const others = hits.filter((e) => e !== modeling[0]).map((e) => e.name)
    return { ok: true, text: cap(`${render(modeling[0], byName)}\nAlso: ${others.join(', ')}`) }
  }
  return { ok: true, text: cap(`${q} matches several entries; query one of: ${hits.map((e) => e.name).join(', ')}`) }
}

export const docsTool = (index, query) => {
  const result = lookupDocs(index, query)
  return result.ok ? result.text : JSON.stringify(result)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/docs.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/docs.js packages/agent-loop/src/editDistance.js packages/agent-loop/test/docs.test.js
git commit -m "feat(agent-loop): answer API lookups from the index"
```

---

### Task 4: `docs` tool in the app, the server copy, the eval and the prompt

**Files:**
- Modify: `packages/agent-loop/src/tools.js` (append to `TOOLS`, line 77)
- Modify: `packages/agent-loop/test/tools.test.js:6-8`
- Modify: `packages/agent-loop/index.js` (export `docsTool`, `lookupDocs`)
- Modify: `apps/jscad-web/server/src/agent/tools.ts` (append to `TOOLS`; header comment lines 3-6)
- Modify: `apps/jscad-web/src/aiBridge.js:15-31`
- Modify: `apps/jscad-web/test/aiBridge.test.js` (new test)
- Modify: `apps/jscad-web/main.js` (imports near line 47; `aiDeps`, lines 824-852)
- Modify: `packages/agent-loop/eval/backend.js` (`requestTool`, lines 88-111)
- Modify: `packages/agent-loop/eval/backend.test.js` (new test)
- Modify: `packages/agent-loop/prompt.md` (Tool policy, line 47-48)
- Modify: `packages/agent-loop/test/prompt.test.js` (new test)
- Modify: `apps/jscad-web/docs/architecture.md` (tool table, line 716-721)
- Modify: `packages/agent-loop/README.md` (new `## docs tool` section after `## API index`)

**Model:** `sonnet` — small edits across seven modules that must agree on one name and result shape.

**Interfaces:**
- Consumes: `docsTool(index, query) → string` (Task 3); `api/index.json`.
- Produces: tool `docs` with input `{ query: string }`; `handleToolRequest('docs', { query }, deps)` calls `deps.docs(query)` and returns its string; eval backend `requestTool('docs', { query })` returns the same string.

- [ ] **Step 1: Write the failing tests**

In `packages/agent-loop/test/tools.test.js`, replace the first test's name and expected list:

```js
  it('exposes the seven browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['eval', 'params', 'measure', 'check', 'export', 'writeModel', 'docs'])
```

Append to `apps/jscad-web/test/aiBridge.test.js`, inside `describe('local tool bridge', ...)`:

```js
  it('routes docs with the query and returns its text', async () => {
    const d = deps({ docs: vi.fn(() => 'primitives.cube (@jscad/modeling)') })
    const res = await handleToolRequest('docs', { query: 'cube' }, d)
    expect(d.docs).toHaveBeenCalledWith('cube')
    expect(res).toBe('primitives.cube (@jscad/modeling)')
  })
```

Append to `packages/agent-loop/eval/backend.test.js`, inside `describe('eval backend', ...)`:

```js
  it('answers docs from the API index', async () => {
    const backend = createEvalBackend()
    expect(await backend.requestTool('docs', { query: 'roundedCuboid' })).toContain('roundRadius: Number = 0.2')
    expect(JSON.parse(await backend.requestTool('docs', { query: 'roundedCube' })).error.name).toBe('NotFoundError')
  })
```

Append to `packages/agent-loop/test/prompt.test.js`, inside `describe('system prompt', ...)`:

```js
  it('tells the model to look up options with docs', () => {
    expect(SYSTEM_PROMPT).toMatch(/- Look up an unfamiliar function's options and defaults with `docs` before\s+using it\./)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/agent-loop test/tools.test.js test/prompt.test.js eval/backend.test.js`
Expected: FAIL: the tool list lacks `docs`, the prompt lacks the line, and `docs` is an unknown tool.

Run: `npx vitest run --root apps/jscad-web test/aiBridge.test.js`
Expected: FAIL: `docs` returns an `UnknownToolError` result.

- [ ] **Step 3: Add the tool**

Append to `TOOLS` in `packages/agent-loop/src/tools.js`, after `writeModel`:

```js
  {
    name: 'docs',
    description:
      "Look up a JSCAD function's signature, options and defaults, or list a namespace. Query a name (roundedCuboid, primitives.roundedCuboid, jf.polygon, FluentGeom2.extrudeLinear) or a namespace (primitives, booleans, FluentGeom2).",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A function, class or namespace name' } },
      required: ['query'],
    },
  },
```

Append the same object to `TOOLS` in `apps/jscad-web/server/src/agent/tools.ts`, and change its header comment to:

```ts
// The tools the agent may ask the browser to run. Every one executes in the user's browser: eval,
// params, measure, check and export through the compute frame, writeModel against the project
// storage, and docs from the page's API index. `view` is not offered here; see
// docs/architecture.md's tool table. The server only relays inputs and results.
```

In `packages/agent-loop/index.js`, add:

```js
export { docsTool, lookupDocs } from './src/docs.js'
```

- [ ] **Step 4: Route it in the page**

In `apps/jscad-web/src/aiBridge.js`, add `docs:Function` to the `deps` JSDoc type and this line after the `view` route:

```js
    if (name === 'docs') return deps.docs(args.query)
```

In `apps/jscad-web/main.js`, add beside the other imports:

```js
import { docsTool } from '@jscadui/agent-loop'
import apiIndex from '@jscadui/agent-loop/api/index.json'
```

and add to `aiDeps` after `evaluate`:

```js
  docs: (query) => docsTool(apiIndex, query),
```

esbuild loads `.json` with its default JSON loader; `build.js` overrides only `.js`, `.jsx` and `.example.js`.

- [ ] **Step 5: Route it in the eval backend**

In `packages/agent-loop/eval/backend.js`, add imports:

```js
import { readFileSync } from 'node:fs'
import { docsTool } from '../src/docs.js'
```

below the imports:

```js
const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))
```

and in `requestTool`, after the `params` line:

```js
      if (name === 'docs') return docsTool(API_INDEX, args.query)
```

- [ ] **Step 6: Add the prompt line**

In `packages/agent-loop/prompt.md` Tool policy, after the bullet ending "persist with `writeModel`.", add:

```markdown
- Look up an unfamiliar function's options and defaults with `docs` before
  using it.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --root packages/agent-loop test/tools.test.js test/prompt.test.js eval/backend.test.js`
Expected: PASS.

Run: `npx vitest run --root apps/jscad-web test/aiBridge.test.js`
Expected: PASS.

- [ ] **Step 8: Document the tool**

In `apps/jscad-web/docs/architecture.md`, add a row to the tool table:

```markdown
| `docs` | page: `docsTool` over `@jscadui/agent-loop/api/index.json`, no frame round trip |
```

In `packages/agent-loop/README.md`, after `## API index`, add:

```markdown
## docs tool

`docs({ query })` answers from the index with `docsTool(index, query)`
(`src/docs.js`), the same pure function in the page and in the eval. A query
is a qualified name (`primitives.roundedCuboid`, `jf.polygon`,
`FluentGeom2.extrudeLinear`), a bare name (`roundedCuboid`) or a namespace or
class (`primitives`, `FluentGeom2`). A function answers with its signature,
description, options with type and default, and example; a fluent entry adds
`Same options as <modeling name>`. A namespace or class answers with its
members and one-line summaries, and a class method missing from an array
class is looked up on the class it extends. A bare name that matches in
several packages answers the `@jscad/modeling` entry with the others on an
`Also:` line, or lists the candidates. A miss is a failed result,
`{ ok: false, error: { name: 'NotFoundError', message: 'no entry <query>; closest: a, b, c' } }`,
with the three nearest names by edit distance. Answers are cut at 3,000
characters.
```

- [ ] **Step 9: Commit**

```bash
git add packages/agent-loop/src/tools.js packages/agent-loop/test/tools.test.js packages/agent-loop/index.js apps/jscad-web/server/src/agent/tools.ts apps/jscad-web/src/aiBridge.js apps/jscad-web/test/aiBridge.test.js apps/jscad-web/main.js packages/agent-loop/eval/backend.js packages/agent-loop/eval/backend.test.js packages/agent-loop/prompt.md packages/agent-loop/test/prompt.test.js apps/jscad-web/docs/architecture.md packages/agent-loop/README.md
git commit -m "feat(agent-loop): offer a docs tool in the chat and the eval"
```

---

### Task 5: Option checks and the warning collector

**Files:**
- Create: `packages/agent-loop/src/optionChecks.js`
- Create: `packages/agent-loop/test/optionChecks.test.js`

**Model:** `haiku` — two files with the complete code and tests below.

**Interfaces:**
- Consumes: `editDistance` (Task 3); `OPTION_TABLES` shape (Task 1).
- Produces:
  - `withOptionChecks(api: object, table: { prefix: string, options: Record<string, string[]> } | undefined, warn: (w: {fn, option, suggestions}) => void) → object`: a copy with wrapped functions; `api` itself when `table` is missing.
  - `suggestOptions(option: string, known: string[]) → string[]`
  - `createWarningCollector(cap = MAX_WARNINGS) → { warn(w), reset(), list() → Warning[] }`
  - `MAX_WARNINGS = 20`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-loop/test/optionChecks.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { OPTION_TABLES } from '../api/optionTable.js'
import { createWarningCollector, MAX_WARNINGS, suggestOptions, withOptionChecks } from '../src/optionChecks.js'

const table = {
  prefix: '',
  options: { 'primitives.roundedCuboid': ['center', 'roundRadius', 'segments', 'size'], 'primitives.missing': ['size'] },
}

const fakeApi = () => {
  const roundedCuboid = vi.fn((options) => ({ made: options }))
  const api = { primitives: { roundedCuboid }, transforms: { translate: vi.fn() } }
  api.default = api
  return { api, roundedCuboid }
}

describe('withOptionChecks', () => {
  it('warns on an unknown key and still calls the original with the same arguments', () => {
    const { api, roundedCuboid } = fakeApi()
    const warn = vi.fn()
    const options = { size: [30, 20, 10], radius: 2 }
    const extra = { other: 1 }
    const result = withOptionChecks(api, table, warn).primitives.roundedCuboid(options, extra)
    expect(warn).toHaveBeenCalledWith({ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] })
    expect(roundedCuboid.mock.calls[0][0]).toBe(options)
    expect(roundedCuboid.mock.calls[0][1]).toBe(extra)
    expect(result).toEqual({ made: options })
  })

  it('does not warn on known keys', () => {
    const warn = vi.fn()
    withOptionChecks(fakeApi().api, table, warn).primitives.roundedCuboid({ size: [1, 1, 1], roundRadius: 0.1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores a first argument that is not a plain object', () => {
    const warn = vi.fn()
    const wrapped = withOptionChecks(fakeApi().api, table, warn)
    class Geometry { constructor() { this.polygons = [] } }
    wrapped.primitives.roundedCuboid([1, 2])
    wrapped.primitives.roundedCuboid(5)
    wrapped.primitives.roundedCuboid(new Geometry())
    wrapped.primitives.roundedCuboid()
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips table entries the api does not have', () => {
    const wrapped = withOptionChecks(fakeApi().api, table, vi.fn())
    expect(Object.keys(wrapped.primitives)).toEqual(['roundedCuboid'])
  })

  it('copies the namespaces it wraps and never mutates the api', () => {
    const { api, roundedCuboid } = fakeApi()
    const primitives = api.primitives
    const wrapped = withOptionChecks(api, table, vi.fn())
    expect(api.primitives).toBe(primitives)
    expect(api.primitives.roundedCuboid).toBe(roundedCuboid)
    expect(wrapped.primitives).not.toBe(primitives)
    expect(wrapped.transforms).toBe(api.transforms)
    expect(wrapped.default).toBe(wrapped)
  })

  it('names fluent functions with the table prefix', () => {
    const warn = vi.fn()
    withOptionChecks({ cube: () => 'c' }, { prefix: 'jf.', options: { cube: ['center', 'size'] } }, warn).cube({ sise: 1 })
    expect(warn).toHaveBeenCalledWith({ fn: 'jf.cube', option: 'sise', suggestions: ['size'] })
  })

  it('wraps accessor exports that cannot be redefined in place', () => {
    const fn = vi.fn()
    const ns = {}
    Object.defineProperty(ns, 'roundedCuboid', { get: () => fn, enumerable: true })
    const api = {}
    Object.defineProperty(api, 'primitives', { get: () => ns, enumerable: true })
    Object.defineProperty(api, '__esModule', { value: true })
    const warn = vi.fn()
    const wrapped = withOptionChecks(api, table, warn)
    wrapped.primitives.roundedCuboid({ radius: 1 })
    expect(warn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledOnce()
    expect(wrapped.__esModule).toBe(true)
  })

  it('returns the api unchanged without a table', () => {
    const { api } = fakeApi()
    expect(withOptionChecks(api, undefined, vi.fn())).toBe(api)
  })

  it('checks the real roundedCuboid entry', () => {
    const warn = vi.fn()
    const api = { primitives: { roundedCuboid: () => null } }
    withOptionChecks(api, OPTION_TABLES['@jscad/modeling'], warn).primitives.roundedCuboid({ size: [3, 2, 1], radius: 2 })
    expect(warn).toHaveBeenCalledWith({ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] })
  })
})

describe('suggestOptions', () => {
  it('suggests near spellings and names that contain the key', () => {
    expect(suggestOptions('hieght', ['height', 'twistAngle'])).toEqual(['height'])
    expect(suggestOptions('radius', ['center', 'roundRadius', 'size'])).toEqual(['roundRadius'])
    expect(suggestOptions('xyzzy', ['center', 'size'])).toEqual([])
  })
})

describe('createWarningCollector', () => {
  it('keeps each fn and option once', () => {
    const c = createWarningCollector()
    c.warn({ fn: 'a', option: 'x', suggestions: [] })
    c.warn({ fn: 'a', option: 'x', suggestions: [] })
    c.warn({ fn: 'b', option: 'x', suggestions: [] })
    expect(c.list().map((w) => w.fn)).toEqual(['a', 'b'])
  })

  it('stops at the cap and starts over on reset', () => {
    const c = createWarningCollector()
    for (let i = 0; i < MAX_WARNINGS + 5; i += 1) c.warn({ fn: 'f', option: `o${i}`, suggestions: [] })
    expect(c.list()).toHaveLength(20)
    c.reset()
    expect(c.list()).toEqual([])
  })

  it('hands out a copy of its list', () => {
    const c = createWarningCollector()
    c.list().push({})
    expect(c.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/agent-loop test/optionChecks.test.js`
Expected: FAIL, `../src/optionChecks.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-loop/src/optionChecks.js`:

```js
import { editDistance } from './editDistance.js'

export const MAX_WARNINGS = 20

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Containment catches radius → roundRadius, which is 5 edits apart.
export const suggestOptions = (option, known) => {
  const lower = option.toLowerCase()
  return known
    .map((name) => ({ name, d: editDistance(lower, name.toLowerCase()) }))
    .filter(({ name, d }) => d <= 3 || name.toLowerCase().includes(lower) || (name.length >= 3 && lower.includes(name.toLowerCase())))
    .sort((a, b) => a.d - b.d)
    .map(({ name }) => name)
}

const checked = (fnName, fn, known, warn) => {
  const allowed = new Set(known)
  return function (...args) {
    const [first] = args
    if (isPlainObject(first)) {
      for (const option of Object.keys(first)) {
        if (!allowed.has(option)) warn({ fn: fnName, option, suggestions: suggestOptions(option, known) })
      }
    }
    return fn.apply(this, args)
  }
}

// esbuild's CJS namespaces export non-configurable getters, so the copy
// re-declares every property configurable before any is replaced.
const copyOf = (node) => {
  const copy = Object.create(Object.getPrototypeOf(node))
  for (const key of Reflect.ownKeys(node)) {
    Object.defineProperty(copy, key, { ...Object.getOwnPropertyDescriptor(node, key), configurable: true })
  }
  return copy
}

const setValue = (target, key, value) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })

export const withOptionChecks = (api, table, warn) => {
  if (!table || api === null || typeof api !== 'object') return api
  const copies = new Map([[api, copyOf(api)]])
  const root = copies.get(api)
  for (const [path, known] of Object.entries(table.options)) {
    const keys = path.split('.')
    const last = keys.pop()
    let original = api
    let copy = root
    for (const key of keys) {
      const child = original?.[key]
      if (child === null || typeof child !== 'object') {
        original = null
        break
      }
      if (!copies.has(child)) copies.set(child, copyOf(child))
      setValue(copy, key, copies.get(child))
      original = child
      copy = copies.get(child)
    }
    if (typeof original?.[last] === 'function') setValue(copy, last, checked(table.prefix + path, original[last], known, warn))
  }
  if (api.default === api) setValue(root, 'default', root)
  return root
}

export const createWarningCollector = (cap = MAX_WARNINGS) => {
  let seen = new Set()
  let list = []
  return {
    warn: (warning) => {
      const key = `${warning.fn}\u0000${warning.option}`
      if (seen.has(key) || list.length >= cap) return
      seen.add(key)
      list.push(warning)
    },
    reset: () => {
      seen = new Set()
      list = []
    },
    list: () => [...list],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/agent-loop test/optionChecks.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/optionChecks.js packages/agent-loop/test/optionChecks.test.js
git commit -m "feat(agent-loop): wrap options-first functions to report unknown keys"
```

---

### Task 6: `setUserModuleWrapper` in `@jscadui/require`

**Files:**
- Modify: `packages/require/src/require.js` (new exports above `require`, line 63; capture the caller's base at the top of `require`; the `return exports` at line 228)
- Create: `packages/require/test/userModuleWrapper.test.js`
- Modify: `packages/require/README.md` (new section)

**Model:** `sonnet` — a small change in a subtle loader: both the load and cache-hit paths leave through one `return`, and the jsdelivr branch reassigns `base`.

**Interfaces:**
- Consumes: nothing.
- Produces: `setUserModuleWrapper(fn: ((name: string, exports: object) => object) | null) → void`, exported from `@jscadui/require` (via `index.js`'s `export *`).

- [ ] **Step 1: Write the failing test**

Create `packages/require/test/userModuleWrapper.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAllCaches, require as jscadRequire, requireCache, setUserModuleWrapper } from '../src/require.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'

const ROOT = 'http://project.local/'
const MODELING = 'http://bundles.test/modeling.js'
const FLUENT = 'http://bundles.test/fluent.js'
const files = {
  [MODELING]: 'module.exports = { primitives: { cube: () => "cube" } }',
  [FLUENT]: 'module.exports = { modeling: require("@jscad/modeling") }',
}
const readFile = (path) => {
  if (path in files) return files[path]
  throw new Error(`not found ${path}`)
}
const wrap = (name, exports) => ({ ...exports, wrappedAs: name })
const project = (url, script) => jscadRequire({ url, script }, null, readFile, ROOT, ROOT)

beforeEach(() => {
  requireCache.bundleAlias['@jscad/modeling'] = MODELING
  requireCache.bundleAlias['@jbroll/jscad-fluent'] = FLUENT
  setUserModuleWrapper(wrap)
})

afterEach(() => {
  delete requireCache.bundleAlias['@jscad/modeling']
  delete requireCache.bundleAlias['@jbroll/jscad-fluent']
  setUserModuleWrapper(null)
  clearAllCaches()
  moduleResolver.clearCache()
})

describe('user module wrapper', () => {
  it('gives a project file the wrapped copy, the same one on a cache hit', () => {
    const a = project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }')
    const b = project(`${ROOT}b.js`, 'module.exports = { m: require("@jscad/modeling") }')
    expect(a.m.wrappedAs).toBe('@jscad/modeling')
    expect(b.m).toBe(a.m)
  })

  it('gives a library bundle the real object', () => {
    const { fluent } = project(`${ROOT}c.js`, 'module.exports = { fluent: require("@jbroll/jscad-fluent") }')
    expect(fluent.wrappedAs).toBe('@jbroll/jscad-fluent')
    expect(fluent.modeling.wrappedAs).toBeUndefined()
    expect(fluent.modeling.primitives.cube()).toBe('cube')
  })

  it('gives a .scad caller the real object', () => {
    const { m } = project(`${ROOT}part.scad`, 'module.exports = { m: require("@jscad/modeling") }')
    expect(m.wrappedAs).toBeUndefined()
  })

  it('gives a base-less caller the real object, which is what the cache holds', () => {
    project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }')
    const real = jscadRequire('@jscad/modeling', null, readFile)
    expect(real.wrappedAs).toBeUndefined()
    expect(real.primitives.cube()).toBe('cube')
  })

  it('passes everything through with no wrapper registered', () => {
    setUserModuleWrapper(null)
    expect(project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }').m.wrappedAs).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/require test/userModuleWrapper.test.js`
Expected: FAIL, `setUserModuleWrapper is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/require/src/require.js`, add above the `@typedef SourceWithUrl` block:

```js
const USER_MODULES = new Set(['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-fluent'])
let userModuleWrapper = null
let wrappedModules = new WeakMap()

/**
 * Registers the function that gives project files their own copy of the
 * modeling and fluent exports. Pass null to turn it off.
 * @param {((name: string, exports: object) => object) | null} fn
 */
export const setUserModuleWrapper = (fn) => {
  userModuleWrapper = fn
  wrappedModules = new WeakMap()
}

// Library bundles, transpiled .scad and base-less worker lookups share the
// cached exports and must keep calling the real functions.
const forCaller = (name, exports, base, root) => {
  if (!userModuleWrapper || !USER_MODULES.has(name) || exports === null || typeof exports !== 'object') return exports
  if (typeof base !== 'string' || typeof root !== 'string' || !root || !base.startsWith(root) || base.endsWith('.scad')) return exports
  let wrapped = wrappedModules.get(exports)
  if (!wrapped) {
    wrapped = userModuleWrapper(name, exports)
    wrappedModules.set(exports, wrapped)
  }
  return wrapped
}
```

At the top of `require`, before `let source`, add:

```js
  const callerBase = base
```

and replace `    return exports // require returns object exported by module` with:

```js
    return forCaller(url, exports, callerBase, root)
```

`callerBase` matters because the jsdelivr redirect branch reassigns `base`.

- [ ] **Step 4: Run the require suite**

Run: `npx vitest run --root packages/require`
Expected: PASS, every file including the 5 new tests.

- [ ] **Step 5: Document it**

In `packages/require/README.md`, after the `## Cycles` section, add:

```markdown
## Wrapped modules for model code

`setUserModuleWrapper(fn)` registers `fn(name, exports)`, called when a
project file requires `@jscad/modeling`, `@jscad/modeling-for-anchors` or
`@jbroll/jscad-fluent`. A caller is a project file when its URL is under
`root` and is not a `.scad` file. It gets `fn`'s result, memoized per exports
object. The cache, library bundles that require modeling themselves,
transpiled OpenSCAD and base-less lookups get the real exports.
`setUserModuleWrapper(null)` turns it off. The compute frame registers the
unknown-option checks this way (`apps/jscad-web/src_frame/optionWarnings.js`).
```

- [ ] **Step 6: Commit**

```bash
git add packages/require/src/require.js packages/require/test/userModuleWrapper.test.js packages/require/README.md
git commit -m "feat(require): hand project files a wrapped copy of modeling and fluent"
```

---

### Task 7: Warnings from frame runs

**Files:**
- Modify: `packages/worker/worker.js` (new export after `setScriptLockTimeout`, line 99; `jscadMain` result, line 379-381; `jscadScript` reset, after line 456)
- Create: `packages/worker/worker.warnings.test.js`
- Create: `apps/jscad-web/src_frame/optionWarnings.js`
- Create: `apps/jscad-web/test/option-warnings.test.js`
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js` (imports lines 9-19; register before `initWorker`, line 134)
- Modify: `apps/jscad-web/e2e/frame.spec.js` (new tests after the manifold test, line 330)
- Modify: `apps/jscad-web/docs/architecture.md` (new `### Unknown-option warnings` under `## Agent loop`, before `### Chat feedback loop`)

**Model:** `sonnet` — worker, frame and e2e must agree; the e2e runs on simple-ci.

**Interfaces:**
- Consumes: `setUserModuleWrapper` (Task 6); `withOptionChecks`, `createWarningCollector` (Task 5); `OPTION_TABLES` (Tasks 1-2).
- Produces:
  - `setRunWarnings(collector: { reset(): void, list(): Warning[] } | null)` exported from `@jscadui/worker`.
  - `jscadMain` and `jscadScript` results carry `warnings: Warning[]` when non-empty.
  - `installOptionWarnings({ setUserModuleWrapper, setRunWarnings }) → collector` in `src_frame/optionWarnings.js`.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/worker/worker.warnings.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadScript, setRunWarnings } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

const collector = () => {
  const order = []
  let list = []
  return {
    order,
    reset: () => {
      order.push('reset')
      list = []
    },
    list: () => list,
    warn: (w) => list.push(w),
  }
}

describe('run warnings', () => {
  afterEach(() => {
    setRunWarnings(null)
    delete globalThis.__runWarnings
    workerState.main = undefined
  })

  it('clears the collector before the model loads and returns what the run reported', async () => {
    const c = collector()
    setRunWarnings(c)
    globalThis.__runWarnings = c
    c.warn({ fn: 'stale', option: 'x', suggestions: [] })
    const script = [
      "globalThis.__runWarnings.order.push('top')",
      "globalThis.__runWarnings.warn({ fn: 'primitives.cube', option: 'sise', suggestions: ['size'] })",
      'module.exports = { main: () => [] }',
    ].join('\n')

    const result = await jscadScript({ script, url: 'http://project.local/warn.js' })

    expect(c.order).toEqual(['reset', 'top'])
    expect(result.warnings).toEqual([{ fn: 'primitives.cube', option: 'sise', suggestions: ['size'] }])
  })

  it('leaves warnings off a clean run', async () => {
    setRunWarnings(collector())
    const result = await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/clean.js' })
    expect(result).not.toHaveProperty('warnings')
  })
})
```

Create `apps/jscad-web/test/option-warnings.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { installOptionWarnings } from '../src_frame/optionWarnings.js'

const install = () => {
  let wrapper
  let collector
  installOptionWarnings({
    setUserModuleWrapper: (fn) => { wrapper = fn },
    setRunWarnings: (c) => { collector = c },
  })
  return { wrapper, collector }
}

describe('frame option warnings', () => {
  it('checks modeling and the anchors alias against the modeling table', () => {
    const { wrapper, collector } = install()
    const roundedCuboid = vi.fn(() => 'solid')
    const api = { primitives: { roundedCuboid } }
    expect(wrapper('@jscad/modeling', api).primitives.roundedCuboid({ radius: 2 })).toBe('solid')
    wrapper('@jscad/modeling-for-anchors', api).primitives.roundedCuboid({ radius: 2 })
    expect(collector.list()).toEqual([{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }])
  })

  it('checks fluent factories under jf. names', () => {
    const { wrapper, collector } = install()
    wrapper('@jbroll/jscad-fluent', { cube: () => 'c' }).cube({ sise: 1 })
    expect(collector.list()).toEqual([{ fn: 'jf.cube', option: 'sise', suggestions: ['size'] }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/worker worker.warnings.test.js`
Expected: FAIL, `setRunWarnings is not a function`.

Run: `npx vitest run --root apps/jscad-web test/option-warnings.test.js`
Expected: FAIL, `../src_frame/optionWarnings.js` does not exist.

- [ ] **Step 3: Collect in the worker**

In `packages/worker/worker.js`, after `setScriptLockTimeout`, add:

```js
/** @type {{reset: () => void, list: () => Array<{fn: string, option: string, suggestions: string[]}>} | null} */
let runWarnings = null

/**
 * The collector model code reports to; jscadScript clears it and jscadMain
 * returns what it holds.
 * @param {{reset: () => void, list: () => Array<object>} | null} collector
 */
export const setRunWarnings = (collector) => {
  runWarnings = collector
}
```

In `jscadMain`, after `if (globalThis.__allWasmTrap) result.trapped = true`, add:

```js
    const warnings = runWarnings?.list() ?? []
    if (warnings.length) result.warnings = warnings
```

In `jscadScript`, after `workerState.lastRunStreamed = false`, add:

```js
    // Top-level model code runs during the require below.
    runWarnings?.reset()
```

- [ ] **Step 4: Register in the frame worker**

Create `apps/jscad-web/src_frame/optionWarnings.js`:

```js
import { createWarningCollector, withOptionChecks } from '@jscadui/agent-loop/src/optionChecks.js'
import { OPTION_TABLES } from '@jscadui/agent-loop/api/optionTable.js'

const tableFor = (name) => OPTION_TABLES[name === '@jscad/modeling-for-anchors' ? '@jscad/modeling' : name]

export const installOptionWarnings = ({ setUserModuleWrapper, setRunWarnings }) => {
  const warnings = createWarningCollector()
  setRunWarnings(warnings)
  setUserModuleWrapper((name, api) => withOptionChecks(api, tableFor(name), warnings.warn))
  return warnings
}
```

In `apps/jscad-web/src_frame/bundle.frame-worker.js`, add `setRunWarnings` to the `@jscadui/worker` import, `setUserModuleWrapper` to the `@jscadui/require` import, add `import { installOptionWarnings } from './optionWarnings.js'`, and before `initWorker({`:

```js
installOptionWarnings({ setUserModuleWrapper, setRunWarnings })
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `npx vitest run --root packages/worker`
Expected: PASS, every file including the 2 new tests.

Run: `npx vitest run --root apps/jscad-web test/option-warnings.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add the frame e2e tests**

In `apps/jscad-web/e2e/frame.spec.js`, after the `'a manifold model loads its wasm and returns geometry'` test, add:

```js
const MISSPELLED = project(
  `const { roundedCuboid } = require('@jscad/modeling').primitives\n` +
  `const main = () => roundedCuboid({ size: [30, 20, 10], radius: 2 })\n` +
  `module.exports = { main }\n`,
)

const FLUENT_CLEAN = project(
  `const jf = require('@jbroll/jscad-fluent')\n` +
  `const main = () => jf.circle({ radius: 5 }).extrudeLinear({ height: 10 }).translate([1, 2, 3])\n` +
  `module.exports = { main }\n`,
)

for (const engine of ['jscad', 'manifold']) {
  test(`a misspelled option comes back as a warning on the ${engine} engine`, async ({ page }) => {
    await gotoHost(page)
    const res = await load(page, MISSPELLED, { engine, timeoutMs: 60000 })
    expect(res.ok).toBe(true)
    expect(res.result.warnings).toEqual([{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }])
  })

  test(`fluent's own modeling calls raise no warning on the ${engine} engine`, async ({ page }) => {
    await gotoHost(page)
    const res = await load(page, FLUENT_CLEAN, { engine, timeoutMs: 60000 })
    expect(res.ok).toBe(true)
    expect(res.result.warnings).toBeUndefined()
  })
}
```

- [ ] **Step 7: Run the web suite on simple-ci**

Run from the repo root: `../simple-ci/sci push jscadui/web`
Expected: prints the job id. Read it from the output.

Run under Bash `run_in_background`: `../simple-ci/sci wait <job>`
Expected when it exits: the job passes, including the four new `frame.spec.js` tests. On a failure, read the log it names, fix, and push again. Do not run Playwright locally.

- [ ] **Step 8: Document the checks**

In `apps/jscad-web/docs/architecture.md`, before `### Chat feedback loop`, add:

```markdown
### Unknown-option warnings

A modeling function ignores an option it does not know, so
`roundedCuboid({ radius: 2 })` keeps the 0.2 default without a word. Model
code gets a copy of `@jscad/modeling` and `@jbroll/jscad-fluent` in which
every function that takes an options object first
(`packages/agent-loop/api/optionTable.js`, generated with the API index)
reports each unknown key as `{ fn, option, suggestions }` and then calls the
real function with the same arguments. `@jscadui/require` hands the copy out
(`setUserModuleWrapper`), and the frame worker registers it through
`src_frame/optionWarnings.js`. The require cache holds one exports object per
bundle URL, shared by the fluent, model-tools and anchors bundles and the
OpenSCAD runtime, so only a caller whose URL is a project file under `root`,
and not a `.scad` file, gets the copy; the libraries' internal calls would
otherwise warn about options the user never wrote. The worker's collector is
cleared at the start of each `jscadScript`, since top-level model code runs
during the require, keeps each `fn`+`option` once, holds at most 20, and
`jscadMain` returns them as `warnings`. Fluent class methods
(`.extrudeLinear(...)`) are not checked: their prototypes are shared with
library code.
```

- [ ] **Step 9: Commit**

```bash
git add packages/worker/worker.js packages/worker/worker.warnings.test.js apps/jscad-web/src_frame/optionWarnings.js apps/jscad-web/test/option-warnings.test.js apps/jscad-web/src_frame/bundle.frame-worker.js apps/jscad-web/e2e/frame.spec.js apps/jscad-web/docs/architecture.md
git commit -m "feat(frame): return unknown-option warnings from model runs"
```

---

### Task 8: Warnings through grid runs and the chat's `eval`

**Files:**
- Modify: `apps/jscad-web/src_frame/gridRun.js` (import; `merged`, lines 127-150)
- Modify: `apps/jscad-web/test/frame-host.test.js` (new test in the grid-run `describe`, after `'merges the params every member discovered into the answer to a load'`, line 1561)
- Modify: `apps/jscad-web/src/aiEvaluate.js:37`
- Modify: `apps/jscad-web/test/caps.test.js` (new test in `describe('agent evaluate')`)
- Modify: `apps/jscad-web/docs/architecture.md` (`### Unknown-option warnings`)

**Model:** `sonnet` — two small changes, but the grid merge sits in the run bookkeeping and its test needs the file's grid helpers.

**Interfaces:**
- Consumes: `createWarningCollector` (Task 5); worker results with `warnings` (Task 7).
- Produces: a grid run's merged answer carries `warnings` (every member's, deduplicated, capped) when non-empty; the chat's `eval` result is `{ entityCount, warnings? }`.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/test/frame-host.test.js`, after the test `'merges the params every member discovered into the answer to a load'`, add:

```js
  it('merges the warnings every member reported, once each', () => {
    const { workers, posted, send } = gridRun({ poolSize: 2 })
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    const radius = { fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }
    const sise = { fn: 'primitives.cube', option: 'sise', suggestions: ['size'] }
    answerLastOf(workers[0], 'jscadScript', { def: [], params: {}, entities: [], streamed: true, runId: 9, warnings: [radius] })
    answerLastOf(workers[1], 'jscadScript', { def: [], params: {}, entities: [], warnings: [radius, sise] })

    expect(posted.find((m) => m.id === 5).params.warnings).toEqual([radius, sise])
  })
```

In `apps/jscad-web/test/caps.test.js`, inside `describe('agent evaluate', ...)`, add:

```js
  it('passes the run warnings on to the agent', async () => {
    const warnings = [{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }]
    const evaluate = createEvaluate({
      jscadSetFiles: async () => {},
      jscadScript: async () => ({ entities: [smallEntity()], warnings }),
    }, () => {})

    expect(await evaluate('module.exports = { main: () => [] }')).toEqual({ entityCount: 1, warnings })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root apps/jscad-web test/frame-host.test.js test/caps.test.js`
Expected: FAIL: the grid answer carries only the primary's `[radius]`, and the eval result has no `warnings`.

- [ ] **Step 3: Merge in grid runs**

In `apps/jscad-web/src_frame/gridRun.js`, add:

```js
import { createWarningCollector } from '@jscadui/agent-loop/src/optionChecks.js'
```

and above `const merged = (run) => {`:

```js
  const mergedWarnings = (answers) => {
    const warnings = createWarningCollector()
    for (const data of answers) for (const warning of data.params?.warnings ?? []) warnings.warn(warning)
    return warnings.list()
  }
```

In `merged`, replace the destructure and return with:

```js
    const { trapped: _trapped, warnings: _warnings, ...first } = done[0].params ?? {}
    const params = mergeProxyStates(done.map((data) => data.params), run.method === 'jscadScript')
    const warnings = mergedWarnings(done)
    return {
      method: RESPONSE,
      id: run.appId,
      params: { ...first, ...params, ...(warnings.length ? { warnings } : {}), entities: [], streamed: true, runId: run.runId, lost },
    }
```

- [ ] **Step 4: Pass them on in the chat's eval**

In `apps/jscad-web/src/aiEvaluate.js`, replace `return { entityCount: entities.length }` with:

```js
  return result.warnings?.length ? { entityCount: entities.length, warnings: result.warnings } : { entityCount: entities.length }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --root apps/jscad-web test/frame-host.test.js test/caps.test.js`
Expected: PASS.

- [ ] **Step 6: Document it**

In `apps/jscad-web/docs/architecture.md` `### Unknown-option warnings`, after the sentence ending "`jscadMain` returns them as `warnings`.", add:

```markdown
A grid run's answer merges every member's warnings the same way. The chat's
`eval` result passes them on as `{ entityCount, warnings }`; the editor's own
runs ignore them.
```

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src_frame/gridRun.js apps/jscad-web/test/frame-host.test.js apps/jscad-web/src/aiEvaluate.js apps/jscad-web/test/caps.test.js apps/jscad-web/docs/architecture.md
git commit -m "feat(frame): merge grid warnings and pass them to the chat's eval"
```

---

### Task 9: Warnings in the eval backend

**Files:**
- Modify: `packages/agent-loop/eval/backend.js` (`createReadFile` stub, line 49; `runModel`, lines 62-73; `load` and `requestTool`, lines 82-103)
- Modify: `packages/agent-loop/eval/backend.test.js`
- Modify: `packages/agent-loop/test/prompt.test.js` (examples raise no warnings)
- Modify: `packages/agent-loop/README.md` (`## Eval`, first paragraph)
- Modify: `apps/jscad-web/docs/architecture.md` (the eval paragraph starting "The eval runs model code through `@jscadui/require`")

**Model:** `sonnet` — the stub runs inside `@jscadui/require`'s prebuilt esm, so the wrap has to happen in the stub, not through the require hook.

**Interfaces:**
- Consumes: `withOptionChecks`, `createWarningCollector` (Task 5); `OPTION_TABLES`.
- Produces: `requestTool('eval'|'writeModel')` results gain `warnings` when non-empty; `globalThis[Symbol.for('jscadui.eval.userModule')](spec)` returns the wrapped copy for `@jscad/modeling` and `@jbroll/jscad-fluent`, the Node module object otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-loop/eval/backend.test.js`, inside `describe('eval backend', ...)`:

```js
  it('returns a warning for an option the function does not take', async () => {
    const res = await evalSource(`const { primitives } = require('@jscad/modeling')
const main = () => primitives.roundedCuboid({ size: [30, 20, 10], radius: 2 })
module.exports = { main }`)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }])
  })

  it('names fluent factories and stays quiet for fluent internals', async () => {
    const fluent = await evalSource(`const jf = require('@jbroll/jscad-fluent')
const main = () => [jf.cube({ sise: 10 }), jf.circle({ radius: 5 }).extrudeLinear({ height: 10 }).translate([1, 2, 3])]
module.exports = { main }`)
    expect(fluent.warnings).toEqual([{ fn: 'jf.cube', option: 'sise', suggestions: ['size'] }])
  })

  it('starts each run with no warnings and reports them on writeModel too', async () => {
    const backend = createEvalBackend()
    const bad = `const { primitives } = require('@jscad/modeling')\nmodule.exports = { main: () => primitives.cube({ sise: 3 }) }`
    expect(JSON.parse(await backend.requestTool('writeModel', { source: bad })).warnings).toHaveLength(1)
    expect(JSON.parse(await backend.requestTool('eval', { source: CUBE }))).not.toHaveProperty('warnings')
  })

  it('never mutates the Node module object fluent and model-tools share', async () => {
    const modeling = createRequire(import.meta.url)('@jscad/modeling')
    const before = modeling.primitives.roundedCuboid
    await evalSource(`const { primitives } = require('@jscad/modeling')\nmodule.exports = { main: () => primitives.roundedCuboid({ radius: 1 }) }`)
    expect(modeling.primitives.roundedCuboid).toBe(before)
  })
```

and add `import { createRequire } from 'node:module'` to the file's imports.

In `packages/agent-loop/test/prompt.test.js`, add after the `'%s evaluates in the eval backend'` test:

```js
  it.each(files)('%s raises no option warnings', async (file) => {
    const res = JSON.parse(await createEvalBackend().requestTool('eval', { source: read(file) }))
    expect(res.warnings).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/agent-loop eval/backend.test.js test/prompt.test.js`
Expected: FAIL on the three warning tests (`res.warnings` is undefined); the mutation and prompt-example tests pass already. If a prompt example warns after Step 3, the index is missing an option that function really takes: fix the generator (`PASS_THROUGH` or the JSDoc walk) and regenerate, never the example.

- [ ] **Step 3: Wrap in the stub and collect per run**

In `packages/agent-loop/eval/backend.js`, add imports:

```js
import { OPTION_TABLES } from '../api/optionTable.js'
import { createWarningCollector, withOptionChecks } from '../src/optionChecks.js'
```

After `globalThis[NODE_REQUIRE] = createRequire(import.meta.url)`, add:

```js
// Node's module object for @jscad/modeling is the one fluent's and
// model-tools' own requires get, so model code gets a wrapped copy instead.
const USER_MODULE = Symbol.for('jscadui.eval.userModule')
const warnings = createWarningCollector()
const wrapped = new WeakMap()
globalThis[USER_MODULE] = (spec) => {
  const real = globalThis[NODE_REQUIRE](spec)
  const table = OPTION_TABLES[spec]
  if (!table) return real
  if (!wrapped.has(real)) wrapped.set(real, withOptionChecks(real, table, warnings.warn))
  return wrapped.get(real)
}
```

In `createReadFile`, change the stub line to:

```js
      return `module.exports = globalThis[Symbol.for('jscadui.eval.userModule')](${JSON.stringify(spec)})`
```

In `runModel`, add `warnings.reset()` as the first line and return the list:

```js
  return { geometry: [out].flat(Infinity), params: toParamDefinitions(state.discovered), warnings: warnings.list() }
```

In `createEvalBackend`, keep the run's warnings and add them to both results:

```js
  let lastWarnings = []

  const load = async (source, entry) => {
    const loaded = await runModel(source, entry)
    geometry = loaded.geometry
    params = loaded.params
    lastWarnings = loaded.warnings
  }

  const withWarnings = (result) => (lastWarnings.length ? { ...result, warnings: lastWarnings } : result)
```

with `eval` returning `JSON.stringify(withWarnings({ ok: true, params, entities: geometry.length }))` and `writeModel` returning `JSON.stringify(withWarnings({ ok: true, entry }))`. `reset()` also sets `lastWarnings = []`.

- [ ] **Step 4: Run the agent-loop suite**

Run: `npx vitest run --root packages/agent-loop`
Expected: PASS, every file.

- [ ] **Step 5: Document it**

In `packages/agent-loop/README.md` `## Eval`, add after the first paragraph:

```markdown
The CDN stub hands model code a copy of `@jscad/modeling` and
`@jbroll/jscad-fluent` with the unknown-option checks (`src/optionChecks.js`,
`api/optionTable.js`), so `eval` and `writeModel` results carry
`warnings: [{ fn, option, suggestions }]` like the app's. Node's module object
is never changed: fluent and model-tools require the same one.
```

In `apps/jscad-web/docs/architecture.md`, at the end of the paragraph starting "The eval runs model code through `@jscadui/require`", add:

```markdown
Its CDN stub returns the option-checked copy of `@jscad/modeling` and
`@jbroll/jscad-fluent` itself rather than through `setUserModuleWrapper`,
because the eval loads the prebuilt `esm/` build and Node's module object is
shared with fluent's and model-tools' own requires.
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/eval/backend.js packages/agent-loop/eval/backend.test.js packages/agent-loop/test/prompt.test.js packages/agent-loop/README.md apps/jscad-web/docs/architecture.md
git commit -m "feat(agent-loop): return unknown-option warnings from the eval backend"
```

---

### Task 10: Eval metrics and the `misspelled-option` fixture

**Files:**
- Create: `packages/agent-loop/eval/fixtures/misspelled-option.js`
- Modify: `packages/agent-loop/eval/fixtures.test.js`
- Modify: `packages/agent-loop/eval/grade.js` (`transcriptMetrics`, lines 62-69)
- Modify: `packages/agent-loop/eval/grade.test.js` (`describe('transcriptMetrics')`, lines 99-116)
- Modify: `packages/agent-loop/eval/run-eval.js` (`runSuite`, lines 89-105; `regradeResults`, lines 125-134)
- Modify: `packages/agent-loop/eval/regrade.test.js` (lines 58 and 76)
- Modify: `packages/agent-loop/eval/runner.test.js` (first test)
- Modify: `packages/agent-loop/eval/report.js` (`summarize`, `formatSummary`, `formatComparison`)
- Modify: `packages/agent-loop/eval/report.test.js`
- Modify: `packages/agent-loop/README.md` (`## Eval` metrics list and `--regrade` sentences)

**Model:** `sonnet` — five modules and their tests change together, and several exact `toEqual` expectations must move with them.

**Interfaces:**
- Consumes: `docs` tool name (Task 4); `warnings` on tool results (Task 9).
- Produces: `transcriptMetrics(transcript) → { toolCalls, failedCalls, warnings, docsCalls }`; each result's `metrics` carries `warnings` and `docsCalls`; `summarize` means both; `formatSummary`/`formatComparison` print them.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-loop/eval/fixtures/misspelled-option.js`:

```js
// The option is roundRadius; a model that writes radius gets the 0.2 default.
export const fixture = {
  name: 'misspelled-option',
  prompt: 'A 30 by 20 by 10 box with 3mm rounded edges',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [10, 20, 30] },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '10 x 20 x 30', pass: Math.abs(a - 10) < 0.5 && Math.abs(b - 20) < 0.5 && Math.abs(c - 30) < 0.5 },
      // roundRadius 3 gives 5532-5570 mm³ across 16-64 segments; 2.5 and 3.5 fall outside.
      { name: '3mm edge radius', pass: volume > 5480 && volume < 5640 },
    ]
  },
}
```

In `packages/agent-loop/eval/fixtures.test.js`, add to the `it.each` table:

```js
    ['misspelled-option', () => primitives.roundedCuboid({ size: [30, 20, 10], roundRadius: 3 }), {}],
```

and add:

```js
  it('misspelled-option fails the default and a 2mm radius, passes 3mm at 16 segments', () => {
    const passes = (roundRadius, segments = 32) =>
      byName['misspelled-option'].checks(measure([primitives.roundedCuboid({ size: [30, 20, 10], roundRadius, segments })], {}), {}).every((c) => c.pass)
    expect(passes(0.2)).toBe(false)
    expect(passes(2)).toBe(false)
    expect(passes(3, 16)).toBe(true)
  })
```

In `packages/agent-loop/eval/grade.test.js` `describe('transcriptMetrics')`, change the two `toEqual`s to `{ toolCalls: 4, failedCalls: 2, warnings: 0, docsCalls: 0 }` and `{ toolCalls: 0, failedCalls: 0, warnings: 0, docsCalls: 0 }`, and add:

```js
  it('sums returned warnings and counts docs calls', () => {
    const warned = (id, n) => resultMsg(id, JSON.stringify({ ok: true, warnings: Array.from({ length: n }, () => ({})) }))
    const transcript = [
      toolMsg('t1', 'docs'), resultMsg('t1', 'primitives.roundedCuboid (@jscad/modeling)'),
      toolMsg('t2', 'eval'), warned('t2', 2),
      toolMsg('t3', 'writeModel'), warned('t3', 1),
    ]
    expect(transcriptMetrics(transcript)).toEqual({ toolCalls: 3, failedCalls: 0, warnings: 3, docsCalls: 1 })
  })
```

In `packages/agent-loop/eval/regrade.test.js`, change line 58 to `expect(out.results[0].metrics).toEqual({ toolCalls: 2, failedCalls: 1, warnings: 0, docsCalls: 0 })` and line 76 to:

```js
    expect(out.results[0].metrics).toEqual({
      rounds: 5, toolCalls: 1, failedCalls: 0, warnings: 0, docsCalls: 0, inputTokens: 100, outputTokens: 20, seconds: 3.5, geometryError: 0.1,
    })
```

In `packages/agent-loop/eval/runner.test.js` first test, add after the `failedCalls` expectation:

```js
    expect(results[0].metrics.warnings).toBe(0)
    expect(results[0].metrics.docsCalls).toBe(0)
```

In `packages/agent-loop/eval/report.test.js`, add `warnings: null, docsCalls: null,` to both objects in the first test's `toEqual`, and add:

```js
  it('means, prints and compares warnings and docsCalls', () => {
    const metrics = { rounds: 4, toolCalls: 3, failedCalls: 1, inputTokens: 100, outputTokens: 20, seconds: 2, geometryError: 0.1, warnings: 2, docsCalls: 1 }
    const summary = summarize([run('a', 0, 1, 8, undefined, metrics), run('a', 0, 1, 8, undefined, { ...metrics, warnings: 0, docsCalls: 3 })])
    expect(summary[0]).toEqual(expect.objectContaining({ warnings: 1, docsCalls: 2 }))
    expect(formatSummary(summary)).toContain('geometryError  warnings  docsCalls')
    expect(formatSummary(summary)).toContain('a  4.00  1.00  100.00  20.00  2.00  0.10  1.00  2.00')
    const text = formatComparison({ model: 'm', summary }, { model: 'm', summary: summarize([run('a', 0, 1, 8)]) })
    expect(text).toContain('warnings a → b  docsCalls a → b')
    expect(text).toContain('0.10 → -  1.00 → -  2.00 → -')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/agent-loop eval`
Expected: FAIL in `grade.test.js`, `regrade.test.js`, `runner.test.js` and `report.test.js` on the new fields; the fixture tests pass.

- [ ] **Step 3: Count them**

In `packages/agent-loop/eval/grade.js`, replace `transcriptMetrics` with:

```js
const warningsIn = (content) => {
  try {
    const warnings = JSON.parse(content)?.warnings
    return Array.isArray(warnings) ? warnings.length : 0
  } catch {
    return 0
  }
}

// All tool calls and all failed results in the run, unlike firstAttemptFailures
// which stops counting at the first successful eval.
export function transcriptMetrics(transcript) {
  const calls = toolCallsOf(transcript)
  const results = resultsOf(transcript)
  return {
    toolCalls: calls.length,
    failedCalls: results.filter((r) => failed(r.content)).length,
    warnings: results.reduce((n, r) => n + warningsIn(r.content), 0),
    docsCalls: calls.filter((c) => c.name === 'docs').length,
  }
}
```

In `packages/agent-loop/eval/run-eval.js` `runSuite`, replace the destructure with `const { toolCalls, failedCalls, warnings, docsCalls } = transcriptMetrics(transcript)` and add `warnings,` and `docsCalls,` after `failedCalls,` in `metrics`. In `regradeResults`, drop the destructure and set `metrics: { ...result.metrics, ...transcriptMetrics(result.transcript) }`.

In `packages/agent-loop/eval/report.js`:
- `summarize`: add `warnings: meanOf(runs, (r) => r.metrics?.warnings),` and `docsCalls: meanOf(runs, (r) => r.metrics?.docsCalls),` after `geometryError`.
- `formatSummary`: the second header becomes `'fixture  rounds  failedCalls  inputTokens  outputTokens  seconds  geometryError  warnings  docsCalls'` and each row appends `  ${n2or(s.warnings)}  ${n2or(s.docsCalls)}`.
- `formatComparison`: the second header becomes `'fixture  rounds a → b  failedCalls a → b  seconds a → b  geometryError a → b  warnings a → b  docsCalls a → b'` and each row appends `  ${cell(sa, 'warnings')} → ${cell(sb, 'warnings')}  ${cell(sa, 'docsCalls')} → ${cell(sb, 'docsCalls')}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root packages/agent-loop eval`
Expected: PASS.

- [ ] **Step 5: Document the metrics**

In `packages/agent-loop/README.md` `## Eval`, add to the metrics list after `failedCalls`:

```markdown
- `warnings`: unknown-option warnings returned on the run's `eval` and
  `writeModel` results, summed. Transcript-derived.
- `docsCalls`: `docs` calls in the run. Transcript-derived.
```

and change "`--regrade` fills only `toolCalls` and `failedCalls`" to "`--regrade` fills only `toolCalls`, `failedCalls`, `warnings` and `docsCalls`".

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/eval packages/agent-loop/README.md
git commit -m "feat(eval): count warnings and docs calls; add the misspelled-option fixture"
```

---

### Task 11: Live eval (after the user says yes)

**Files:** none in jscadui. The result file lands in `~/src/jscad-chat-evals/results/`.

**Model:** `sonnet` — runs the eval, reads the comparison, applies the keep rule.

**Interfaces:**
- Consumes: everything above.
- Produces: a result file `~/src/jscad-chat-evals/results/2026-09-28-muse-spark-1.3-contributor-<sha8>.json` and a report for the user.

- [ ] **Step 1: Ask the user**

Stop and ask: "The live eval spends API budget: 7 fixtures × 5 runs on `meta` / `muse-spark-1.3-contributor`. Run it now?" Do nothing further until the user answers yes. On no, skip to Task 12 and say the eval was not run.

- [ ] **Step 2: Run the suite**

Run under Bash `run_in_background`, from the repo root:

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor EVAL_VERBOSE=1 npm run eval -w @jscadui/agent-loop
```

Expected when it exits: the first line `run-eval: writing <path>` names the result file, one line per run follows, and the summary tables end the output. Read the output file the background task names; do not tail or poll it.

- [ ] **Step 3: Compare with the baseline**

Run: `npm run eval -w @jscadui/agent-loop -- --compare /home/john/src/jscad-chat-evals/results/2026-09-28-muse-spark-1.3-contributor-2553cd49.json <new result path>`
Expected: both tables print; `misspelled-option` shows `-` on the baseline side.

- [ ] **Step 4: Apply the keep rule and report**

The keep rule is unchanged: keep when first-attempt failures do not rise on the new fixture and no fixture's mean total falls by more than 0.5. Report to the user, with numbers from the comparison: for `rounded-box`, `gear` and `misspelled-option` the rounds, failed calls and geometry error; the `misspelled-option` check pass rate; `warnings` and `docsCalls` per fixture; and whether the keep rule holds. If it fails, say so and stop; do not revert anything without the user. Do not commit in `jscad-chat-evals` unless the user asks.

---

### Task 12: Fold the design into the permanent docs and delete the spec and plan

Runs after the final whole-branch review.

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md` (anything from the spec still missing)
- Modify: `docs/backlog.md` (new section before `## Refactoring`, line 189)
- Delete: `docs/superpowers/specs/2026-09-28-docs-tool-and-option-warnings-design.md`
- Delete: `docs/superpowers/plans/2026-09-28-docs-tool-and-option-warnings.md`

**Model:** `sonnet` — reading the spec against the docs written in Tasks 1-10 is judgment work.

**Interfaces:**
- Consumes: the docs written in Tasks 1, 2, 4, 6, 7, 8, 9, 10.
- Produces: no spec or plan left on the branch.

- [ ] **Step 1: Check the spec's Documentation list against the tree**

Read the spec's `## Documentation` section and confirm each item exists: `architecture.md` Agent loop covers the `docs` tool, the index, the option checks and why the hook is base-gated (Tasks 4, 7, 8, 9); `packages/agent-loop/README.md` covers the generator, `docs` and warnings in eval results (Tasks 1, 2, 4, 9, 10); `packages/require/README.md` covers `setUserModuleWrapper` (Task 6). Add anything missing in the same plain style. Carry over the "Decisions that differ from the spec" that a reader of the code would need and that no doc states yet (for example why suggestions also match by containment).

- [ ] **Step 2: Record deferred work**

In `docs/backlog.md`, before `## Refactoring`, add:

```markdown
## Chat API help

- Option checks cover only functions reachable from the `@jscad/modeling` and
  `@jbroll/jscad-fluent` exports. Fluent class methods
  (`FluentGeom2.extrudeLinear`) are documented by `docs` but unchecked: their
  prototypes are shared with library code, so a check there needs a way to
  tell model calls from fluent's own.
- `api/index.json` is about 130 KB in the app's main bundle. Load it on the
  first `docs` call if bundle size starts to matter.
- JSDoc gaps in `@jscad/modeling` are patched in `api/build-index.js`
  (`PASS_THROUGH`, `defaults` keys). A false warning from a real call means
  another entry belongs there, or upstream JSDoc needs the option.
```

- [ ] **Step 3: Delete the spec and the plan**

```bash
git rm docs/superpowers/specs/2026-09-28-docs-tool-and-option-warnings-design.md docs/superpowers/plans/2026-09-28-docs-tool-and-option-warnings.md
```

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/docs/architecture.md docs/backlog.md
git commit -m "docs: fold the docs-tool design into the permanent docs, drop spec and plan"
```
