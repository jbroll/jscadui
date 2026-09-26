# Cloud sessions and dependency setup

How a Claude Code cloud session (or any fresh clone) gets to a state where the
OpenSCAD transpiler runs, unit tests pass, single models compare against
OpenSCAD, and the full suite is verified on the GPU host.

## TL;DR

| Where | What to do |
|-------|------------|
| Cloud session | Nothing. `.claude/hooks/session-start.sh` runs at session start. |
| Dev machine, fresh clone | `npm run setup` |
| Dev machine, editing the modeling fork | `ln -s ~/src/OpenJSCAD.org .deps-cache/OpenJSCAD.org` before `npm run setup` |
| Full comparison suite | Push the branch and open a PR. The GPU host runs it and reports back as the `openscad-gpu` status. |

## What lives outside the repo, and how it is pinned

| Dependency | Used by | Source | Pin |
|------------|---------|--------|-----|
| `openscad-parser` | `packages/openscad` | npm git dependency on `jbroll/openscad-parser` | commit in `packages/openscad/package.json`; `npm install` clones and builds it |
| `@jscad/modeling`, `@jscad/modeling-for-manifold` | most packages and apps | `file:` into `.deps-cache/OpenJSCAD.org/packages/modeling` (the `@jbroll/jscad-modeling` fork, branch `fork-main`) | `scripts/deps/sources.json`, checked out by `scripts/fetch-sources.js` |
| OpenSCAD corpora (BOSL, dotSCAD, NopSCADlib, MCAD, …) | comparison suites | `scripts/fetch-deps.js` copies them into `apps/jscad-web/examples/openscad/*` | `scripts/deps/manifest.json` |
| `@jbroll/rowboat-*` | `apps/jscad-web` storage and server only | `file:../../../rowboat/…` sibling checkout | **not pinned.** Not on npm or GitHub under an accessible name. Without it `npm install` leaves dangling links; the OpenSCAD packages and tests don't need it. |

npm can't install a subdirectory of a git repo, so `@jscad/modeling` can't be a
plain git dependency like the parser. Instead `fetch-sources.js` keeps a
checkout at a pinned commit inside the repo (`.deps-cache/` is gitignored), so
every machine resolves the same path:

- **missing:** blobless clone, detached at the pin
- **a checkout it made:** moved to the pin if HEAD differs; refuses if there are
  local changes
- **a symlink:** left alone and reported, so a dev machine can link its working
  copy for live edits

Because the checkout is inside the project root, npm also installs the fork's
own devDependencies (ava, browserify, nyc…; about 450 lockfile entries, all
`"dev": true`). That is npm's behaviour for in-root `file:` links, not a
mistake in the lockfile.

### Moving a pin

```bash
npm run fetch-sources:update   # OpenJSCAD.org → tip of its ref; rewrites sources.json
npm install                    # refresh the lockfile
```

For the parser, change the commit in `packages/openscad/package.json` and run
`npm install`. For corpora, `npm run fetch-deps:update`.

## The cloud SessionStart hook

`.claude/settings.json` registers `.claude/hooks/session-start.sh`. It exits
immediately unless `CLAUDE_CODE_REMOTE=true`, so it never runs on a dev
machine. In a cloud session it:

1. `node scripts/fetch-sources.js`
2. `npm install`. This also builds the parser and runs `prepare`, which sets
   `core.hooksPath=.git-hooks`, so the pre-commit hook (build, lint staged
   files, typecheck, openscad unit tests) is active.
3. `node scripts/fetch-deps.js --if-missing`
4. `npm run build --workspace=@jscadui/openscad`
5. Installs the latest OpenSCAD nightly AppImage into `~/.local/bin/openscad`
   unless an `openscad` with `--backend` support is already on `PATH`, and
   adds `~/.local/bin` to the session `PATH`. The distro package (2021.01)
   lacks `--backend=manifold`, which `test-harness.js` passes. This step may
   fail without failing the hook.

It runs synchronously: the session starts once setup is done (about 40 s
measured on 2026-09-26 with the corpora already cached, longer on first
fetch). The container is snapshotted afterwards, so later sessions start
faster.

Network: the hook needs HTTPS to `github.com`, `registry.npmjs.org` and
`files.openscad.org`.

## Working in a session

```bash
cd packages/openscad
npx vitest run                                   # unit tests
node bin/run-jscad.js path/to/model.scad -o /tmp/out.stl
node bin/test-harness.js path/to/model.scad --verbose --no-stl-cache
```

Without `--verbose`, `test-harness.js` prints only failures. It refuses runs of
more than one model unless `JSCADUI_CI=1`. Don't set that yourself: whole
suites run on the GPU host (below). See `packages/openscad/CLAUDE.md`.

## Verifying on the GPU host from a session

Cloud sessions can't reach simple-ci (`npm test` in `packages/openscad`), so
the GPU host watches pull requests instead (`ci/gpu-poll.mjs`; details and host
setup in `ci/README.md`):

1. Commit (the pre-commit hook runs) and push the branch.
2. Open a PR against `main`. A PR opened from a session is authored by the
   repo owner's GitHub account, which is in `CI_TRUSTED_USERS`.
3. Subscribe to the PR's activity, or check its commit status. The host sets
   `openscad-gpu` to `pending`, runs `ci/gpu-test` (fetch-deps, which fails
   the run if it changes a tracked file, then `ci/test`) on the head commit,
   then sets `success`/`failure` and comments with suite summaries and the log
   tail.
4. A head commit that touches `ci/` or `scripts/` does **not** auto-run. The
   repo owner must comment exactly `/gpu-retest` after that commit. Use the
   same comment to re-run a killed or suspect run.
5. A `success` status on the exact head commit counts as GPU verification
   (`packages/openscad/CLAUDE.md`). Update `MODEL_COMPARISON_BASELINE.md` only
   from such a run.

Merging is fast-forward only (root `CLAUDE.md`). The PR is just the CI channel;
never merge it through GitHub.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Cannot find module '@jscad/modeling'` or `…modeling-for-manifold` | `.deps-cache/OpenJSCAD.org` missing. Run `npm run fetch-sources`, then `npm install`. |
| `fetch-sources: … has local changes` | Someone edited the cached checkout. Commit/stash there, or replace it with a symlink to your own checkout. |
| `Cannot find module 'openscad-parser'` or missing `dist/` | The git dependency didn't build. Re-run `npm install` (it runs the parser's `prepare`). |
| `test-harness`: every model "OpenSCAD render failed" | `openscad` on `PATH` is too old for `--backend=manifold`. Check `openscad --version`; the hook's nightly is in `~/.local/bin`. |
| `npm ci` complains the lockfile is out of sync | Run `npm install` after changing any `package.json` or pin, and commit the lockfile. |
| `fetch-deps` patch failure | Patches must apply with `--fuzz=0` against the pinned upstream; regenerate the patch with `diff -u` against `.deps-cache/<dep>/`. |
