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



## Compute frame

The fold left the frame boundary half-covered. In rough priority order:

- **No CI entry runs the jscad-web browser e2e** beyond `frame.spec.js`.
  `ci/web` covers the unit suites and `ci/render` the render sweep, but
  `app.spec.js`, `ai-chat.spec.js` and the rest run nowhere.
- **The agent's `params` tool runs outside the sandbox.** `setParams` in
  `main.js` calls `paramChangeCallback`, which re-executes model code on the
  local worker. Agent-written code reaches the unsandboxed engine through it.
- **Manifold cannot load in the frame.** `src_bundle/bundle.manifold_modeling.js`
  resolves `./manifold.wasm` against `self.location.href`, which is a `blob:`
  opaque-path base in the frame worker, so the URL cannot resolve regardless
  of CSP.
- **The frame iframe is created on every page load**, so every visitor pulls
  the frame page and its blob worker even when the agent is never used. Create
  it on first agent use.
- **Migrate the editor onto the frame** so all model execution is sandboxed
  and there is one engine. Preconditions: the agent path proven in production,
  and frame/worker parity held across a full render sweep.
