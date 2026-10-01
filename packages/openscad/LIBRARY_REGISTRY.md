# Library registry — superseded

This proposed an npm/jsDelivr distribution for OpenSCAD libraries. Superseded
by `/libs/`: each library is deployed once, unpatched, under
`apps/jscad-web/libs/<Library>/` (built from the pinned checkout in
`scripts/deps/manifest.json`), served at `<app origin>/libs/`. SCAD `include`/
`use` and JS bare `require` both resolve a library path there; see
`apps/jscad-web/docs/architecture.md` ("Naming a script") for resolution order
and `packages/parts/README.md` for the vetted catalog built on top of it.
