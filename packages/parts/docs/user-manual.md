# @jscadui/parts user manual

## Record format

One hand-written JSON record per entry, under `catalog/<library>/<entry>.json`.
`catalog/nopscadlib/nut.json`:

```json
{
  "id": "nopscadlib/nut",
  "family": "nut",
  "library": "NopSCADlib",
  "license": "GPL-3.0",
  "file": "NopSCADlib/vitamins/nut.scad",
  "prelude": ["NopSCADlib/vitamins/nuts.scad"],
  "call": "nut",
  "summary": "DIN 934 / ISO 4032 metric hex nut, optionally nyloc, brass, nylon or domed.",
  "sizes": { "list": "nuts" },
  "options": {
    "nyloc": "add the nylon insert (taller nut)",
    "brass": "brass colour",
    "nylon": "nylon colour",
    "dome": "domed acorn nut (sizes with dome data only)"
  },
  "example": "nut(M3_nut, {nyloc: true})",
  "checks": [
    {
      "args": ["M3_nut"],
      "size": [6.4, 5.543, 2.4],
      "tol": 0.01,
      "source": "ISO 4032 / DIN 934 M3: s 5.5, m 2.4. NopSCADlib M3_nut draws 6.4 across corners (corner on x), so s = 6.4 cos 30° = 5.543"
    }
  ]
}
```

- `id`, `family`, `library`, `license`, `file`, `call`, `summary`, `sizes`,
  `example`, `checks` are required; `preferred`, `options`, `prelude` and
  `insertArgs` are optional. `readRecords` (`src/records.js`) refuses a record
  missing a required field, with `sizes` in no form or two, or with
  `insertArgs` that is not an array.
- `file` is the library source to require, relative to `apps/jscad-web/libs/`.
- `prelude`: other library files to `include` before `file`, for a module
  split across files (NopSCADlib's `nut` module and its `nuts` size list live
  in separate files). When set, the loader requires a generated shim at
  `_catalog/<file>` that includes the prelude then `file`, instead of `file`
  directly. Order matters: a variable read before its file is included is
  `undef`, as in OpenSCAD. NopSCADlib's screw sizes (`vitamins/screws.scad`)
  read head-type constants such as `hs_cap` from `global_defs.scad`.
  `NopSCADlib/core.scad` includes `global_defs.scad` (through
  `utils/core/core.scad`) and then `vitamins/screws.scad`, so the screw entry's
  prelude is `NopSCADlib/core.scad`, not `screws.scad`.
- `sizes` names the standard sizes the entry builds, in exactly one form:
  - `{ "list": "nuts" }` derives the size names from every exported variable
    whose value is `===` an element of the library's `nuts` list, in list
    order.
  - `{ "names": ["M3_cap_screw", ...] }` lists exported variable names
    directly, for a library whose sizes have no list variable. Each name must
    be a variable the file exports; the size sweep fails the record otherwise.
  - `{ "values": ["M3", "M4"] }` lists literal arguments, for a library keyed
    by spec strings or numbers (BOSL2's `nut("M3")`,
    `nema_stepper_motor(17)`).

  `list` and `names` sizes are identifiers: the parts browser inserts
  `nut(M3_nut)`, and the require destructures `M3_nut` alongside the call.
  `values` sizes are JSON literals: `nut("M3")`, `nema_stepper_motor(17)`.
- `insertArgs`: arguments that follow the size in every call the catalog
  makes, for a call that needs more than a size. `nopscadlib/screw` has
  `"insertArgs": [10]`, so the size sweep builds `screw(M3_cap_screw, 10)` and
  the parts browser inserts the same. Write `example` with them too.
- `checks[].size` is the built part's axis-aligned bounding box `[x, y, z]` in
  mm, compared within `tol` (absolute, mm). An axis may be `null` to skip it,
  such as a stepper's z, which depends on body and shaft length.
- `preferred: true` marks the family's default, the one the agent's prompt
  names. A family has at most one; `npm run catalog` refuses a second.

Signature (parameter names, order, defaults) and size names are derived from
the library file at check time, not hand-written.

## Commands

- `npm run check` (`bin/check.js`) transpiles and builds every selected
  entry, compares each `checks[]` bounding box with its measurement (a `null`
  axis is skipped), and builds every size once, with `insertArgs` after it.
  It fails a size that throws or builds empty geometry, and a `sizes.names`
  name that is not an exported variable. Usage: `node bin/check.js <id>...`
  or `--all`; `--catalog <dir>` and `--libs <dir>` override the catalog and
  `/libs/` directories; `--write` merges each record's result (`ok`,
  failures, measured sizes, signature, size names, transpile and build
  timings) into `derived.json`, keyed by id. Exits 1 if any record fails.
- `npm run render` (`bin/render.js`) builds the first `checks[]` entry of
  each record and renders its iso-front view to `thumbs/<id>.png` (headless
  Chromium through Playwright). Usage: `node bin/render.js <id>...` or
  `--all`; `--catalog <dir>`, `--libs <dir>` and `--out <dir>` override the
  catalog, `/libs/` and `thumbs/` directories.
- `npm run catalog` (`bin/build.js`) writes `<dir>/catalog.json` for the
  parts browser: every record merged with its derived signature, size names,
  measured dimensions and thumbnail path. A record missing from
  `derived.json`, or whose checks failed there (`ok: false`), is skipped with
  a warning. It copies `thumbs/` to `<dir>/thumbs/` and (re)writes the
  `_catalog/` library shims for every record with a `prelude`. It also writes
  the agent's docs: `packages/agent-loop/api/parts.json` (one entry per
  catalog entry: name, license, `require`/`include` lines, signature, sizes,
  options, measured dimensions, example) and
  `packages/agent-loop/prompt/parts.md` (the `## Parts` prompt block: one
  line per family from its preferred entry, then the rules to use a catalog
  part, prefer a permissive license, and never copy library files). Both are
  empty with no admitted entries. Usage:
  `node bin/build.js --out <dir> [--catalog <dir>] [--libs <dir>]`.

The `apps/jscad-web` build calls `buildParts` before copying `libs/`, so the
shims land there too, and writes the catalog to `<outDir>/parts/`. It
rewrites `api/parts.json` and `prompt/parts.md` on every build. With a local
`derived.json` that differs from the committed one, as during admission, an
app build changes those two tracked files; commit them with the
`derived.json` they came from, or delete the local copy.

## Admission

An entry reaches the parts browser and the agent once its checks pass in
`ci/parts` and a person has looked at its thumbnail. `derived.json` and
`thumbs/` are committed only at admission.

1. `sci push jscadui/parts` checks and renders every record on the CI host
   (`ci/README.md`, "Parts catalog"). Run it, too, before committing a move of
   a library pin in `scripts/deps/manifest.json`.
2. Fetch the results into `packages/parts/`:
   `sci artifact JOB packages/parts/derived.json` and
   `sci artifact JOB packages/parts/thumbs/<library>/<entry>.png` for each
   record.
3. Look at every thumbnail. A part that renders wrong is not admitted: fix
   its record, or remove it, and start again.
4. Set `"preferred": true` on exactly one record in every family, including a
   family with a single entry. A family with no preferred entry gets no line
   in the agent's prompt.
5. Regenerate the agent's docs:
   `npm run catalog -w @jscadui/parts -- --out <scratch dir>`, then
   `npm run api-index -w @jscadui/agent-loop`.
6. Commit `derived.json`, `thumbs/`, the record edits,
   `packages/agent-loop/api/parts.json`, `prompt/parts.md` and
   `api/index.json` together. `test/agent-outputs.test.js` fails when the
   committed agent docs differ from what `derived.json` and the records
   generate.
