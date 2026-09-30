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
| `@jbroll/jscad-fluent` | `apps/jscad-web`, `packages/agent-loop` | `file:` into `.deps-cache/jscad-fluent` (branch `modeling-parity`, ahead of the 0.6.1 npm release with the manifold-getter fix and `@jscad/modeling` parity) | `scripts/deps/sources.json`; `fetch-sources.js` also runs its `build` list (`npm ci`, `npm run build`) since it doesn't commit `dist/` |
| `@jbroll/jscad-anchors` | jscad-fluent's own `devDependencies: "file:../jscad-anchors"` | pinned as a `.deps-cache/jscad-anchors` sibling so that sibling path resolves | `scripts/deps/sources.json`, listed before jscad-fluent so it exists first; also has a `build` list |
| OpenSCAD corpora (BOSL, dotSCAD, NopSCADlib, MCAD, …) | comparison suites | `scripts/fetch-deps.js` copies them into `apps/jscad-web/examples/openscad/*` | `scripts/deps/manifest.json` |
| `@jbroll/rowboat-*` | `apps/jscad-web` storage and server only | `file:../../../rowboat/…` sibling checkout | **not pinned.** Not on npm or GitHub under an accessible name. Without it `npm install` leaves dangling links; the OpenSCAD packages and tests don't need it. |

npm can't install a subdirectory of a git repo, so `@jscad/modeling` can't be a
plain git dependency like the parser. Instead `fetch-sources.js` keeps a
checkout at a pinned commit inside the repo (`.deps-cache/` is gitignored), so
every machine resolves the same path:

- **missing:** blobless clone, detached at the pin
- **a checkout it made:** moved to the pin if HEAD differs; refuses if there are
  local changes, unless they're the checkout's own uncommitted build output
  (tracked by a marker), which it discards automatically
- **a symlink:** left alone and reported, so a dev machine can link its working
  copy for live edits

A source can also carry a `build` list (jscad-fluent and jscad-anchors both
do): commands run inside the checkout once it's at the pinned commit, skipped
on later runs via a marker (`.deps-cache/.<name>.built`, outside the
checkout) recording which commit and build list produced the output. Needed
for a source that doesn't commit its build output. Tracked-file and stray
untracked edits a build leaves are discarded from the checkout right after
(`git checkout -- .` and `git clean -fd`), so it stays clean for the next
fetch or pin move. A checkout with local changes otherwise refuses, unless
the marker shows they're that build's own leftovers at the current HEAD (an
interrupted build), which get discarded the same way on the next run — one
log line names the source when this happens. A symlinked (dev) checkout is
never built — that's the linked owner's job.

jscad-fluent's own `devDependencies` pins `@jbroll/jscad-anchors` to
`file:../jscad-anchors`, a path that resolves only when something sits at
`.deps-cache/jscad-anchors` — the same sibling-checkout convention
`@jscad/modeling`'s `file:../OpenJSCAD.org/packages/modeling` already relies
on. Pinning `jscad-anchors` as its own source (listed first, so it exists
before jscad-fluent's `npm ci` runs) makes that resolve like any other
sibling `file:` dependency, with no edits to jscad-fluent's own package.json
needed.

Because the checkout is inside the project root, npm also installs the fork's
own devDependencies (ava, browserify, nyc…; about 450 lockfile entries, all
`"dev": true`). That is npm's behaviour for in-root `file:` links, not a
mistake in the lockfile.

### Moving a pin

```bash
npm run fetch-sources:update   # every source → tip of its ref; rewrites sources.json
npm install                    # refresh the lockfile
```

`fetch-sources:update` moves every pinned source to the tip of its own `ref`
(OpenJSCAD.org's `fork-main`, jscad-fluent's `main`,
jscad-anchors' `local-packages`), so it also rebuilds jscad-fluent and jscad-anchors if
their tip moved.

For the parser, change the commit in `packages/openscad/package.json` and run
`npm install`. For corpora, `npm run fetch-deps:update`.

## The cloud SessionStart hook

`.claude/settings.json` registers `.claude/hooks/session-start.sh`. It exits
immediately unless `CLAUDE_CODE_REMOTE=true`, so it never runs on a dev
machine. In a cloud session it runs steps 1 to 4 as
`ci/lib/bootstrap.sh sources install deps openscad` (the step list is in
`ci/README.md`), then step 5:

1. `node scripts/fetch-sources.js`
2. `npm install --no-audit --no-fund`. This also builds the parser and runs
   `prepare`, which sets `core.hooksPath=.git-hooks`, so the pre-commit hook
   (build, lint staged files, typecheck, openscad unit tests) is active.
3. `node scripts/fetch-deps.js --if-missing`
4. `npm run build` in `packages/openscad`
5. Installs the latest OpenSCAD nightly AppImage into `~/.local/bin/openscad`
   unless an `openscad` with `--backend` support is already on `PATH`, and
   adds `~/.local/bin` to the session `PATH`. The distro package (2021.01)
   lacks `--backend=manifold`, which `test-harness.js` passes. The AppImage
   also needs `libEGL.so.1` and `libOpenGL.so.0`, which the base image lacks;
   when `openscad --version` reports a missing shared library, the hook
   installs `libegl1` and `libopengl0` with apt (before the version check,
   so a missing library is not mistaken for an old OpenSCAD). These steps may
   fail without failing the hook.

It runs synchronously: the session starts once setup is done (about 40 s
measured on 2026-09-26 with the corpora already cached, longer on first
fetch). The container is snapshotted afterwards, so later sessions start
faster.

Network: the hook needs HTTPS to `github.com`, `registry.npmjs.org` and
`files.openscad.org`, plus the Ubuntu apt mirrors for the OpenSCAD libraries.

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
| `openscad: error while loading shared libraries: libEGL.so.1` | `apt-get install -y libegl1 libopengl0` (the SessionStart hook does this). |
| `Cannot find module '@jscad/modeling'` or `…modeling-for-manifold` | `.deps-cache/OpenJSCAD.org` missing. Run `npm run fetch-sources`, then `npm install`. |
| `fetch-sources: … has local changes` | Someone edited the cached checkout. Commit/stash there, or replace it with a symlink to your own checkout. |
| `Cannot find module 'openscad-parser'` or missing `dist/` | The git dependency didn't build. Re-run `npm install` (it runs the parser's `prepare`). |
| `test-harness`: every model "OpenSCAD render failed" | `openscad` on `PATH` is too old for `--backend=manifold`. Check `openscad --version`; the hook's nightly is in `~/.local/bin`. |
| `npm ci` complains the lockfile is out of sync | Run `npm install` after changing any `package.json` or pin, and commit the lockfile. |
| `fetch-deps` patch failure | Patches must apply with `--fuzz=0` against the pinned upstream; regenerate the patch with `diff -u` against `.deps-cache/<dep>/`. |
