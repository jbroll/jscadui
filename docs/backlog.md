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
jscad-studio and jscad-studio-run folded into jscad-web and removed; the old
`run.*` vhosts retired with the next deploy. 2026-09-21: the compute frame
moved to its own host, `jscad-run.rkroll.com`, deployed via
`deploy-run.conf`; `jscad.rkroll.com` still serves the app and proxies
`/api`. Both hosts are live. See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.



## Compute frame

Left over from `feat/frame-single-engine`. None of these break the boundary the
branch built; they are the gaps it did not close.

- **The frame accepts a message from any window on the app origin.** It checks
  `event.origin` but not `event.source !== parent`, so another same-origin
  window can drive it. It gets no answers back, since replies go to `parent`.
- **`packages/postmessage` has no unit test for per-endpoint `reqMap`
  isolation.** That isolation is the whole reason the change exists.
- **Two malformed requests burn the frame timeout instead of answering.**
  `jscadInit` with `params: [null]`, and an unknown relayed method. Both should
  reject at once.
- **`engine` latches across `jscadInit` calls that omit it,** and nothing says
  so. The alias path (`onAliasFound`) relies on it. Document or make it
  explicit.
- **`frameApi`'s `entities` and `onProgress` handlers are dead code.** Either
  wire them or drop them.
- **`framePort` could treat a second iframe `load` event as fatal.** A second
  load means the frame navigated, which the app should not survive silently.
- **An un-awaited `addToCache` races the file map for `.jscad` shims.**
- **`require('./part.stl')` from a project is untested,** and now arrives as an
  ArrayBuffer rather than the binary string callers used to get.
- **No test for a nested `fromFile` inside a project subdirectory.**
- **A filename containing `../` can walk the library-root candidate outside its
  library.** Pre-existing, not introduced by the frame work.
- **`deploy-full.sh`'s frame check greps curl's status output** instead of using
  its exit code, after a fixed `sleep 3` and with no retry.
- **`src_frame/frame.js`'s `armTimeout` keeps a single `pendingId`.** A second
  request clears the first's timer, so an earlier request can never time out.
- **`src_frame/frame.js`'s `attach()` sets no `onerror`/`onmessageerror`.** A
  blob worker that fails to load its bundles surfaces as "model exceeded N ms"
  instead of the load error.
- **Every compile sends the whole service-worker cache to the frame.**
  `main.js` and `src/projectFiles.js` send all of it, and `switchProject` does
  not clear it first, so the frame receives the union of every project opened
  this session.
- **`packages/require`'s `.scad` library-root fallback cannot work in the
  frame.** It resolves against `self.location.origin`, which is the string
  `'null'` in the frame's blob worker. It is a third copy of the logic
  `src_frame/scadResolve.js` centralised; delete it or route it through that.
- **The app build still produces the whole model engine into `build/`** —
  `bundle.jscad_modeling.js`, `bundle.manifold_modeling.js`, `manifold.wasm`,
  `bundle.openscad.js` and the rest — although only the frame executes models.
  `test/fluent-worker.test.js` loads the app-side copy, so removing them means
  repointing that test.

## Render sweep

- **The largest known problem: 88 of 788 browser-render failures are a
  browser-only geometry gap**, `invalid jscad geometry, not an object` or
  similar, that the Node STL corpus does not hit and that fails identically on
  `main`. Most of it is NopSCADlib (100 of 145 fail in the current baseline);
  mcad's `polyholes_test.scad` — "segments must be four or more" — is one
  instance outside that library. See `apps/jscad-web/e2e/RENDER-TESTING.md`
  and `render-baseline.json`. Pre-existing, unrelated to the compute frame,
  not a regression.
