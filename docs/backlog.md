# Backlog

Outstanding work, roughly in the order it should land. Delete an item in the
commit that completes it.

## Deploy

jscad.rkroll.com runs `dev` with the AI chat folded in (2026-09-17): the
frontend is jscad-web hybrid plus the app API (`apps/jscad-web/server`) on
:3006, with the compute frame served from the same deploy at `/frame/`.
2026-09-18: deployed from `main` with local-first
rowboat storage (versioned projects, per-project chat persistence, table sync
on sign-in via `/api/sync-token`), then the project UI batch (side drawer
with stacked tabs, project list/switch/rename, append-only version restore,
local/rowboat toggle, drop branching). Smoke: site 200, `/api/health` 200,
`/api/sync-token` 401 anonymous, relay 403 on fake origin. The old `main` export breakage (worker requesting
`bundle.jscad_io` with no `/build/` prefix) is fixed on this branch by
requiring the registered `@jscad/io` alias instead. Merged to `main`
2026-09-20 as `feat/fluent-worker-bundle`: fluent worker bundle in both
apps plus four backlog fixes (WASM clone ownership, build clean, alias
cache, export identity). Render gate 2026-09-20: 764/788, 24 failures
triaged as pre-existing openscad-corpus issues; baseline recorded in
`apps/jscad-web/e2e/render-baseline.json` (job 07ff0ae0ffbdb0f2). 2026-09-20:
jscad-studio and jscad-studio-run folded into jscad-web and removed; the
`run.*` vhosts retire with the next deploy (operator step).



## Render sweep

- **`e2e/render-baseline.json` is not a baseline.** It was recorded with a
  harness that raced `#progress` → hidden, which `main.css` sets to
  `display: none`, so most pages were closed before the model ran and reported
  a pass. The sweep now waits on `html[data-render]`; re-record the baseline
  from a full CI run and re-triage. A local honest sweep of nopscadlib is
  44/145, against 129/145 in the old file.
- **Most of NopSCADlib does not render in the browser.** 85 of 145 fail with
  `invalid jscad geometry, not an object`, the same on `main` as on the frame
  branch, while the Node STL corpus passes them. Browser-only, pre-existing,
  and unrelated to the compute frame.

## Compute frame

- **The app still builds `bundle.worker.js` and `bundles.js`.** Nothing loads
  either since the editor moved into the frame. Drop the build step and the
  module, or keep `src_bundle` only for the parity tests that import it.
