# @jscadui/parts

Vetted catalog of standard hardware (nuts, screws, washers, bearings,
steppers, ...) drawn from OpenSCAD libraries deployed under
`apps/jscad-web/libs/` (NopSCADlib, BOSL2). Each entry names a library call
and the standard dimensions it must build to; the parts browser and the chat
agent offer only catalog entries, never raw library requires, so every part a
model uses has been checked against its real-world size.

A `/libs/` library changes only when its pin moves in
`scripts/deps/manifest.json`. The `ci/parts` job runs the full catalog's
checks on that commit and gates it: a library bump that breaks a standard
dimension fails CI before it reaches the app.

## Record format

One hand-written JSON record per entry, under `catalog/<library>/<entry>.json`:

```json
{
  "id": "nopscadlib/nut",
  "family": "nut",
  "preferred": true,
  "library": "NopSCADlib",
  "license": "GPL-3.0",
  "file": "NopSCADlib/vitamins/nuts.scad",
  "call": "nut",
  "summary": "ISO 4032 hex nut, optionally nyloc.",
  "sizes": { "list": "nuts" },
  "options": { "nyloc": "add the nylon insert", "brass": "brass colour" },
  "example": "nut(M3_nut, {nyloc: true})",
  "checks": [
    { "args": ["M3_nut"], "size": [6.35, 5.5, 2.4], "tol": 0.05, "source": "ISO 4032 M3" }
  ]
}
```

- `id`, `family`, `library`, `license`, `file`, `call`, `summary`, `sizes`,
  `example`, `checks` are required; `preferred` and `options` are optional.
- `file` is the library source to require, relative to `apps/jscad-web/libs/`.
- `prelude` (optional): other library files to `include` before `file`, for a
  module split across files (e.g. NopSCADlib's `nut` module and its `nuts`
  size list live in separate files). When set, the loader requires a
  generated shim at `_catalog/<file>` that includes the prelude then `file`,
  instead of `file` directly. Order matters: a variable read before its file
  is included is `undef`, as in OpenSCAD. NopSCADlib's screw sizes read the
  head-type constants from `core.scad`, so that entry's prelude is
  `NopSCADlib/core.scad` (which includes `screws.scad`), not `screws.scad`.
- `sizes` names the standard sizes the entry builds. `{ "list": "nuts" }`
  derives size names from every exported variable whose value is `===` an
  element of the library's `nuts` list, in list order. `{ "values": [...] }`
  gives the names directly, for libraries keyed by spec strings instead of a
  list variable.
- `checks[].size` is the built part's axis-aligned bounding box `[x, y, z]` in
  mm, compared within `tol` (absolute, mm). An axis may be `null` to skip it
  (e.g. a shaft length that varies with mounting depth).

Signature (parameter names, order, defaults) and size names are derived from
the library file at check/build time, not hand-written.

## Commands

- `npm run check` — `bin/check.js`. Transpiles and builds every entry,
  compares each `checks[]` bounding box against its axis-aligned measurement
  (an axis of `null` is skipped), and builds every name in `sizes` once to
  catch a size that isn't an exported value, that throws, or that builds
  empty geometry. Usage: `node bin/check.js <id>...` or `--all`; `--catalog
  <dir>` and `--libs <dir>` override the default catalog and `/libs/`
  directories; `--write` merges each record's result (measured sizes,
  signature, size names, transpile and build timings) into `derived.json`,
  keyed by id. Exits 1 if any record fails.
- `npm run render` — `bin/render.js`. Builds the first `checks[]` entry for
  each record and renders its iso-front view to `thumbs/<id>.png` (headless
  Chromium via Playwright). Usage: `node bin/render.js <id>...` or `--all`;
  `--catalog <dir>`, `--libs <dir>` and `--out <dir>` override the default
  catalog, `/libs/` and `thumbs/` directories.
- `npm run catalog` — `bin/build.js`. Writes `<dir>/catalog.json` (every
  record merged with its derived signature, size names, measured dimensions
  and thumbnail path; a record missing from `derived.json` is skipped with a
  warning) and copies `thumbs/` to `<dir>/thumbs/`, for the parts browser and
  the agent's docs index. Also (re)writes the `_catalog/` library shims for
  every record with a `prelude`. Usage: `node bin/build.js --out <dir>
  [--catalog <dir>] [--libs <dir>]`. The `apps/jscad-web` build calls this
  directly before copying `libs/`, so the shims land there too.

## Admission

An entry is admitted when its checks pass in `ci/parts` and a person has
looked at its rendered thumbnail.
