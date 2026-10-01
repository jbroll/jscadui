# Architecture

## Parts catalog

A standard part (a nut, a screw, a bearing, a stepper) comes from an OpenSCAD
library already in the test corpus, not from a model author's own code.

- **`/libs/`.** Each catalog library (NopSCADlib, BOSL2) is deployed once,
  unpatched, under `apps/jscad-web/libs/<Library>/`, built from the checkout
  `scripts/deps/manifest.json` pins. A SCAD `include`/`use` tries `/libs/`
  last, after the including file's directory and its example library root
  (`apps/jscad-web/docs/architecture.md`, "Naming a script"). A JS bare
  `require('NopSCADlib/vitamins/nuts.scad')` whose first segment names a
  deployed library maps to `/libs/` through `packages/require`'s
  `setLibraryPrefixes` (`src/resolution/moduleResolver.js`).
- **`packages/parts`.** One hand-written, checked JSON record per catalog
  entry (`packages/parts/docs/user-manual.md`): the library call, its standard
  dimensions and tolerance, and the sizes to sweep. `bin/check.js` transpiles
  each entry from `/libs/` through the OpenSCAD transpiler's clean export
  surface (`packages/openscad/ARCHITECTURE.md`, "Clean exports" — a module or
  function callable by its bare name with positional or named arguments) and
  measures it against the standard; `bin/render.js` thumbnails it;
  `bin/build.js` writes `catalog.json`, the `_catalog/` library shims, and the
  agent's generated docs and prompt block. An entry is admitted once its
  checks pass in CI and a person has looked at its thumbnail (user manual,
  "Admission").
- **The frame.** Model code that calls a catalog part runs exactly like any
  other `require`/`include`, inside the sandboxed compute frame
  (`apps/jscad-web/docs/architecture.md`, "One engine, one boundary"); the
  catalog adds no new trust boundary, only a new resolution target.
- **The agent.** `packages/agent-loop`'s `docs` tool and system prompt list
  only admitted, preferred-first catalog entries (`packages/agent-loop/docs/architecture.md`,
  "API index"), generated from the same catalog build, so the chat
  reaches for a vetted part instead of modeling standard hardware from
  scratch.
- **The browser.** `apps/jscad-web`'s parts panel reads `catalog.json` alone
  and inserts a part's require/include line and call into the editor
  (`apps/jscad-web/docs/architecture.md`, "Parts browser";
  `apps/jscad-web/docs/user-manual.md`).

Parts are called, not copied: no library file enters a project, and a part
keeps its library's own call and size scheme rather than a cross-library
facade (`docs/backlog.md`, "Parts catalog").
