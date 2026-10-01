# Parts Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users and the chat agent call vetted standard hardware (nuts, screws, washers, ball bearings, steppers) from NopSCADlib and BOSL2 as read-only parametric parts, from both `.scad` and `.js` files.

**Architecture:** Every transpiled `.scad` file gains a clean JS export surface (`nut(M3_nut, {nyloc: true})`) plus a `$meta` description, built at load time by a runtime helper. Unpatched library trees are deployed under `/libs/` on the app origin; SCAD includes and JS bare requires fall back to it. A new `packages/parts` holds one hand-written record per entry and generates checks, thumbnails, `catalog.json`, agent docs and a prompt block. The agent and a parts-browser panel read the generated outputs.

**Tech Stack:** TypeScript transpiler (`packages/openscad`, vitest), plain-JS runtime (`packages/openscad-runtime`), `@jscadui/require`, esbuild app build, Playwright e2e, simple-ci (`sci`) on the GPU host.

**Spec:** `docs/superpowers/specs/2026-10-01-parts-catalog-design.md`. Executors read the spec and the task.

## Global Constraints

- Modern browsers only; ES2022+, no polyfills or compat shims.
- Comments: default to none; one or two lines, say why, never what. No history narration.
- Docs change in the same commit as the code they describe.
- Never open a pull request, push to a fork, or touch GitHub issues.
- Transpiler changes (`packages/openscad/src/**`) are not committed until the controller has a green GPU run (`npm test` in `packages/openscad`, i.e. `sci push jscadui/test`). Implementers of those tasks stop before `git commit` and report.
- Never run the full OpenSCAD comparison suite locally. `npx vitest run` in `packages/openscad` is fine.
- Never start `run-jscad.js` locally without `--timeout`.
- Before CLI checks of a `packages/openscad/src` change, rebuild: `npm run build -w @jscadui/openscad` (run-jscad and the web bundles use `esm/`).
- One command per Bash call; no `&&` chains, no `sleep`/poll loops.
- Library trees under `apps/jscad-web/libs/` are unpatched upstream copies plus their LICENSE file. Generated shims live under `apps/jscad-web/libs/_catalog/`.
- Licenses: everything except non-commercial. CC-BY-NC (`gears`) is out.
- Reserved export names that never get a bare clean name: `main`, `getParameterDefinitions`, `fn`, `vars`, `$meta`, `$scad`.

## Decisions this plan adds to the spec

- **Clean exports are built by a runtime helper**, `j$.exportClean(exports, raw, meta)`, not by emitting one wrapper per name. Emitted code stays two lines longer per file, and the wrapper logic is unit-tested once.
- **`$meta` is an array** of `{ name, kind, params?, lazy? }`, because a module, a function and a variable may share a name. `lazy: true` marks variables emitted as thunks.
- **Derived data is produced by `bin/check.js` and committed** as `packages/parts/derived.json`, next to the thumbnails. `bin/build.js` only merges JSON, so the app build never runs the transpiler on BOSL2.
- **The library-name list is the set of directories under `apps/jscad-web/libs/`**, read by `apps/jscad-web/build.js`. Only catalog libraries get a `libs/` destination, so this equals the catalog's library set.
- **BOSL2 parts need `std.scad` first.** A record may carry `prelude: ["BOSL2/std.scad"]`. The parts build writes a shim `libs/_catalog/<library>/<basename>.scad` that includes the prelude and the file; JS requires the shim path, SCAD inserts the include lines directly. Names starting with `_` are invalid npm names, so `_catalog/` never shadows a package.
- **The live smoke check uses two committed app-origin examples**, `apps/jscad-web/examples/parts/nut.scad` and `nut.js`. Project-origin resolution is covered by `e2e/frame.spec.js`.
- **The scad require handler moves to `packages/agent-loop/src/`** (beside `projectUrl.js`, which the frame already imports) so the eval executor, whose crt sandbox only sees `packages/` and `node_modules`, can use it.

---

## Phase 1: Transpiler clean surface and `$meta` (spec step 1)

### Task 1: Runtime `exportClean` helper

**Files:**
- Create: `packages/openscad-runtime/src/cleanExports.js`
- Modify: `packages/openscad-runtime/src/index.js` (add a method on the `j$` object near `withScope`, ~line 363)
- Test: `packages/openscad/test/clean-exports-runtime.test.ts` (runtime tests live in `packages/openscad/test`, e.g. `runtime.test.ts`)

**Model:** `sonnet` — small module, but the getter/priority rules need care.

**Interfaces:**
- Produces: `j$.exportClean(exports, raw, meta)` on the `j$` prototype, so `createJ$Instance()` instances inherit it and use their own scope stack via `this`.
  - `exports`: the module's exports object; receives bare names, `fn`, `vars`, `$meta`.
  - `raw`: object holding suffixed bindings (`washer_$m`, `area_$f`, `area_$f$obj`) and raw variable values (thunks for lazy ones).
  - `meta`: `Array<{ name: string, kind: 'module'|'function'|'variable', params?: Array<{ name: string, default?: string }>, lazy?: true }>`. Later entries with the same `kind:name` win.
- Produces: `RESERVED` (Set) exported from `cleanExports.js`.

Calling rules (spec section 3):
- Module wrapper `(...args)`: if the last arg is a plain object (`Object.getPrototypeOf(v) === Object.prototype`) it holds named args. SCAD values are never plain objects (ranges are arrays). Positional args map to `params[i].name`; extras beyond the parameter list are dropped. `children` (geometry or array of geometry) becomes `[() => g, ...]`. Keys starting with `$` pass straight into `_opts`, where the module's `...$$sv` rest picks them up. Calls `raw[name+'_$m'](opts)(thunks)`.
- Function wrapper: named `$` keys are split off and the call runs inside `this.withScope(specials, call)` (the `_$f$obj` entry drops `$` keys). With no other named keys it calls `_$f(...positional)`; otherwise `_$f$obj({ ...positionalByName, ...named })`.
- Variables: plain data property, or a getter calling the thunk when `lazy`.
- Priority for the bare name: module, then function, then variable. Every function also under `exports.fn`, every variable under `exports.vars`. Reserved names get no bare name but still go under `fn`/`vars`.
- All properties defined with `Object.defineProperty(..., { enumerable: true, configurable: true })` so a later, higher-priority definition can replace a getter (ESM is strict mode; plain assignment over a getter-only property throws).

- [ ] **Step 1: Write the failing test**

```ts
// packages/openscad/test/clean-exports-runtime.test.ts
import { describe, it, expect } from 'vitest'
import j$, { createJ$Instance } from '@jscadui/openscad-runtime'

const rt = createJ$Instance()

const washerParams = [{ name: 'type' }, { name: 'h', default: '2' }]
const raw = () => ({
  washer_$m: (opts = {}) => (children = []) => ({ opts, kids: children.map((c) => c()) }),
  area_$f: (r) => Math.PI * r * r,
  area_$f$obj: ({ r }) => Math.PI * r * r,
  fa_$f: () => rt.getSpecialVar('$fa'),
  M3_washer: [3, 7],
  layer_height: () => rt.getSpecialVar('$fn') * 0.1,
})
const meta = [
  { name: 'washer', kind: 'module', params: washerParams },
  { name: 'area', kind: 'function', params: [{ name: 'r' }] },
  { name: 'fa', kind: 'function', params: [] },
  { name: 'M3_washer', kind: 'variable' },
  { name: 'layer_height', kind: 'variable', lazy: true },
]
const load = (m = meta, r = raw()) => {
  const exports = {}
  rt.exportClean(exports, r, m)
  return exports
}

describe('exportClean', () => {
  it('maps positional module arguments to parameter names', () => {
    expect(load().washer([3, 7], 1).opts).toEqual({ type: [3, 7], h: 1 })
  })

  it('takes a trailing plain object as named arguments', () => {
    expect(load().washer([3, 7], { h: 4 }).opts).toEqual({ type: [3, 7], h: 4 })
  })

  it('passes $ keys through to the module options', () => {
    expect(load().washer([3, 7], { $fn: 64 }).opts).toEqual({ type: [3, 7], $fn: 64 })
  })

  it('wraps children geometry in thunks', () => {
    const g = { polygons: [] }
    expect(load().washer([3, 7], { children: g }).kids).toEqual([g])
    expect(load().washer([3, 7], { children: [g, g] }).kids).toEqual([g, g])
    expect(load().washer([3, 7]).kids).toEqual([])
  })

  it('calls functions positionally or by name', () => {
    const e = load()
    expect(e.area(2)).toBeCloseTo(4 * Math.PI)
    expect(e.area({ r: 2 })).toBeCloseTo(4 * Math.PI)
    expect(e.fn.area(2)).toBeCloseTo(4 * Math.PI)
  })

  it('runs a function with $ arguments inside a special-variable scope', () => {
    expect(load().fa({ $fa: 7 })).toBe(7)
  })

  it('exports plain variables by value and lazy ones as getters', () => {
    const e = load()
    expect(e.M3_washer).toEqual([3, 7])
    expect(e.vars.M3_washer).toEqual([3, 7])
    expect(e.layer_height).toBe(0)
    expect(rt.withScope({ $fn: 30 }, () => e.vars.layer_height)).toBeCloseTo(3)
  })

  it('gives a shared name to the module, then the function, then the variable', () => {
    const r = { ...raw(), nut_$m: () => () => 'module', nut_$f: () => 'function', nut: 'variable' }
    const m = [
      { name: 'nut', kind: 'variable' },
      { name: 'nut', kind: 'function', params: [] },
      { name: 'nut', kind: 'module', params: [] },
    ]
    const e = load(m, r)
    expect(e.nut()).toBe('module')
    expect(e.fn.nut()).toBe('function')
    expect(e.vars.nut).toBe('variable')
  })

  it('gives reserved names no bare export', () => {
    const r = { main_$m: () => () => 'm', fn_$f: () => 'f', vars: 1 }
    const m = [
      { name: 'main', kind: 'module', params: [] },
      { name: 'fn', kind: 'function', params: [] },
      { name: 'vars', kind: 'variable' },
    ]
    const exports = { main: 'original' }
    rt.exportClean(exports, r, m)
    expect(exports.main).toBe('original')
    expect(exports.fn.fn()).toBe('f')
    expect(exports.vars.vars).toBe(1)
  })

  it('publishes the metadata', () => {
    expect(load().$meta).toBe(meta)
  })

  it('is inherited by the default instance', () => {
    expect(typeof j$.exportClean).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `packages/openscad`): `npx vitest run test/clean-exports-runtime.test.ts`
Expected: FAIL, `rt.exportClean is not a function`.

- [ ] **Step 3: Implement**

```js
// packages/openscad-runtime/src/cleanExports.js
export const RESERVED = new Set(['main', 'getParameterDefinitions', 'fn', 'vars', '$meta', '$scad'])

const isNamedArgs = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

const splitArgs = (args) => (isNamedArgs(args.at(-1)) ? [args.slice(0, -1), args.at(-1)] : [args, {}])

const byName = (positional, params) => {
  const named = {}
  positional.forEach((v, i) => { if (i < params.length) named[params[i].name] = v })
  return named
}

const thunks = (children) => (Array.isArray(children) ? children : [children]).map((g) => () => g)

const put = (target, name, descriptor) =>
  Object.defineProperty(target, name, { ...descriptor, enumerable: true, configurable: true })

const moduleWrapper = (mod, params) => (...args) => {
  const [positional, named] = splitArgs(args)
  const { children = [], ...rest } = named
  return mod({ ...byName(positional, params), ...rest })(thunks(children))
}

const functionWrapper = (rt, f, fObj, params) => (...args) => {
  const [positional, named] = splitArgs(args)
  const specials = {}
  const plain = {}
  for (const [k, v] of Object.entries(named)) (k.startsWith('$') ? specials : plain)[k] = v
  const call = Object.keys(plain).length === 0 || !fObj
    ? () => f(...positional)
    : () => fObj({ ...byName(positional, params), ...plain })
  return Object.keys(specials).length ? rt.withScope(specials, call) : call()
}

export function exportClean(rt, exports, raw, meta) {
  const latest = new Map()
  for (const entry of meta) latest.set(`${entry.kind}:${entry.name}`, entry)
  const entries = [...latest.values()]
  const of = (kind) => entries.filter((e) => e.kind === kind)
  const fn = {}
  const vars = {}
  for (const e of of('variable')) {
    if (!(e.name in raw)) continue
    const value = raw[e.name]
    put(vars, e.name, e.lazy ? { get: () => value() } : { value, writable: true })
  }
  for (const e of of('function')) {
    const f = raw[`${e.name}_$f`]
    if (typeof f === 'function') put(fn, e.name, { value: functionWrapper(rt, f, raw[`${e.name}_$f$obj`], e.params ?? []), writable: true })
  }
  const bare = (name) => !RESERVED.has(name)
  for (const name of Object.keys(vars)) if (bare(name)) put(exports, name, Object.getOwnPropertyDescriptor(vars, name))
  for (const name of Object.keys(fn)) if (bare(name)) put(exports, name, { value: fn[name], writable: true })
  for (const e of of('module')) {
    const mod = raw[`${e.name}_$m`]
    if (bare(e.name) && typeof mod === 'function') put(exports, e.name, { value: moduleWrapper(mod, e.params ?? []), writable: true })
  }
  put(exports, 'fn', { value: fn, writable: true })
  put(exports, 'vars', { value: vars, writable: true })
  put(exports, '$meta', { value: meta, writable: true })
}
```

In `packages/openscad-runtime/src/index.js`, import `{ exportClean }` from `./cleanExports.js` at the top and add to the `j$` object, after `withScope`:

```js
  exportClean(exports, raw, meta) { exportClean(this, exports, raw, meta) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/clean-exports-runtime.test.ts`
Expected: PASS. Then the whole unit suite: `npx vitest run` — all pass.

- [ ] **Step 5: Commit** (runtime-only; nothing calls it yet, so no GPU run is needed)

```bash
git add packages/openscad-runtime/src/cleanExports.js packages/openscad-runtime/src/index.js packages/openscad/test/clean-exports-runtime.test.ts
git commit -m "feat(openscad-runtime): exportClean builds a clean JS surface from suffixed exports"
```

### Task 2: Transpiler emits `$meta` and calls `exportClean`

**Files:**
- Create: `packages/openscad/src/transpiler/cleanExports.ts`
- Modify: `packages/openscad/src/transpiler/transpile.ts` (`buildOutputCode`, export line at ~641-668)
- Modify: `packages/openscad/ARCHITECTURE.md` (new section "Clean exports")
- Modify: `packages/openscad/test/__snapshots__/transpile.test.ts.snap` (regenerate; review the diff)
- Test: `packages/openscad/test/clean-exports.test.ts`

**Model:** `opus` — codegen change with interplay against `declareMissingSymbols`, include forwarding and caching.

**Interfaces:**
- Consumes: `j$.exportClean(exports, raw, meta)` from Task 1.
- Produces: every transpiled file ends with
  ```js
  Object.assign(exports, { ...today's list..., main })
  j$.exportClean(exports, { ...exports }, [...(_ns0.$meta ?? []), { "name": "washer", "kind": "module", "params": [{ "name": "type" }, { "name": "h", "default": "2" }] }, ...])
  ```
  The spread terms appear once per optimized `include` namespace (`_nsN` from `ctx.includeImports`, not `use` imports). Local and bundled-include entries are literal.
- Produces: `defaultText(arg, closeParenStart): string | undefined` in `cleanExports.ts`.

Facts the implementer needs (from exploration):
- Export list assembly: `transpile.ts:641-668`. Names: modules `X_$m`, functions `X_$f` plus `X_$f$obj` when they have params, `ctx.variableNames`, `includeReExports`, customizer exports, `main`.
- `ctx.declarations.get('X_$m' | 'X_$f')` returns `{ ast, params, source }`; `ast.definitionArgs` is `AssignmentNode[]` with `name`, `tokens.equals`, `tokens.trailingCommas`. Module and function statements have `tokens.secondParen`.
- `value.span` is wrong for defaults (binary expressions cover only the operator). Use the token recipe in `defaultText` below.
- Lazy variables: `ctx.lazyVarNames` (transpile.ts:390-400).
- Optimized include forwarders: transpile.ts:526-550 emit `const _nsN = require(...)` and `var x_$m = (...a) => _nsN.x_$m?.(...a)`. Only include imports feed `includeReExports`; find the `nsVar` for each include import there.
- `declareMissingSymbols` (transpile.ts:818-844, esp. :835) scans the export object shorthand. Check that the new line does not make it emit stubs or miss declarations; a test below covers this.

Meta entry rules, per name in the final export list (skip `main`, `getParameterDefinitions`, customizer exports):
- `X_$m` with a local or bundled declaration → `{ name: X, kind: 'module', params }`.
- `X_$f` with a declaration → `{ name: X, kind: 'function', params }`. Skip `X_$f$obj`.
- A name in `ctx.variableNames` → `{ name, kind: 'variable' }` plus `lazy: true` when in `ctx.lazyVarNames`.
- Suffixed names without a declaration come from an optimized include; their entries arrive through the `_nsN.$meta` spread.
- `params[i].name` is the original SCAD name (`arg.name`), the key `_opts` is destructured with. Check `buildDestructurePattern` (statements.ts:1097-1133): a self-referencing default renames the binding (`screw: _screw_param$2`) but keeps the key, so `arg.name` is right.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/openscad/test/clean-exports.test.ts
import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import { createJ$Instance } from '@jscadui/openscad-runtime'

type Files = Record<string, string>

// Transpiles every file, then loads `entry` with a require that loads the others.
const load = (files: Files, entry = '/main.scad') => {
  const j$ = createJ$Instance()
  const cache = new Map<string, any>()
  const fileResolver = (name: string) => (files['/' + name] ? { path: '/' + name, content: files['/' + name] } : undefined)
  const req = (path: string): any => {
    if (cache.has(path)) return cache.get(path)
    const { code } = transpile(parse(files[path]).ast, { currentFile: path, fileResolver, includeHeader: false })
    const mod = { exports: {} as any }
    cache.set(path, mod.exports)
    new Function('require', 'module', 'exports', 'j$', code)(req, mod, mod.exports, j$)
    return mod.exports
  }
  return { exports: req(entry), j$ }
}

const SRC = `
module washer(type, h = 2 * (1 + 0)) { cylinder(r = type[0], h = h); children(); }
function area(r) = PI * r * r;
M3_washer = [3, 7];
layer_height = $fn * 0.1;
`

describe('clean exports', () => {
  it('lists modules, functions and variables in $meta with default source text', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.$meta).toEqual([
      { name: 'washer', kind: 'module', params: [{ name: 'type' }, { name: 'h', default: '2 * (1 + 0)' }] },
      { name: 'area', kind: 'function', params: [{ name: 'r' }] },
      { name: 'M3_washer', kind: 'variable' },
      { name: 'layer_height', kind: 'variable', lazy: true },
    ])
  })

  it('calls a module positionally and returns geometry', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.washer(exports.M3_washer)).toBeTruthy()
  })

  it('reads a special-variable variable through a getter', () => {
    const { exports, j$ } = load({ '/main.scad': SRC })
    expect(j$.withScope({ $fn: 30 }, () => exports.layer_height)).toBeCloseTo(3)
  })

  it('calls a function by name', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.area({ r: 1 })).toBeCloseTo(Math.PI)
  })

  it('keeps the suffixed exports beside the clean ones', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(typeof exports.washer_$m).toBe('function')
    expect(typeof exports.area_$f).toBe('function')
    expect(typeof exports.main).toBe('function')
  })

  it('re-exports clean names through a bundled include', () => {
    const files = {
      '/other.scad': 'other_d = 4; module bolt(d = 3) cylinder(d = d, h = 10); function twice(x) = 2 * x;',
      '/main.scad': 'include <other.scad>\nmodule plate() bolt(d = twice(2));',
    }
    const { exports } = load(files)
    expect(exports.twice(3)).toBe(6)
    expect(exports.other_d).toBe(4)
    expect(exports.$meta.map((e: any) => e.name)).toEqual(expect.arrayContaining(['plate', 'bolt', 'twice', 'other_d']))
  })

  it('re-exports clean names through an optimized include', () => {
    const files = {
      '/pure.scad': 'module nut(d = 3) cylinder(d = d, h = 2); function half(x) = x / 2;',
      '/main.scad': 'include <pure.scad>\nnut(d = half(8));',
    }
    const { exports } = load(files)
    expect(exports.half(8)).toBe(4)
    expect(exports.nut(3)).toBeTruthy()
    expect(exports.$meta.find((e: any) => e.name === 'nut').params).toEqual([{ name: 'd', default: '3' }])
  })

  it('does not re-export names from use', () => {
    const files = {
      '/pure.scad': 'module nut(d = 3) cylinder(d = d, h = 2);',
      '/main.scad': 'use <pure.scad>\nnut();',
    }
    const { exports } = load(files)
    expect(exports.nut).toBeUndefined()
  })

  it('declares no stub for a name the export line mentions', () => {
    const { code } = transpile(parse(SRC).ast, { includeHeader: false })
    expect(code).not.toMatch(/var washer_\$m = \(\) =>/)
  })
})
```

Geometry calls need an initialized runtime. If `createJ$Instance()` has no `jscad`, initialize the shared `j$` once with `@jscad/modeling` the way `test/runtime.test.ts` does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/clean-exports.test.ts`
Expected: FAIL, `exports.$meta` undefined.

- [ ] **Step 3: Implement `cleanExports.ts`**

```ts
// packages/openscad/src/transpiler/cleanExports.ts
import type { TranspileContext } from './context.js'

export interface MetaParam { name: string; default?: string }
export interface MetaEntry { name: string; kind: 'module' | 'function' | 'variable'; params?: MetaParam[]; lazy?: true }

// value.span covers only the operator of a binary expression, so slice the source between tokens.
export const defaultText = (arg: any, closeParenStart: number): string | undefined => {
  const eq = arg.tokens?.equals
  if (!eq) return undefined
  const to = arg.tokens.trailingCommas?.[0]?.span.start.char ?? closeParenStart
  return eq.span.start.file.code.slice(eq.span.end.char, to).trim()
}

const paramsOf = (stmt: any): MetaParam[] => {
  const close = stmt.tokens.secondParen.span.start.char
  return stmt.definitionArgs.map((arg: any) => {
    const text = defaultText(arg, close)
    return text === undefined ? { name: arg.name } : { name: arg.name, default: text }
  })
}

export const metaEntries = (ctx: TranspileContext, exportNames: string[]): MetaEntry[] => {
  const entries: MetaEntry[] = []
  for (const name of exportNames) {
    if (name.endsWith('_$m')) {
      const decl = ctx.declarations.get(name)
      if (decl?.ast) entries.push({ name: name.slice(0, -3), kind: 'module', params: paramsOf(decl.ast) })
    } else if (name.endsWith('_$f')) {
      const decl = ctx.declarations.get(name)
      if (decl?.ast) entries.push({ name: name.slice(0, -3), kind: 'function', params: paramsOf(decl.ast) })
    } else if (ctx.variableNames.has?.(name) ?? (ctx.variableNames as any).includes?.(name)) {
      entries.push(ctx.lazyVarNames.has(name) ? { name, kind: 'variable', lazy: true } : { name, kind: 'variable' })
    }
  }
  return entries
}

export const exportCleanLine = (ctx: TranspileContext, exportNames: string[], includeNamespaces: string[]): string => {
  const spreads = includeNamespaces.map((ns) => `...(${ns}.$meta ?? [])`)
  const literal = metaEntries(ctx, exportNames).map((e) => JSON.stringify(e))
  return `j$.exportClean(exports, { ...exports }, [${[...spreads, ...literal].join(', ')}])`
}
```

Adjust the `ctx.variableNames` membership test to its real type (Set or array) and drop the other branch. Adjust the `TranspileContext` import to the real context type name in `context.ts`.

- [ ] **Step 4: Emit the line in `buildOutputCode`**

In `transpile.ts`, right after `parts.push(\`Object.assign(exports, { ${allExports.join(', ')} })\`)`, push `exportCleanLine(ctx, allExports, includeNamespaces)` where `includeNamespaces` are the `nsVar`s of include imports collected in the require loop at ~526-550 (not `use` imports). Do not add the call to the `exports` array returned by `transpile()` or to `TranspiledFile.exports`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/clean-exports.test.ts`
Expected: PASS.
Run: `npx vitest run`
Expected: only snapshot tests fail, and only by the added `j$.exportClean(...)` line. Inspect the diff, then `npx vitest run -u`, then `npx vitest run` again: all pass. Any other failure is a bug to fix, not to update.

- [ ] **Step 6: Rebuild esm and smoke one file**

Run: `npm run build -w @jscadui/openscad`
Run: `node packages/openscad/bin/run-jscad.js apps/jscad-web/examples/openscad/01-basics/cube.scad -o /tmp/claude-1000/cube.stl --timeout 60`
Expected: writes the STL with no error.

- [ ] **Step 7: Document**

Add a "Clean exports" section to `packages/openscad/ARCHITECTURE.md`: the surface (modules, functions, variables, getters, the trailing-object rule, `$` keys, `children`), clash priority and reserved names, `fn`/`vars`, include re-export and `use` non-export, the `$meta` array shape, and that the runtime helper `j$.exportClean` builds it at load time.

- [ ] **Step 8: Stop.** Do not commit. Report the changed files; the controller runs Task 3.

### Task 3 (controller): GPU run and commit for Task 2

- [ ] Run `npm test` in `packages/openscad` under Bash `run_in_background` (it is `sci push jscadui/test` then `sci wait`). Read the summary with `sci log JOB` (memory: `sci wait` shows only the last suite).
- [ ] All 21 suites must match the latest baseline in `MODEL_COMPARISON_BASELINE.md`. A regression means fixing Task 2, not recording it.
- [ ] Follow the file's existing convention: the current `## Latest GPU run` becomes `## Previous GPU run` (and whatever the file does with the older `Previous` section), then add `## Latest GPU run: 2026-10-01, clean exports and $meta` with branch, job id, OpenSCAD version and "all 21 suites pass, counts unchanged" (or the table if counts changed for the better).
- [ ] Commit Task 2's files plus the baseline: `feat(openscad): clean export surface and $meta beside the suffixed exports`.

---

## Phase 2: `/libs/` tree, resolution, smoke (spec step 2)

### Task 4: Deploy libraries under `apps/jscad-web/libs/`

**Files:**
- Modify: `scripts/deps/manifest.json` (nopscadlib, bosl2-lib, bosl-lib entries)
- Modify: `.gitignore`
- Modify: `apps/jscad-web/build.js` (~97-103)
- Modify: `apps/jscad-web/deploy/hooks/apache.configure.post.sh` (~34-54)
- Modify: `apps/jscad-web/e2e/smoke-deploy.mjs` (ACAO check)
- Modify: `apps/jscad-web/docs/architecture.md` (Deployment section, ~1172; include resolution ~93-118 gets a one-line pointer, details land in Task 5)

**Model:** `sonnet` — config edits across several files.

**Interfaces:**
- Produces: `apps/jscad-web/libs/NopSCADlib/**.scad` + `LICENSE`, `apps/jscad-web/libs/BOSL2/**.scad` + `LICENSE`, copied to `<outDir>/libs/` by the build and served at `/libs/` with `Access-Control-Allow-Origin: *`.

- [ ] **Step 1:** Look at `.deps-cache/nopscadlib` and `.deps-cache/bosl2-lib` for the license file names (`ls .deps-cache/nopscadlib`). Add a second mapping to each entry:

```json
{
  "srcDir": ".",
  "destDir": "apps/jscad-web/libs/NopSCADlib",
  "include": ["*.scad", "**/*.scad", "LICENSE"],
  "exclude": ["examples/**", "tests/**"],
  "skipFiles": []
}
```

```json
{
  "srcDir": ".",
  "destDir": "apps/jscad-web/libs/BOSL2",
  "include": ["*.scad", "LICENSE"],
  "exclude": [],
  "skipFiles": []
}
```

Use the real license filename if it is not `LICENSE`. The bosl2 patches target `packages/openscad/test/corpus/...` paths only, so the `libs/` copy stays unpatched; confirm by reading `scripts/deps/patches/bosl2-lib-fix-includes.patch` headers. Change `bosl-lib`'s `"license"` to `"BSD-2-Clause"` (spec section 7).

- [ ] **Step 2:** Add `apps/jscad-web/libs/` to `.gitignore` next to the other fetched-corpus lines.

- [ ] **Step 3:** Run `node scripts/fetch-deps.js --dep=nopscadlib --no-organize` and `node scripts/fetch-deps.js --dep=bosl2-lib --no-organize`. Expected: `apps/jscad-web/libs/NopSCADlib/vitamins/nuts.scad` and `apps/jscad-web/libs/BOSL2/std.scad` exist, plus both license files. Confirm `git status` shows no files under `libs/`.

- [ ] **Step 4:** In `apps/jscad-web/build.js`, after the examples copy, copy `libs` the same way:

```js
if (existsSync(outDir + '/libs')) rmSync(outDir + '/libs', { recursive: true, force: true })
if (existsSync('libs')) copyTask('libs', outDir + '/libs', { include: [], exclude: [], watch, filters: [] })
```

Run `node build.js --dev --skipDocs` once with a short timeout or check for an existing one-shot flag; expected `build_dev/libs/NopSCADlib/vitamins/nuts.scad` exists. (If `--dev` starts a server, use `JSCAD_OUT_DIR=/tmp/claude-1000/jw node build.js --skipDocs` instead.)

- [ ] **Step 5:** In the apache hook change `<LocationMatch "^/examples/">` to `<LocationMatch "^/(examples|libs)/">` and update its comment line if it names examples only.

- [ ] **Step 6:** In `e2e/smoke-deploy.mjs`, next to the `/examples/...cube.scad` ACAO check, add the same check for `/libs/NopSCADlib/vitamins/nuts.scad` expecting `*`.

- [ ] **Step 7:** Document in `apps/jscad-web/docs/architecture.md` Deployment: `/libs/` holds unpatched library trees fetched by `fetch-deps.js`, gitignored, copied by `build.js`, served with ACAO `*` like `/examples/` because the frame origin is opaque.

- [ ] **Step 8: Commit**

```bash
git add scripts/deps/manifest.json .gitignore apps/jscad-web/build.js apps/jscad-web/deploy/hooks/apache.configure.post.sh apps/jscad-web/e2e/smoke-deploy.mjs apps/jscad-web/docs/architecture.md
git commit -m "feat(jscad-web): deploy NopSCADlib and BOSL2 unpatched under /libs/"
```

### Task 5: SCAD include fallback to `<app origin>/libs/`

**Files:**
- Modify: `apps/jscad-web/src_frame/scadResolve.js` (`includeCandidates`, lines 8-52)
- Test: `apps/jscad-web/test/scad-resolve.test.js`
- Modify: `apps/jscad-web/docs/architecture.md` (include resolution, ~93-118)

**Model:** `sonnet` — small pure function with tests.

**Interfaces:**
- Consumes: `includeCandidates(filename, fromFile, entryUrl, fallbackOrigin)`; `scadHandler.js:147` passes `appOrigin` as `fallbackOrigin`.
- Produces: a last candidate `<fallbackOrigin>/libs/<filename>` for project-origin and app-origin contexts, when it stays under `/libs/` and differs from earlier candidates.

- [ ] **Step 1: Write the failing tests** (add to `test/scad-resolve.test.js`, reusing its `ENTRY`/origin constants; read the file first for their names)

```js
it('falls back to the app libs tree for a library include from a project file', () => {
  expect(includeCandidates('NopSCADlib/vitamins/nuts.scad', 'http://project.local/main.scad', 'http://project.local/main.scad', 'http://localhost:5121')).toEqual([
    'http://project.local/NopSCADlib/vitamins/nuts.scad',
    'http://localhost:5121/libs/NopSCADlib/vitamins/nuts.scad',
  ])
})

it('falls back to the app libs tree after the suite fallback for an app file', () => {
  const fromFile = '/examples/openscad/bosl2/01-part1/cube.scad'
  expect(includeCandidates('BOSL2/std.scad', fromFile, ENTRY, 'http://localhost:5121').at(-1)).toBe('http://localhost:5121/libs/BOSL2/std.scad')
})

it('never offers a libs candidate that escapes the libs root', () => {
  const c = includeCandidates('../../secret.scad', 'http://project.local/main.scad', 'http://project.local/main.scad', 'http://localhost:5121')
  expect(c.some((u) => u.includes('/libs/'))).toBe(false)
  expect(c.some((u) => u === 'http://localhost:5121/secret.scad')).toBe(false)
})

it('keeps a file inside a library resolving relative to itself first', () => {
  const from = 'http://localhost:5121/libs/NopSCADlib/vitamins/nuts.scad'
  expect(includeCandidates('nut.scad', from, 'http://project.local/main.scad', 'http://localhost:5121')[0]).toBe('http://localhost:5121/libs/NopSCADlib/vitamins/nut.scad')
})
```

If the existing `ENTRY` origin is not `http://localhost:5121`, adapt the expected strings to it.

- [ ] **Step 2:** Run `npx vitest run test/scad-resolve.test.js` in `apps/jscad-web`. Expected: the new cases FAIL.

- [ ] **Step 3: Implement** at the end of `includeCandidates`, before `return candidates`:

```js
  if (fallbackOrigin && fallbackOrigin !== 'null') {
    const libsRoot = new URL('/libs/', fallbackOrigin).toString()
    const libsUrl = new URL(filename, libsRoot).toString()
    if (libsUrl.startsWith(libsRoot) && !candidates.includes(libsUrl)) candidates.push(libsUrl)
  }
```

- [ ] **Step 4:** Run the test file again: PASS. Run `npx vitest run test/scad-handler.test.js`: PASS.

- [ ] **Step 5:** Document the third candidate in `apps/jscad-web/docs/architecture.md` include resolution: order is the including file's directory, the per-suite library root, then `<app origin>/libs/`; app-origin files are fetched once per session (`chainUnchanged`).

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src_frame/scadResolve.js apps/jscad-web/test/scad-resolve.test.js apps/jscad-web/docs/architecture.md
git commit -m "feat(frame): SCAD includes fall back to the app /libs/ tree"
```

### Task 6: JS bare requires of a deployed library resolve to `/libs/`

**Files:**
- Modify: `packages/require/src/resolution/moduleResolver.js` (~48-69) and the cache manager (`packages/require/src/**/cacheManager.ts`) to hold prefix aliases
- Modify: `packages/require/src/index.js` (or the package entry) to export `setLibraryPrefixes`
- Modify: `apps/jscad-web/build.js` (frame.js `define`, ~273-276; compute the library list)
- Modify: `apps/jscad-web/src_frame/frame.js` and `frameHost.js` (~282) to pass `libraries` in `jscadInit` params
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js` (`frameInit`, ~37-41) to install the prefixes
- Test: a new test in `packages/require` beside its existing resolver tests (find them with `ls packages/require/test packages/require/src`), and `apps/jscad-web/test/frame-setup.test.js` if it covers `jscadInit` params

**Model:** `sonnet` — threads one value through four layers.

**Interfaces:**
- Produces: `setLibraryPrefixes(map: Record<string, string>)` exported from `@jscadui/require`, where keys are `'<Library>/'` and values are absolute base URLs (`'https://jscad.rkroll.com/libs/NopSCADlib/'`). `moduleResolver.resolve` checks exact aliases first, then the longest matching prefix, then falls through to `resolveUrl`. Prefixes survive `clearAllCaches()` (they are configuration, like `bundleAlias`; check how `bundleAlias` survives and do the same).
- Produces: build-time `__LIBRARIES__` (JSON array of directory names under `apps/jscad-web/libs/`, sorted) defined on the frame.js bundle; `frameHost` adds `libraries` to every `jscadInit` params object; the worker calls `setLibraryPrefixes(Object.fromEntries(libraries.map((n) => [n + '/', new URL('/libs/' + n + '/', appOrigin).href])))`.

- [ ] **Step 1: Write the failing require test**

```js
import { describe, it, expect, afterEach } from 'vitest'
import { setLibraryPrefixes, moduleResolver } from '../src/index.js' // adjust to the real export paths

afterEach(() => setLibraryPrefixes({}))

describe('library prefixes', () => {
  it('maps a bare specifier under a library name to its base URL', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'https://app.test/libs/NopSCADlib/' })
    const { url } = moduleResolver.resolve('NopSCADlib/vitamins/nuts.scad', 'http://project.local/', 'http://project.local/')
    expect(url).toBe('https://app.test/libs/NopSCADlib/vitamins/nuts.scad')
  })

  it('leaves other bare specifiers on the CDN', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'https://app.test/libs/NopSCADlib/' })
    const { url } = moduleResolver.resolve('lodash/fp.js', 'http://project.local/', 'http://project.local/')
    expect(url).toContain('cdn.jsdelivr.net/npm/lodash/')
  })
})
```

Read `moduleResolver.js` first and shape the assertions to what `resolve` returns (it may return a string or an object).

- [ ] **Step 2:** Run the package tests (`npm test -w @jscadui/require`): new tests FAIL.

- [ ] **Step 3: Implement** the prefix map and lookup:

```js
let libraryPrefixes = []
export const setLibraryPrefixes = (map) => {
  libraryPrefixes = Object.entries(map).sort((a, b) => b[0].length - a[0].length)
}
const viaLibrary = (url) => {
  for (const [prefix, base] of libraryPrefixes) if (url.startsWith(prefix)) return base + url.slice(prefix.length)
  return null
}
```

In `resolve`, after the exact alias lookups miss, `const mapped = viaLibrary(url)`; if set, resolve `mapped` as an absolute URL. Rebuild the package if the app consumes a built bundle (`npm run build -w @jscadui/require`, check its package.json).

- [ ] **Step 4:** Run the package tests: PASS.

- [ ] **Step 5: Wire the frame.** In `apps/jscad-web/build.js`:

```js
const libraries = existsSync('libs')
  ? readdirSync('libs', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : []
```

Add `__LIBRARIES__: JSON.stringify(libraries)` to the frame.js `define`. In frame.js read `const LIBRARIES = __LIBRARIES__` next to `ALLOWED_ORIGIN` and pass it to frameHost the way `allowedOrigin` is passed; frameHost adds `libraries` to the `jscadInit` params. In `bundle.frame-worker.js` `frameInit`, destructure `libraries` and, when `appOrigin` and `libraries` are set, call `setLibraryPrefixes(...)`. If a test (`frame-setup.test.js` or similar) asserts the params object, extend it.

- [ ] **Step 6:** Run `npm test -w @jscadui/jscad-web` (or `npx vitest run` in `apps/jscad-web`): PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/require apps/jscad-web/build.js apps/jscad-web/src_frame
git commit -m "feat(frame): bare requires of a deployed library resolve to /libs/"
```

### Task 7: End-to-end checks and user manual

**Files:**
- Modify: `apps/jscad-web/e2e/frame.spec.js` (two tests near the nested-include test, ~410)
- Create: `apps/jscad-web/examples/parts/nut.scad`, `apps/jscad-web/examples/parts/nut.js`
- Modify: `apps/jscad-web/e2e/smoke-deploy.mjs` (render both examples)
- Create: `apps/jscad-web/docs/user-manual.md`

**Model:** `sonnet` — e2e wiring against existing helpers.

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.

- [ ] **Step 1: Write the e2e tests** in `frame.spec.js` using its `gotoHost` and `load` helpers:

```js
test('a project scad file includes a NopSCADlib nut from /libs/', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, {
    entry: 'main.scad',
    files: { 'main.scad': 'include <NopSCADlib/vitamins/nuts.scad>\nnut(M3_nut);\n' },
  }, { timeoutMs: 120000 })
  expect(res.ok).toBe(true)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})

test('a project js file requires a NopSCADlib nut through its clean export', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, {
    entry: 'main.js',
    files: {
      'main.js': "const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')\nmodule.exports = { main: () => nut(M3_nut) }\n",
    },
  }, { timeoutMs: 120000 })
  expect(res.ok).toBe(true)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})
```

Confirm `nut` and `M3_nut` really come from `vitamins/nuts.scad` (read the file in `libs/NopSCADlib/vitamins/`); if `nut` lives in `nut.scad` included by `nuts.scad`, the include re-export still exposes it.

- [ ] **Step 2:** Run `npx playwright test e2e/frame.spec.js -g "NopSCADlib"` in `apps/jscad-web`. It must PASS (Tasks 4-6 are in). If it fails, debug with `e2e/page-console.mjs`; do not loosen the assertions.

- [ ] **Step 3: Examples for the live smoke.** `examples/parts/nut.scad`:

```scad
include <NopSCADlib/vitamins/nuts.scad>
nut(M3_nut, nyloc = true);
```

`examples/parts/nut.js`:

```js
const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')

const main = () => nut(M3_nut, { nyloc: true })

module.exports = { main }
```

Check how the examples are tested (`scripts/test-all.js`, `TESTING.md`, `ALL.js` grid generation in `examples/generator.config.json`). If any of them would run `examples/parts/` without `/libs/` resolution, exclude the directory there with the existing `skip.txt`/`exclude.txt` mechanism and say why in one line.

- [ ] **Step 4:** In `smoke-deploy.mjs`, add `#/examples/parts/nut.scad` and `#/examples/parts/nut.js` to the rendered list, with the same `data-render`/`data-vertices` checks as `cube.scad`. Do not run it against the live host; that needs a deploy, which the controller raises with the user.

- [ ] **Step 5:** Write `apps/jscad-web/docs/user-manual.md` with a first section "Using OpenSCAD libraries": `include <NopSCADlib/...>` / `use <...>` from `.scad`; `require('NopSCADlib/vitamins/nuts.scad')` from `.js`; the clean export calling rules (positional, trailing named object, `$` keys, `children`, getters, `fn`/`vars`, `$meta`, reserved names); which libraries are deployed. Link it from `apps/jscad-web/README.md` if that README links docs.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/e2e apps/jscad-web/examples/parts apps/jscad-web/docs/user-manual.md apps/jscad-web/README.md
git commit -m "test(jscad-web): include and require a NopSCADlib nut from /libs/"
```

---

## Phase 3: `packages/parts` (spec step 3)

### Task 8: Package scaffold, loader and derivation

**Files:**
- Modify: `packages/openscad/bin/run-jscad.js` (add an exported `requireScadSync`, leave `evalScadSolidSync` untouched)
- Create: `packages/parts/package.json`, `packages/parts/README.md`
- Create: `packages/parts/src/load.js`, `packages/parts/src/derive.js`
- Create: `packages/parts/test/fixtures/libs/Mini/mini.scad`, `packages/parts/test/load.test.js`, `packages/parts/test/derive.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Produces in run-jscad.js: `requireScadSync(scadPath, ctx, { libPaths = [] } = {}) → { exports, j$ }`. Same body as `evalScadSolidSync` lines 657-668 up to running the module, returning `moduleObj.exports` and the `j$Instance` instead of calling `main`.
- Produces in `src/load.js`:
  - `LIBS_DIR` = absolute path of `apps/jscad-web/libs` (overridable by env `JSCAD_LIBS_DIR`).
  - `async loadEntry(record, { libsDir = LIBS_DIR } = {}) → { exports, j$, transpileMs }` — resolves `record.file` under `libsDir` (or its `_catalog` shim, Task 11), runs `initScadRuntime()`, then `requireScadSync(path, ctx, { libPaths: [libsDir] })`. `libPaths` mirrors the frame: relative first, then the libs root.
  - `async buildPart(loaded, record, args) → { geometry, buildMs }` — calls `loaded.exports[record.call](...args)` where each string arg naming an export variable is replaced by `loaded.exports.vars[name]`.
- Produces in `src/derive.js`:
  - `signature(exports, call) → { params: [{name, default?}] }` from `exports.$meta` (module entry preferred, then function).
  - `sizeNames(exports, sizes) → string[]` — for `{ list: 'nuts' }`, every key of `exports.vars` whose value is `===` an element of `exports.vars.nuts`, in list order; for `{ values: [...] }`, the values.

- [ ] **Step 1:** `packages/parts/package.json`:

```json
{
  "name": "@jscadui/parts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "check": "node bin/check.js",
    "render": "node bin/render.js",
    "build": "node bin/build.js"
  },
  "devDependencies": {
    "@jscadui/openscad": "*",
    "@jscadui/openscad-runtime": "*",
    "vitest": "^4"
  }
}
```

Match the versions and workspace-dependency style used by sibling packages (look at `packages/agent-loop/package.json`). Run `npm install` at the root so the workspace links.

- [ ] **Step 2: Fixture library** `packages/parts/test/fixtures/libs/Mini/mini.scad`:

```scad
M2_block = [2, 4];
M3_block = [3, 6];
blocks = [M2_block, M3_block];

module block(type, tall = false) {
  cube([type[1], type[1], tall ? 2 * type[0] : type[0]]);
}
```

- [ ] **Step 3: Write the failing tests**

```js
// packages/parts/test/load.test.js
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadEntry, buildPart } from '../src/load.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const record = { id: 'mini/block', file: 'Mini/mini.scad', call: 'block', sizes: { list: 'blocks' } }

describe('loadEntry', () => {
  it('requires a library file and exposes its clean exports', async () => {
    const loaded = await loadEntry(record, { libsDir })
    expect(typeof loaded.exports.block).toBe('function')
    expect(loaded.exports.vars.M3_block).toEqual([3, 6])
  })

  it('builds a part with size names resolved to their values', async () => {
    const loaded = await loadEntry(record, { libsDir })
    const { geometry } = await buildPart(loaded, record, ['M3_block', { tall: true }])
    expect(geometry).toBeTruthy()
  })
})
```

```js
// packages/parts/test/derive.test.js
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadEntry } from '../src/load.js'
import { signature, sizeNames } from '../src/derive.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const record = { id: 'mini/block', file: 'Mini/mini.scad', call: 'block', sizes: { list: 'blocks' } }

describe('derive', () => {
  it('reads the signature from $meta', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(signature(exports, 'block')).toEqual({ params: [{ name: 'type' }, { name: 'tall', default: 'false' }] })
  })

  it('names sizes by identity with the list elements', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(sizeNames(exports, { list: 'blocks' })).toEqual(['M2_block', 'M3_block'])
  })

  it('passes listed size values through', async () => {
    const { exports } = await loadEntry(record, { libsDir })
    expect(sizeNames(exports, { values: ['M2', 'M3'] })).toEqual(['M2', 'M3'])
  })
})
```

- [ ] **Step 4:** Run `npx vitest run` in `packages/parts`: FAIL (modules missing).

- [ ] **Step 5: Implement.** Add `requireScadSync` to run-jscad.js:

```js
export function requireScadSync(scadPath, ctx, { fn = 0, libPaths = [], sharedCache } = {}) {
  const { jscadModeling, openscadRuntime } = ctx
  const inputPath = resolve(scadPath)
  const fileDir = dirname(inputPath)
  const source = decodeScadSource(readFileSync(inputPath))
  const { code, moduleCache } = transpileScad(source, inputPath, fileDir, fn, false, libPaths, sharedCache)
  const j$Instance = createJ$Instance()
  j$Instance.jscad = jscadModeling
  const customRequire = createMakeRequire(jscadModeling, openscadRuntime, moduleCache, fn, libPaths, sharedCache, j$Instance)(fileDir)
  const moduleObj = { exports: {} }
  new Function('require', 'module', 'exports', 'j$', code)(customRequire, moduleObj, moduleObj.exports, j$Instance)
  return { exports: moduleObj.exports, j$: j$Instance }
}
```

`src/load.js`:

```js
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { initScadRuntime, requireScadSync } from '../../openscad/bin/run-jscad.js'

export const LIBS_DIR = process.env.JSCAD_LIBS_DIR ?? fileURLToPath(new URL('../../../apps/jscad-web/libs/', import.meta.url))

const resolveArg = (exports, arg) => (typeof arg === 'string' && arg in exports.vars ? exports.vars[arg] : arg)

export const entryPath = (record, libsDir) => join(libsDir, record.prelude ? `_catalog/${record.file}` : record.file)

export async function loadEntry(record, { libsDir = LIBS_DIR } = {}) {
  const ctx = await initScadRuntime()
  const start = performance.now()
  const { exports, j$ } = requireScadSync(entryPath(record, libsDir), ctx, { libPaths: [libsDir] })
  return { exports, j$, ctx, transpileMs: performance.now() - start }
}

export async function buildPart(loaded, record, args) {
  const start = performance.now()
  const geometry = loaded.exports[record.call](...args.map((a) => resolveArg(loaded.exports, a)))
  return { geometry, buildMs: performance.now() - start }
}
```

`transpileMs` covers transpile plus loading the module; name it that way in docs. `src/derive.js`:

```js
export const signature = (exports, call) => {
  const entry = exports.$meta.find((e) => e.name === call && e.kind === 'module') ?? exports.$meta.find((e) => e.name === call && e.kind === 'function')
  if (!entry) throw new Error(`${call} is not exported`)
  return { params: entry.params ?? [] }
}

export const sizeNames = (exports, sizes) => {
  if (sizes.values) return [...sizes.values]
  const list = exports.vars[sizes.list]
  if (!Array.isArray(list)) throw new Error(`${sizes.list} is not a list`)
  const names = Object.keys(exports.vars).filter((k) => k !== sizes.list && list.includes(exports.vars[k]))
  return names.sort((a, b) => list.indexOf(exports.vars[a]) - list.indexOf(exports.vars[b]))
}
```

- [ ] **Step 6:** Run `npx vitest run` in `packages/parts`: PASS. Also `npx vitest run` in `packages/openscad`: PASS (run-jscad change is additive).

- [ ] **Step 7:** `packages/parts/README.md`: what the package is (vetted catalog of library parts), that a `/libs/` library changes only when its pin moves in `scripts/deps/manifest.json` and the `ci/parts` job gates that commit, the record format (copy the spec's record and field list, plus `prelude` and nullable `size` axes from Task 10), the commands (`check`, `render`, `build`), and how an entry is admitted. Keep it short.

- [ ] **Step 8: Commit**

```bash
git add packages/openscad/bin/run-jscad.js packages/parts package-lock.json
git commit -m "feat(parts): package scaffold, library loader and signature/size derivation"
```

### Task 9: `bin/check.js` — dimension checks, size sweep, timings

**Files:**
- Create: `packages/parts/src/records.js`, `packages/parts/src/measure.js`, `packages/parts/bin/check.js`
- Create: `packages/parts/test/fixtures/catalog/mini/block.json`, `packages/parts/test/check.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Produces `src/records.js`: `CATALOG_DIR`, `readRecords(dir = CATALOG_DIR) → Record[]` (walks `catalog/<library>/<entry>.json`, sorted by `id`, validates required fields: `id, family, library, license, file, call, summary, sizes, example, checks`; throws naming the file on a missing field).
- Produces `src/measure.js`: `boundingSize(geometry, ctx) → [x, y, z]`, flattening arrays, dropping `previewOnly` ghosts (reuse `exportedGeometry` from run-jscad), using `ctx.jscadModeling.measurements.measureAggregateBoundingBox`. If the manifold runtime lacks `measurements`, convert with `manifoldToGeom3` (exported by run-jscad) and measure with `@jscad/modeling`. Also `isEmpty(geometry, ctx) → boolean`.
- Produces `bin/check.js`: `async checkRecord(record, opts) → { id, ok, failures: string[], measured: [{ args, size }], sizes: string[], signature, transpileMs, buildMs: { max, mean } }` and CLI:
  - `node bin/check.js <id>...` or `--all`; `--catalog <dir>`, `--libs <dir>` overrides; `--write` merges results into `packages/parts/derived.json` (keyed by id, keys sorted, two-space JSON, trailing newline).
  - Exit code 1 if any record fails.
- Record extension: an axis in `checks[].size` may be `null` to skip it (e.g. stepper shaft length).

- [ ] **Step 1: Fixture record** `test/fixtures/catalog/mini/block.json`:

```json
{
  "id": "mini/block",
  "family": "block",
  "library": "Mini",
  "license": "MIT",
  "file": "Mini/mini.scad",
  "call": "block",
  "summary": "Test block.",
  "sizes": { "list": "blocks" },
  "options": { "tall": "double height" },
  "example": "block(M3_block, {tall: true})",
  "checks": [
    { "args": ["M3_block"], "size": [6, 6, 3], "tol": 0.01, "source": "fixture" },
    { "args": ["M3_block", { "tall": true }], "size": [6, null, 6], "tol": 0.01, "source": "fixture" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```js
// packages/parts/test/check.test.js
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readRecords } from '../src/records.js'
import { checkRecord } from '../bin/check.js'

const libsDir = fileURLToPath(new URL('./fixtures/libs/', import.meta.url))
const catalogDir = fileURLToPath(new URL('./fixtures/catalog/', import.meta.url))

describe('checkRecord', () => {
  it('passes a record whose bounding boxes match', async () => {
    const [record] = readRecords(catalogDir)
    const result = await checkRecord(record, { libsDir })
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.sizes).toEqual(['M2_block', 'M3_block'])
    expect(result.measured[0].size).toEqual([6, 6, 3])
    expect(result.transpileMs).toBeGreaterThan(0)
  })

  it('reports a bounding box outside tolerance', async () => {
    const [record] = readRecords(catalogDir)
    const bad = { ...record, checks: [{ args: ['M3_block'], size: [6, 6, 4], tol: 0.01, source: 'fixture' }] }
    const result = await checkRecord(bad, { libsDir })
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/M3_block.*z.*3.*4/)
  })

  it('reports a size that builds empty geometry', async () => {
    const [record] = readRecords(catalogDir)
    const bad = { ...record, sizes: { values: ['nope'] } }
    const result = await checkRecord(bad, { libsDir })
    expect(result.ok).toBe(false)
    expect(result.failures.some((f) => f.includes('nope'))).toBe(true)
  })
})
```

- [ ] **Step 3:** Run `npx vitest run test/check.test.js`: FAIL.

- [ ] **Step 4: Implement** `records.js`, `measure.js` and `check.js`. `checkRecord` loads the entry once (`loadEntry`), derives `signature` and `sizeNames`, builds each `checks[].args` and compares per axis (`Math.abs(measured - expected) > tol` → failure message `"<id> <args> <axis>: measured <m>, expected <e> (<source>)"`, with numbers rounded to 3 places), then builds every size name once as the sole argument and records a failure when it throws or `isEmpty`. `check.js` guards its CLI with an `import.meta.url === pathToFileURL(process.argv[1]).href` check so the test can import it.

- [ ] **Step 5:** Run `npx vitest run`: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/parts
git commit -m "feat(parts): check.js measures each entry against its standard and sweeps every size"
```

### Task 10: `bin/render.js` — thumbnails

**Files:**
- Create: `packages/parts/src/triangles.js`, `packages/parts/bin/render.js`
- Test: `packages/parts/test/triangles.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Consumes: `createRenderer` from `packages/agent-loop/eval/render.js` (`render(parts, dir)` writes `iso-front.png`, `iso-back.png`, `side.png`, `top.png` and returns `[{ name, path, sha256 }]`; `close()`). Parts are `[{ color: [r,g,b] | null, positions: Float32Array }]`, 9 floats per triangle.
- Produces: `toRenderParts(geometry, ctx) → parts` in `src/triangles.js` (geom3 polygons via `geom3.toPolygons`, fan-triangulated, one part per geometry with its `color` if set); `bin/render.js [<id>...|--all]` writes `packages/parts/thumbs/<id>.png` (id `nopscadlib/nut` → `thumbs/nopscadlib/nut.png`) from the `iso-front` view of the first check's args.

- [ ] **Step 1: Write the failing test**

```js
// packages/parts/test/triangles.test.js
import { describe, it, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { toRenderParts } from '../src/triangles.js'

describe('toRenderParts', () => {
  it('turns a cube into 12 triangles', () => {
    const [part] = toRenderParts(modeling.primitives.cube({ size: 2 }), { jscadModeling: modeling })
    expect(part.positions.length).toBe(12 * 9)
  })

  it('keeps one part per geometry with its colour', () => {
    const red = modeling.colors.colorize([1, 0, 0], modeling.primitives.cube())
    const parts = toRenderParts([red, modeling.primitives.cube()], { jscadModeling: modeling })
    expect(parts).toHaveLength(2)
    expect(parts[0].color.slice(0, 3)).toEqual([1, 0, 0])
  })
})
```

Add `@jscad/modeling` to devDependencies if not hoisted.

- [ ] **Step 2:** Run it: FAIL.
- [ ] **Step 3: Implement** `triangles.js` (convert manifold-backed solids with `manifoldToGeom3` first when `ctx` is the manifold runtime) and `render.js` (load, build first check, `toRenderParts`, render into a temp dir under `os.tmpdir()`, copy `iso-front.png` to `thumbs/<id>.png`, close the renderer in `finally`).
- [ ] **Step 4:** Run `npx vitest run`: PASS. If Chromium is installed (`npx playwright install chromium` done before), run `node bin/render.js --catalog test/fixtures/catalog --libs test/fixtures/libs --out /tmp/claude-1000/thumbs mini/block` and Read the PNG to confirm a visible block. Support `--out` for that.
- [ ] **Step 5: Commit**

```bash
git add packages/parts
git commit -m "feat(parts): render.js writes a thumbnail per entry"
```

### Task 11: `bin/build.js` — shims and `catalog.json`; app build wiring

**Files:**
- Create: `packages/parts/src/shims.js`, `packages/parts/bin/build.js`
- Modify: `apps/jscad-web/build.js` (call the parts build before the `libs` copy; copy thumbs)
- Modify: `packages/parts/src/load.js` (call `writeShims` before loading when a record has `prelude`)
- Test: `packages/parts/test/build.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Produces `src/shims.js`: `shimSource(record) → string` (`include <p>` per prelude entry, then `include <file>`, newline-terminated) and `writeShims(records, libsDir)` writing `libsDir/_catalog/<record.file>` for each record with `prelude`.
- Produces `bin/build.js`: `buildCatalog(records, derived) → { entries: [...] }` where each entry is the record plus `signature`, `sizeNames`, `measured`, `transpileMs`, `buildMs` from `derived[id]` and `thumb: 'thumbs/<id>.png'`, plus `require: '<path>'` (the `_catalog/` shim path when `prelude`, else `file`) and `scadIncludes: [...prelude, file]`. Entries are ordered by family, preferred first, then id. Records missing from `derived` are left out with a warning on stderr. CLI: `node bin/build.js --out <dir>` writes `<dir>/catalog.json` and copies `thumbs/` to `<dir>/thumbs/`, and always calls `writeShims(records, LIBS_DIR)`.
- `apps/jscad-web/build.js`: import `buildParts` from `../../packages/parts/bin/build.js` (export a function the CLI also uses) and call it with `outDir + '/parts'` before copying `libs`, so shims are copied too. Parts browser fetches `<app>/parts/catalog.json`.

- [ ] **Step 1: Write the failing test**

```js
// packages/parts/test/build.test.js
import { describe, it, expect } from 'vitest'
import { buildCatalog } from '../bin/build.js'
import { shimSource } from '../src/shims.js'

const rec = (over) => ({ id: 'a/nut', family: 'nut', library: 'A', license: 'MIT', file: 'A/nuts.scad', call: 'nut', summary: '', sizes: { values: ['M3'] }, example: '', checks: [], ...over })
const derived = { 'a/nut': { signature: { params: [] }, sizes: ['M3'], measured: [], transpileMs: 1, buildMs: { max: 1, mean: 1 } }, 'b/nut': { signature: { params: [] }, sizes: [], measured: [], transpileMs: 1, buildMs: { max: 1, mean: 1 } } }

describe('buildCatalog', () => {
  it('puts the preferred entry of a family first', () => {
    const { entries } = buildCatalog([rec(), rec({ id: 'b/nut', library: 'B', preferred: true })], derived)
    expect(entries.map((e) => e.id)).toEqual(['b/nut', 'a/nut'])
  })

  it('leaves out an entry with no derived data', () => {
    const { entries } = buildCatalog([rec({ id: 'c/nut' })], derived)
    expect(entries).toEqual([])
  })

  it('points JS at the shim when the record has a prelude', () => {
    const { entries } = buildCatalog([rec({ prelude: ['A/std.scad'] })], derived)
    expect(entries[0].require).toBe('_catalog/A/nuts.scad')
    expect(entries[0].scadIncludes).toEqual(['A/std.scad', 'A/nuts.scad'])
  })
})

describe('shimSource', () => {
  it('includes the prelude then the file', () => {
    expect(shimSource(rec({ prelude: ['A/std.scad'] }))).toBe('include <A/std.scad>\ninclude <A/nuts.scad>\n')
  })
})
```

- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Run: PASS. Run a dev build of the app once (as in Task 4 step 4) and confirm `<outDir>/parts/catalog.json` exists (empty `entries` until Task 12 lands).
- [ ] **Step 5: Commit**

```bash
git add packages/parts apps/jscad-web/build.js
git commit -m "feat(parts): build.js writes catalog.json and library shims; the app build calls it"
```

### Task 12: First entries and the CI job

**Files:**
- Create: `packages/parts/catalog/nopscadlib/{nut,screw,washer,ball_bearing,nema}.json`
- Create: `packages/parts/catalog/bosl2/{nut,screw,ball_bearing,nema_stepper_motor}.json`
- Create: `ci/parts`
- Modify: `ci/README.md` (job table), `TESTING.md` (sci job list ~454-456)

**Model:** `opus` — needs standards research and judgment about mismatches.

**Interfaces:**
- Consumes: all of `packages/parts`.
- Produces: nine records; `ci/parts` runs `bootstrap sources install deps`, builds `@jscadui/openscad`, runs `node packages/parts/bin/check.js --all --write` and `node packages/parts/bin/render.js --all`, and leaves `packages/parts/derived.json` and `packages/parts/thumbs/` for `sci artifact`.

- [ ] **Step 1:** For each library file, read the module or function signature and the size list in `apps/jscad-web/libs/`. Write each record with real values:
  - `file` is the file a user includes (for NopSCADlib, the plural `vitamins/<x>s.scad` that defines the size constants and pulls in the module); `call` the module name; `sizes.list` the library's list variable (`nuts`, `screws`, `washers`, `ball_bearings`?, `NEMA_motors`? — use the real names) or `sizes.values` for BOSL2 spec strings (`["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"]`).
  - BOSL2 records carry `"prelude": ["BOSL2/std.scad"]` unless the file includes `std.scad` itself. BOSL2's bearing and stepper modules live in `BOSL2/ball_bearings.scad` and `BOSL2/nema_steppers.scad`; confirm.
  - `license`: `"GPL-3.0"` for NopSCADlib, `"BSD-2-Clause"` for BOSL2.
  - `checks`: at least one per record, dimensions from the standard named in `source`: ISO 4032 M3 nut (s = 5.5 across flats, m = 2.4; across corners 5.5/cos 30° = 6.35), ISO 7089 M3 washer (d2 = 7, h = 0.5), ISO 4762 M3×10 socket head (dk = 5.5, k = 3, total length 13), 608 bearing (22 × 22 × 7), NEMA 17 face 42.3 × 42.3 (z `null` where shaft/body length depends on the model). Default orientation as the library builds it.
  - `preferred` is left out; it is set in Task 13.
- [ ] **Step 2:** Run `node packages/parts/bin/check.js nopscadlib/nut` locally (one entry is allowed locally). Expected: pass. When a check fails, find out whether the library models a different standard value or the transpiler is wrong: compare with OpenSCAD itself (`openscad -o /tmp/claude-1000/x.stl` on a two-line file that includes the part, then read the bounding box). Record the true reason in the report. Never widen `tol` to make a check pass; a library that models a different value gets a `source` naming what it models.
- [ ] **Step 3:** Write `ci/parts` following `ci/test`:

```bash
#!/usr/bin/env bash
set -euo pipefail
WORKTREE="$(cd "$(dirname "$0")/.." && pwd)"
. "$WORKTREE/ci/lib/bootstrap.sh"
bootstrap sources install deps
npm run build -w @jscadui/openscad
cd "$WORKTREE/packages/parts"
node bin/check.js --all --write
node bin/render.js --all
```

`chmod +x ci/parts`. Add it to the job table in `ci/README.md` and the job list in `TESTING.md`.
- [ ] **Step 4:** Run `npx vitest run` in `packages/parts`: PASS.
- [ ] **Step 5: Stop.** Do not commit; the controller runs CI and the thumbnail review in Task 13. Report the records written, local check output, and any mismatch findings.

### Task 13 (controller): CI run, thumbnail review, admission

- [ ] Run `sci push jscadui/parts` then `sci wait JOB` under `run_in_background`.
- [ ] Fetch `packages/parts/derived.json` and `packages/parts/thumbs/` with `sci artifact`.
- [ ] Show the user every thumbnail and the per-entry transpile/build times; propose `preferred` per family (permissive and acceptable browser time first). The user decides. An entry is admitted only after the user has looked at its thumbnail.
- [ ] Set `preferred` in the records, drop any entry the user rejects, then commit records, `derived.json`, thumbs, `ci/parts` and the doc edits: `feat(parts): first catalog entries for nuts, screws, washers, bearings and steppers`.

---

## Phase 4: Suffixed names move under `$scad` (spec step 4)

### Task 14: Transpiler commit 2

**Files:**
- Modify: `packages/openscad/src/transpiler/transpile.ts` (export line ~641-668, forwarders ~526-550, `declareMissingSymbols` ~818-844)
- Modify: `packages/openscad/src/transpiler/cleanExports.ts` (`exportCleanLine` reads `exports.$scad`)
- Modify: tests that read suffixed names from the runtime exports object (`test/duplicate-definitions.test.ts:26-37`, `test/clean-exports.test.ts` "keeps the suffixed exports" case) and the snapshot
- Modify: `packages/openscad/ARCHITECTURE.md`, `apps/jscad-web/docs/user-manual.md` (mention `$scad` as the raw surface)

**Model:** `opus`.

**Interfaces:**
- Produces: emitted tail becomes

```js
Object.assign(exports, { $scad: { washer_$m, area_$f, area_$f$obj, M3_washer, layer_height, ...includeReExports }, ...customizerExports, main })
j$.exportClean(exports, exports.$scad, [...])
```

  Forwarders become `var x_$m = (...a) => _nsN.$scad?.x_$m?.(...a)`; an empty-symbol `use` still binds the namespace. `transpile()`'s returned `exports` array and `TranspiledFile.exports` keep the suffixed names; they describe what lives in `$scad`.
- Exploration found no reader of suffixed names outside `packages/openscad` (only stack-trace text in `apps/jscad-web/e2e/render-*-baseline.json`). Re-run `grep -rn '_\$m\|_\$f' apps packages --include=*.js --include=*.mjs --include=*.ts -l` excluding `node_modules`, `esm`, `packages/openscad/src` and `packages/openscad/test` before the change, and list the result in the report.

- [ ] **Step 1: Write failing tests** in `test/clean-exports.test.ts`:

```ts
it('keeps the suffixed exports under $scad only', () => {
  const { exports } = load({ '/main.scad': SRC })
  expect(typeof exports.$scad.washer_$m).toBe('function')
  expect(exports.washer_$m).toBeUndefined()
  expect(typeof exports.main).toBe('function')
})

it('forwards optimized-include calls through $scad', () => {
  const files = {
    '/pure.scad': 'module nut(d = 3) cylinder(d = d, h = 2); function half(x) = x / 2;',
    '/main.scad': 'include <pure.scad>\nx = half(8);\nnut();',
  }
  const { exports } = load(files)
  expect(exports.x).toBe(4)
  expect(exports.main()).toBeTruthy()
})

it('forwards use calls through $scad', () => {
  const files = {
    '/pure.scad': 'function half(x) = x / 2;',
    '/main.scad': 'use <pure.scad>\nx = half(8);',
  }
  expect(load(files).exports.x).toBe(4)
})
```

Delete the Phase 1 "keeps the suffixed exports beside the clean ones" case.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement; make `declareMissingSymbols` recognise names inside the nested `$scad: { ... }` object exactly as it did the flat list. **Step 4:** `npx vitest run`: all pass after reviewing and updating snapshots and fixing the tests that read `exports.x_$f` at runtime. Text assertions on emitted code (`Object.assign(exports, {...only_$f...})` in `undefined-symbols.test.ts:42-57`) are updated to the new shape. **Step 5:** `npm run build -w @jscadui/openscad`; rerun `node packages/parts/bin/check.js nopscadlib/nut`: PASS. Update docs.
- [ ] **Step 6: Stop.** No commit.

### Task 15 (controller): GPU run, parts CI, commit

- [ ] `npm test` in `packages/openscad` (background) and `sci push jscadui/parts` (background). Both green; parts `derived.json` unchanged except timings.
- [ ] New `Latest GPU run` section in `MODEL_COMPARISON_BASELINE.md` ("suffixed exports under $scad"). Commit: `refactor(openscad): suffixed exports move under $scad`.

---

## Phase 5: Agent (spec step 5)

### Task 16: Move the scad handler into `packages/agent-loop`

**Files:**
- Move: `apps/jscad-web/src_frame/scadHandler.js` → `packages/agent-loop/src/scadHandler.js`
- Move: `apps/jscad-web/src_frame/scadResolve.js` → `packages/agent-loop/src/scadResolve.js`
- Move: `apps/jscad-web/test/scad-handler.test.js`, `apps/jscad-web/test/scad-resolve.test.js` → `packages/agent-loop/test/`
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js` and any other importer (import the same way `fileMap.js` imports `projectUrl.js`)
- Modify: `apps/jscad-web/docs/architecture.md` paths

**Model:** `sonnet` — a move with import updates.

**Interfaces:**
- Produces: `createScadHandler({ getOpenscad, getAppOrigin, now })` and `includeCandidates(...)` importable from `@jscadui/agent-loop/src/scadHandler.js` / `scadResolve.js` (or re-exported from the package `index.js`; follow how `projectUrl.js` is consumed).

- [ ] **Step 1:** `git mv` the four files. Fix the handler's `PROJECT_BASE` import to `./projectUrl.js`.
- [ ] **Step 2:** Update importers. Run `npx vitest run` in `packages/agent-loop` and `apps/jscad-web`: PASS.
- [ ] **Step 3:** Run `npx playwright test e2e/frame.spec.js -g "include|NopSCADlib"` in `apps/jscad-web`: PASS.
- [ ] **Step 4: Commit** `refactor: scad require handler moves to agent-loop so the eval can share it`.

### Task 17: Eval executor `.scad` support

**Files:**
- Modify: `packages/agent-loop/eval/backend.js` (register the handler; libs prefixes; readFile for libs)
- Modify: `packages/agent-loop/eval/sandbox.js` (~42: bind `apps/jscad-web/libs` read-only)
- Modify: `packages/agent-loop/package.json` (devDependencies `@jscadui/openscad`, `@jscadui/openscad-runtime`)
- Test: `packages/agent-loop/eval/scad-backend.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Consumes: `createScadHandler` (Task 16), `setLibraryPrefixes` (Task 6), `requireHandlers` from `@jscadui/require/esm/index.js`, `parse`/`transpile` from `@jscadui/openscad`, `j$` from `@jscadui/openscad-runtime`.
- Produces: in the eval, `APP_ORIGIN = 'http://app.local'`; `setLibraryPrefixes` maps each directory in `LIBS_DIR` (env `JSCAD_LIBS_DIR`, default `apps/jscad-web/libs` resolved from the repo root) to `http://app.local/libs/<name>/`; the eval read-file serves `http://app.local/libs/<path>` from `LIBS_DIR/<path>` (refusing paths that escape it). `getOpenscad` returns `{ parse, transpile, j$ }` after `j$.init(<the modeling runtime the eval uses>)` and sets `globalThis.j$` the way `bundle.frame-worker.js:41-73` does.

- [ ] **Step 1: Write the failing test** (uses the parts fixture library so it needs no fetched corpus):

```js
// packages/agent-loop/eval/scad-backend.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'

process.env.JSCAD_LIBS_DIR = fileURLToPath(new URL('../../parts/test/fixtures/libs/', import.meta.url))
let createEvalBackend
beforeAll(async () => { ({ createEvalBackend } = await import('./backend.js')) })

describe('eval backend .scad support', () => {
  it('runs a js project that requires a library part', async () => {
    const backend = createEvalBackend()
    const files = { 'main.js': "const { block, M3_block } = require('Mini/mini.scad')\nmodule.exports = { main: () => block(M3_block) }\n" }
    const result = await backend.measure({ files })
    expect(result.dimensions).toEqual([6, 6, 3])
  })

  it('runs a project scad file that includes a library part', async () => {
    const backend = createEvalBackend()
    const files = { 'main.js': "module.exports = require('./part.scad')\n", 'part.scad': 'include <Mini/mini.scad>\nblock(M2_block);\n' }
    const result = await backend.measure({ files })
    expect(result.dimensions).toEqual([4, 4, 2])
  })
})
```

Read `backend.js` and `eval/api.test.js` first and adapt the calls to the backend's real API (its tool methods and how files are passed); keep the two behaviors.
- [ ] **Step 2:** Run `npx vitest run eval/scad-backend.test.js`: FAIL. **Step 3:** Implement. **Step 4:** Run: PASS; then the whole package `npm test -w @jscadui/agent-loop`: PASS. If `eval/sandbox-crt.test.js` runs locally, run it too.
- [ ] **Step 5:** Document in `packages/agent-loop/docs/user-manual.md` (eval section, ~318-460) that model code may require library `.scad` files, served from `apps/jscad-web/libs` (`JSCAD_LIBS_DIR`).
- [ ] **Step 6: Commit** `feat(eval): the executor runs .scad requires and resolves /libs/ from disk`.

### Task 18: Parts docs entries and the Parts prompt block

**Files:**
- Modify: `packages/parts/bin/build.js` (also write `packages/agent-loop/api/parts.json` and `packages/agent-loop/prompt/parts.md`)
- Modify: `packages/agent-loop/api/build-index.js` (append `api/parts.json` entries in `buildIndex()`)
- Modify: `packages/agent-loop/src/docs.js` (`PARTS` package, family lookup, `renderPart`)
- Modify: `packages/agent-loop/prompt/index.js`, `packages/agent-loop/src/prompt.js` (Parts block after the sheet)
- Regenerate: `packages/agent-loop/api/index.json`, `api/optionTable.js` (via `npm run api-index`)
- Test: `packages/agent-loop/test/docs.test.js` (new describe "parts"), `test/prompt.test.js`, `packages/parts/test/agent-outputs.test.js` (fresh-generation check)

**Model:** `sonnet`.

**Interfaces:**
- Produces: docs entries `{ name: 'parts.<library-lower>.<call>', pkg: '@jscadui/parts', kind: 'part', family, preferred, description: summary, require: "const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')", scad: 'include <NopSCADlib/vitamins/nuts.scad>', signature: 'nut(type, horizontal = false, ...)', sizes: [...], options: {...}, license, measured: [{ args, size }], example }`.
- Produces: `docs('nut')` → every entry whose `family` or `call` equals the query (case-insensitive), preferred first, rendered by `renderPart`; querying an entry `name` returns that one. Parts entries are visible to both APIs (add the package to the `own` filter beside `TEXT`).
- Produces: `prompt/parts.md` — `## Parts`, one line per family with the preferred entry's require line and call, then the three rules from spec section 4, verbatim in meaning: use a catalog part for standard hardware instead of modeling it; prefer a permissive license when two parts are equivalent; never copy library files into the project.

- [ ] **Step 1: Failing docs test** (in `test/docs.test.js`; build a small index inline so the test does not depend on catalog contents):

```js
describe('parts', () => {
  const part = (over) => ({ name: 'parts.a.nut', pkg: '@jscadui/parts', kind: 'part', family: 'nut', description: 'Hex nut.', require: "const { nut, M3_nut } = require('A/nuts.scad')", scad: 'include <A/nuts.scad>', signature: 'nut(type)', sizes: ['M3_nut'], options: {}, license: 'MIT', measured: [{ args: ['M3_nut'], size: [6.35, 5.5, 2.4] }], example: 'nut(M3_nut)', ...over })
  const index = [part(), part({ name: 'parts.b.nut', preferred: true, license: 'GPL-3.0', require: "const { nut } = require('B/nuts.scad')" })]

  it('answers a family name with every entry, preferred first', () => {
    const text = lookupDocs(index, 'nut', { api: 'modeling' }).text
    expect(text.indexOf('parts.b.nut')).toBeLessThan(text.indexOf('parts.a.nut'))
    expect(text).toContain("require('A/nuts.scad')")
    expect(text).toContain('MIT')
    expect(text).toContain('6.35')
  })

  it('answers in both APIs', () => {
    expect(lookupDocs(index, 'nut', { api: 'fluent' }).ok).toBe(true)
  })
})
```

Check the real return shape of `lookupDocs` (it returns `{ ok, text }` per the exploration).
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement `renderPart` (lines: `name (license)`, summary, require line, SCAD include, signature, sizes joined, options with meanings, measured `args → [x, y, z] mm`, example) and the family branch at the top of `lookupOne` after the special queries. **Step 4:** Run: PASS.
- [ ] **Step 5:** Extend `parts/bin/build.js` to write `api/parts.json` and `prompt/parts.md`; make `build-index.js` append `parts.json`; wire `PARTS` through `prompt/index.js` and append it after the sheet in `assemblePrompt` (keep the signature change minimal and update its callers/tests). Run `node packages/parts/bin/build.js --out /tmp/claude-1000/parts` then `npm run api-index -w @jscadui/agent-loop`.
- [ ] **Step 6:** Add `packages/parts/test/agent-outputs.test.js`: regenerating `parts.json` and `parts.md` in memory equals the committed files. Run all tests in `packages/parts` and `packages/agent-loop` (`api-index.test.js` freshness, `prompt.test.js` slot check, `sheet.test.js` budget): PASS.
- [ ] **Step 7:** Document the parts docs and prompt block in `packages/agent-loop` docs where the docs tool is described.
- [ ] **Step 8: Commit** `feat(agent): parts entries in docs and a generated Parts prompt block`.

### Task 19: Eval fixtures

**Files:**
- Create: `packages/agent-loop/eval/fixtures/nema17-mount.js`, `packages/agent-loop/eval/fixtures/bearing-holder-608.js`
- Modify: `packages/agent-loop/eval/fixtures.test.js` (reference models)

**Model:** `sonnet`.

**Interfaces:**
- Consumes: `probe.js` (`holeLoops`, `footprint`), the pattern in `fixtures/bracket-m5.js`, `checks(m, { solid, probe, source })`.
- Produces:
  - `nema17-mount`: prompt "A mounting plate for a NEMA 17 stepper motor with M3 screws holding the motor on". Checks: the source requires or includes a catalog stepper (`/require\(['"](NopSCADlib|_catalog\/BOSL2|BOSL2)\/[^'"]*(stepper|nema)/i` or the SCAD include equivalent); four holes 3.2-3.6 mm wide whose centres form a 31 ± 0.3 mm square (31 mm is the NEMA 17 hole pitch; read the catalog stepper's measured data in `derived.json` and use its value if it differs); a centre hole at least 22 mm wide for the boss; watertight.
  - `bearing-holder-608`: prompt "A holder for a 608 ball bearing". Checks: source requires a catalog ball bearing; a hole 22.0-22.4 mm wide (608 outer diameter 22 mm); watertight.
  - Both `requires: ['measure', 'write']`, `maxTurns: 12`, no `api` field (the `fluent-chain`-only rule in fixtures.test.js:48-51).
- [ ] **Step 1:** Write reference models in `fixtures.test.js` (built with `@jscad/modeling`: a 50 × 50 × 4 plate with the right holes passes; the same plate with a 30 mm pitch fails; a solid plate fails; for the holder, a ring with a 22.2 mm bore passes and a 20 mm bore fails). Pass a `source` string containing a matching require for the passing cases and a source without it for one failing case. Run: FAIL (fixtures missing).
- [ ] **Step 2:** Write the fixtures. Run `npm test -w @jscadui/agent-loop`: PASS.
- [ ] **Step 3: Commit** `feat(eval): NEMA 17 mount and 608 holder fixtures use catalog parts`.

Running the live eval (`sci push jscadui/eval`) spends model credits; the controller asks the user before running it.

---

## Phase 6: Parts browser (spec step 6)

### Task 20: Editor insert support

**Files:**
- Create: `apps/jscad-web/src/partsInsert.js`
- Modify: `apps/jscad-web/src/editor.js` (new export `applyEdit`)
- Test: `apps/jscad-web/src/partsInsert.test.js`

**Model:** `sonnet`.

**Interfaces:**
- Produces: `planInsert({ doc, cursor, path, entry, size }) → { changes: [{ from, to?, insert }], cursor }` (pure).
  - `.js`: call text `entry.call + '(' + size + ')'`. If a line `const { ... } = require('<entry.require>')` exists, add the missing names (`entry.call`, and `size` when it is an identifier, i.e. a size from `sizes.list`) to its braces; else insert `const { <names> } = require('<entry.require>')\n` at offset 0. If the require is present in another form, insert only the call using `<that binding>.<call>` is out of scope: insert a new destructuring line.
  - `.scad`: insert each `include <x>` from `entry.scadIncludes` that is missing, at offset 0; call text `<call>(<size>);`.
  - The call goes at `cursor`, on its own line when the cursor's line is not blank.
- Produces: `editor.applyEdit({ changes, cursor })` dispatching both changes in one transaction (CodeMirror maps positions), setting the selection, scrolling into view and focusing; and `editor.getCursor()` returning `view.state.selection.main.head`.

- [ ] **Step 1: Failing tests**

```js
// apps/jscad-web/src/partsInsert.test.js
import { describe, it, expect } from 'vitest'
import { planInsert } from './partsInsert.js'

const entry = { call: 'nut', require: 'NopSCADlib/vitamins/nuts.scad', scadIncludes: ['NopSCADlib/vitamins/nuts.scad'] }
const apply = (doc, { changes }) => [...changes].sort((a, b) => b.from - a.from).reduce((d, c) => d.slice(0, c.from) + c.insert + d.slice(c.to ?? c.from), doc)

describe('planInsert', () => {
  it('adds a require and the call to a js file', () => {
    const doc = 'const main = () => {\n  \n}\n'
    const out = apply(doc, planInsert({ doc, cursor: 23, path: '/main.js', entry, size: 'M3_nut' }))
    expect(out).toBe("const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')\nconst main = () => {\n  nut(M3_nut)\n}\n")
  })

  it('adds missing names to an existing require', () => {
    const doc = "const { nut } = require('NopSCADlib/vitamins/nuts.scad')\n\n"
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.js', entry, size: 'M4_nut' }))
    expect(out).toBe("const { nut, M4_nut } = require('NopSCADlib/vitamins/nuts.scad')\n\nnut(M4_nut)")
  })

  it('quotes nothing for a string size and adds no name for it', () => {
    const doc = ''
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: 0, path: '/main.js', entry: e, size: '"M3"' }))
    expect(out).toBe("const { nut } = require('_catalog/BOSL2/screws.scad')\nnut(\"M3\")")
  })

  it('adds include lines and the call to a scad file', () => {
    const doc = 'include <BOSL2/std.scad>\n\n'
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.scad', entry: e, size: '"M3"' }))
    expect(out).toBe('include <BOSL2/screws.scad>\ninclude <BOSL2/std.scad>\n\nnut("M3");')
  })
})
```

Adjust expected strings only where the rule above is ambiguous, and keep the rule and tests consistent.
- [ ] **Step 2:** Run `npx vitest run src/partsInsert.test.js` in `apps/jscad-web`: FAIL. **Step 3:** Implement `partsInsert.js` and the two editor exports. **Step 4:** Run: PASS.
- [ ] **Step 5: Commit** `feat(jscad-web): plan and apply a parts insert in the editor`.

### Task 21: Parts browser panel

**Files:**
- Create: `apps/jscad-web/src/partsBrowser.js` (panel, styles string, `showPartsBrowser`)
- Modify: `apps/jscad-web/src/menu.js` (`onBrowseParts` button "Browse Parts…" after "Browse Demos…")
- Modify: `apps/jscad-web/main.js` (~108-130: wire the callback; add `partsBrowserStyles` to the injected style element)
- Create: `apps/jscad-web/test/parts-browser.test.js` (jsdom), `apps/jscad-web/e2e/parts-browser.spec.js`
- Modify: `apps/jscad-web/docs/user-manual.md` (Parts browser section), `apps/jscad-web/docs/architecture.md` (a "Parts browser" section beside "Demo menu")

**Model:** `sonnet`.

**Interfaces:**
- Consumes: `<app>/parts/catalog.json` (Task 11 shape), `planInsert`, `editor.getSource/getPath/getCursor/applyEdit`.
- Produces: `showPartsBrowser({ catalogUrl, getEditor })` toggling a fixed panel (`.parts-panel`, left of or beside `.demo-panel`; pick `left: 300px` so both can be open), following demoBrowser.js patterns: module-level memoised fetch resolving to `null` on failure, the same `el()` helper style (copy it, do not import across modules), Escape closes.
  - List view: one card per family (thumbnail `<img src="parts/<thumb>">`, family name, entries listed preferred first with a license badge).
  - Entry view: summary, signature, size `<select>` (from `sizeNames`), options with meanings, measured dimensions, license, example, and an **Insert** button that calls `planInsert` with the current editor state and `applyEdit`.
  - Error state when `catalog.json` is missing.

- [ ] **Step 1: Failing jsdom test**

```js
// apps/jscad-web/test/parts-browser.test.js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const catalog = { entries: [
  { id: 'b/nut', family: 'nut', preferred: true, library: 'B', license: 'BSD-2-Clause', call: 'nut', summary: 'Nut B', signature: { params: [{ name: 'spec' }] }, sizeNames: ['"M3"'], options: {}, measured: [], example: 'nut("M3")', thumb: 'thumbs/b/nut.png', require: '_catalog/B/nuts.scad', scadIncludes: ['B/std.scad', 'B/nuts.scad'] },
  { id: 'a/nut', family: 'nut', library: 'A', license: 'GPL-3.0', call: 'nut', summary: 'Nut A', signature: { params: [{ name: 'type' }] }, sizeNames: ['M3_nut'], options: { nyloc: 'add the nylon insert' }, measured: [{ args: ['M3_nut'], size: [6.35, 5.5, 2.4] }], example: 'nut(M3_nut)', thumb: 'thumbs/a/nut.png', require: 'A/nuts.scad', scadIncludes: ['A/nuts.scad'] },
] }

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog) }))
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('parts browser', () => {
  it('lists a family card with the preferred entry first', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    const names = [...document.querySelectorAll('.parts-entry')].map((e) => e.textContent)
    expect(names[0]).toContain('B')
    expect(document.querySelector('.parts-license').textContent).toContain('BSD-2-Clause')
  })

  it('inserts the selected size into the editor', async () => {
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    const applyEdit = vi.fn()
    const editor = { getSource: () => '', getPath: () => '/main.js', getCursor: () => 0, applyEdit }
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => editor })
    await flush()
    document.querySelectorAll('.parts-entry')[1].click()
    document.querySelector('.parts-insert').click()
    expect(applyEdit).toHaveBeenCalledOnce()
    expect(applyEdit.mock.calls[0][0].changes.map((c) => c.insert).join('')).toContain('nut(M3_nut)')
  })

  it('shows an error when the catalog is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { showPartsBrowser } = await import('../src/partsBrowser.js')
    showPartsBrowser({ catalogUrl: '/parts/catalog.json', getEditor: () => null })
    await flush()
    expect(document.querySelector('.parts-error')).not.toBeNull()
  })
})
```

- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement and wire into `menu.js`/`main.js` (`catalogUrl: new URL('./parts/catalog.json', appBase).toString()`, `getEditor: () => editor`). **Step 4:** Run `npx vitest run` in `apps/jscad-web`: PASS.
- [ ] **Step 5: e2e** `e2e/parts-browser.spec.js` mirroring `demo-browser.spec.js`: open via `#menu-button` → "Browse Parts", see `.parts-panel` with at least one `.parts-entry`, open an entry, press Insert, assert the editor text (read via `.cm-content` text) contains the require line and the call; Escape closes. Run `npx playwright test e2e/parts-browser.spec.js`: PASS.
- [ ] **Step 6:** Docs: user manual "Parts browser" section (opening, cards, entry view, what Insert does per language); architecture.md "Parts browser" (reads `parts/catalog.json` only; built by `packages/parts/bin/build.js` from the app build).
- [ ] **Step 7: Commit** `feat(jscad-web): parts browser panel with insert`.

---

## Phase 7: Doc wrap-up and branch finish

### Task 22: Permanent docs and spec/plan removal

**Files:**
- Modify: `packages/openscad/CUSTOMIZER_PLAN.md` (Phase 3 "BOSL2 parts catalogue" replaced by the parts catalog; point at `packages/parts/README.md`)
- Modify: `packages/openscad/LIBRARY_REGISTRY.md` (superseded by `/libs/`; say where the libraries are now and stop there)
- Modify: `docs/backlog.md` (remaining families: inserts, pulleys, belts, rails, extrusions, springs, threadlib threads; the unified facade over preferred entries; `_$f$obj` destructures a renamed self-referencing parameter key (`function f(screw = screw)` → named call ignores the argument), found during this work)
- Modify: `docs/architecture.md` (root: how `packages/parts`, `/libs/`, the frame, the agent and the browser fit together, in a short section)
- Modify: root `README.md` sub-project index if it lists packages
- Delete: `docs/superpowers/specs/2026-10-01-parts-catalog-design.md`, `docs/superpowers/plans/2026-10-01-parts-catalog.md`

**Model:** `sonnet`.

- [ ] **Step 1:** Make the edits. Brief edits only: these files hold real content; edit, never replace wholesale.
- [ ] **Step 2:** Run `npm run validate` at the root (lint + typecheck + test; the OpenSCAD comparison part of `npm test` goes through CI, so if `validate` would run it locally, run `npm run lint`, `npm run typecheck` and the per-package unit tests instead).
- [ ] **Step 3: Commit** `docs: fold the parts catalog into the permanent docs; drop the spec and plan`.

### Task 23 (controller): Finish

- [ ] Final whole-branch review (opus reviewer subagent).
- [ ] `sci push jscadui/web` for the app e2e set.
- [ ] Ask the user before: fast-forwarding `main` and pushing, deploying (which the live smoke check in Task 7 needs), and running the paid eval.
