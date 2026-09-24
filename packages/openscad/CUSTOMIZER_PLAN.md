# Parameterized Parts from OpenSCAD — Plan

Goal: turn existing `.scad` models and libraries into parameterized parts in
jscad-web, the way `.js` models expose `getParameterDefinitions()`.

## Status (done)

On branch `claude/inspiring-edison-qjdiyk`:

- `src/customizer/extract.ts`: Customizer extraction. It uses the tokenizer, not
  regex; handles groups, `[Hidden]`, descriptions, and range/step/dropdown
  annotations; stops at the first `{`; and sorts every top-level variable into
  one kind (parameter / hidden / derived / special / unsupported / after-limit).
- `src/customizer/definitions.ts`: schema → `getParameterDefinitions()` format.
- `transpile(ast, { customizer: true })`: exports definitions; `main(params)`
  re-runs the top-level assignments, so derived variables pick up new values.
  The jscad-web worker turns the option on.
- `bin/customizer-survey.js`: counts, per library, how many files are
  parameterized.

Measured with `fetch-deps` sources (jscad-web examples): 191 parameterized files;
dotSCAD 156/176 models (89%); NopSCADlib 35/142 (25%).

Corpus analysis of other conventions (model files with top-level geometry):

| Convention | Coverage | Phase |
|---|---|---|
| Customizer literals | dotSCAD 89%, NopSCADlib 25% | done |
| Literals after first `{` / constant expressions | +3 dotSCAD, +3 NopSCADlib, +6 BOSL2 lib | not planned |
| Literal args in top-level calls | BOSL/BOSL2 examples 95%, basics/text 100% | 2 |
| Documented library modules (`// Module:` + `// Arguments:`) | BOSL2 320/334, BOSL 202/206 | 3 |
| NopSCADlib `type` enumerations | 355 `type`-first modules, 84 lists / 499 items | 4 |

## Working rules

From `packages/openscad/CLAUDE.md`:

- One change, one test, one commit.
- Every transpiler change: `npx vitest run` locally, then `npm test` (GPU
  simple-ci) must show every baseline suite at 100% before merge.
- New behaviour stays opt-in until verified. With the option off, output must be
  byte-identical to the previous commit over the whole example corpus (the
  corpus hash check used for the customizer commit; add it as
  `bin/check-output-stable.js` in Phase 0).
- Run `npm run fetch-deps` before any survey or corpus check. Library sources
  and BOSL examples are not in git.

## Phase 0 — Close out the current branch

1. Run `npm test` on the GPU for commits `82da74d`..`53d4337` and record the
   result. Merge only after it passes.
2. Run the unit tests with the local `openscad-parser` fork. With npm `0.6.3`,
   two unrelated tests fail and BOSL/BOSL2/NopSCADlib files hit parse errors.
   Confirm those errors go away with the fork, then re-run the survey.
3. Group headings in the UI. `convertLegacyDefs` (params-core) drops `group`
   entries, so `.scad` parameters show as a flat list. Fix: keep groups as
   hierarchy nodes, or map each group to a `_group_` node in
   `toParamDefinitions`. Test in params-core.
4. Worker cache. A `.scad` file first transpiled as a dependency is cached
   without customizer output, so opening it later as the main file shows no
   parameters. Fix: key the main-file cache entry by `(path, customizer)`.
5. Add `bin/check-output-stable.js`: hash transpiled output for every corpus
   file and compare against a stored baseline. Used by every later phase.
6. Housekeeping:
   - Decide whether to remove the stale `test/corpus/snippet` submodule.
     `fetch-deps` pins `a718aaf`; the gitlink `4a13c43` is not upstream.
   - Refresh the two dotSCAD maze seed patches. They fail to apply to the
     pinned commit (`_mz_square_cells_impl.scad`, `_mz_theta_cells.scad`).

Done when: GPU baseline is green, groups render in jscad-web, and the stability
check is in CI.

## Phase 1 — Browser verification of Customizer models

1. Load 5 dotSCAD examples and 3 NopSCADlib files in jscad-web. Check that
   controls appear and that changing a value re-renders. Cover a slider, a
   dropdown, a vector and a string parameter.
2. Check that values survive the UI round trip: choice values keep their type
   (number vs string); vector components; `userInteracted` handling in the
   proxy.
3. Add a Playwright test for one `.scad` example: load it, change a slider,
   assert the mesh bounding box changes.

Done when: the Playwright test passes in CI.

## Phase 2 — Literal arguments of top-level calls

Makes `cuboid([20,35,25], rounding=5);` editable as `size` and `rounding`.

Design:
- Option `customizer: { callArgs: true }`, off by default.
- In `transpileAllStatements`, walk top-level module-instantiation chains
  (`translate(...) cuboid(...)`, including `if`/block bodies). Only literal
  arguments count, positional or named.
- Name each argument after the callee's parameter: named args use their name;
  positional args are looked up in the module's parameter list (the
  `moduleParamLists` the transpiler already builds, which covers used and
  included libraries). Built-ins (`cube`, `cylinder`, …) need a static table.
- Parameter key: `<module>.<param>`, with `#n` added when the same module is
  called more than once (`cuboid#2.size`). Group = the module name.
- Generation: hoist each literal into a top-level `var`, and emit the call with
  `_$cp(key, <literal>)`, reusing the existing override path.
- Real Customizer parameters win: if a file already has Customizer parameters,
  add call arguments only when the user asks for them (flag), so models that
  define their own interface stay clean.
- Skip literal arguments to transform modules (`translate`, `rotate`,
  `color`, …) by default; they are placement, not part dimensions.
  Configurable list.

Tests: extractor unit tests (named, positional, repeated calls, nested
chains); transpile tests executing `main(params)`; stability check with the
option off.

Done when: BOSL/BOSL2 examples, basics and text report ≥ 90% parameterized in
the survey, and the GPU baseline is unchanged.

## Phase 3 — Library modules as parts (BOSL2, BOSL)

Makes every documented library module a part: `cuboid`, `prismoid`,
`spur_gear`, `threaded_rod`, …

Design:
- `src/customizer/libdoc.ts`: parse BOSL-style doc blocks —
  `// Module:` / `// Function&Module:`, `// Synopsis:`, `// Topics:`,
  `// Arguments:` (`name = description. Default: x`, with `---` separating
  positional from named), `// Example...:` blocks.
- Join with the parsed `ModuleDeclarationStmt` signature for real parameter
  names and literal defaults.
- Defaults, in order:
  1. literal default in the signature;
  2. `Default:` value in the doc text, if it parses as a literal;
  3. value from the first doc example that passes that argument;
  4. otherwise mark the parameter required and not exposed. If a required
     argument has no value, drop the part.
- Types come from the default, or from the description (`number`, `vector`,
  `boolean`, enumerated strings such as `"hex"`/`"square"` → choice).
- Output: a generated catalogue — one virtual model per module:
  `include <BOSL2/std.scad>` (or the module's own file, taken from the
  extractor's `EXPLICIT_INCLUDES` list) plus the call, run through Phase 2's
  call-arg machinery. Store it as JSON (`module`, `file`, `topics`, `params`,
  `defaults`), not as `.scad` files.
- Skip modules whose Topics or tags mark them as non-geometry (attachments,
  transforms, `Anim`, `2D` unless 2D parts are wanted); configurable.

jscad-web: a "Parts" browser listing catalogue entries by library/topic. It
opens one as a model: synthesize the `.scad` text in the worker and transpile
it with `customizer: { callArgs: true }`.

Tests: doc parser on real BOSL2 excerpts; catalogue build over the BOSL2 lib
(count of parts, count dropped with reasons); render the top-N parts on the
GPU runner and compare with OpenSCAD (reuse test-harness).

Done when: catalogue covers ≥ 250 BOSL2 modules and ≥ 150 BOSL modules; ≥ 95%
of catalogued parts render and match OpenSCAD at their defaults.

## Phase 4 — NopSCADlib type enumerations

Makes `screw(type, length)` a part with `type` chosen from `screws`.

Design:
- Find lists `name = [A, B, C]` whose items are all top-level vector constants
  (84 lists / 499 items today), and modules whose first parameter is `type`
  (355).
- Pair a module with a list by file and name (`screw.scad` ↔ `screws`,
  `stepper_motor` ↔ `stepper_motors`); add an override table for mismatches.
- New parameter kind: a choice whose values are constant names. The UI shows
  names (`M3_cap_screw`); the transpiled `main` maps each name to the constant
  (`{ M3_cap_screw: M3_cap_screw, … }[_$cp('type', 'M3_cap_screw')]`).
- The remaining parameters come from the signature (literal defaults) and
  `//!` doc comments (NopSCADlib's convention for module descriptions).
- Add entries to the Phase 3 catalogue.

Done when: ≥ 50 NopSCADlib vitamins are browsable with a working type dropdown.

## Phase 5 — Tooling and docs

- Move the convention analysis (currently a scratch script) into
  `bin/customizer-survey.js --conventions`.
- Document in `packages/openscad/README.md`: supported Customizer syntax,
  `customizer` options, catalogue format, known differences from OpenSCAD.
- Add survey numbers to `MODEL_COMPARISON_BASELINE.md` so coverage can only go
  up.

## Order and dependencies

```
Phase 0 ──► Phase 1
   │
   └──► Phase 2 ──► Phase 3 ──► Phase 4
                        │
                        └──► jscad-web Parts browser
Phase 5 runs alongside, after Phase 2.
```

## Open questions

1. Phase 2: expose call arguments in files that already have Customizer
   parameters? Proposed: no, unless a flag is set.
2. Phase 3: where does the catalogue live? Generated at build time into
   `apps/jscad-web` (static JSON), or computed lazily in the worker from the
   library sources?
3. Phase 3: include 2D modules (`rect`, `circle`-like) as parts, or 3D only?
4. Snippet submodule: remove it?
