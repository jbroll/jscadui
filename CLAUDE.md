# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

jscadui is a JSCAD UI playground — libraries and apps for building 3D CAD interfaces.
Main production app: [jscad.rkroll.com](https://jscad.rkroll.com) at `apps/jscad-web`. See `README.md`.

**Targets modern browsers only.** Uses ES2022+ features without polyfills. No compat shims.

## Repository Structure

npm workspaces monorepo: `packages/*` (libraries), `apps/*` (applications), `file-format/*` (exporters).

## Setup

Fresh clone: `npm run setup` (pinned source checkouts, `npm install`, OpenSCAD
corpora). Cloud sessions run the same via `.claude/hooks/session-start.sh`.
Linked worktree: `scripts/setup-worktree.sh <path>` reuses the parent
checkout's install via symlinks, fetches the example corpora, generates the
ALL.js grids and builds the web bundles (seconds, not a reinstall), so the
pre-commit gate passes on a fresh tree. It aborts when the shared
`.deps-cache` pins drift from the worktree manifest instead of moving them
under the parent checkout. Never run plain `npm install` in a fresh worktree:
this system's npm (12.2.0) denies `remote:`/`git:` fetches by default, so it
aborts with `EALLOWREMOTE` on `@jscad/modeling` and leaves `node_modules/.bin`
(tsc/turbo/vitest) missing and the pre-commit gate broken — the bootstrap
`install` step's `--allow-remote=all --allow-git=all` flags (or the script
above, which avoids a reinstall entirely) are required.
Before creating a new worktree, check `git worktree list` for a free
preconfigured sibling (`jscadui-wtN` beside the checkout, installs included):
reuse it when its branch is finished or unrelated, and only create under
`.worktrees/` when all siblings are occupied. Occupied means a branch with
unique commits or another live session — a sibling sitting on main HEAD is free.
Agent scratch (ledgers, review packages, notes, probe scripts) stays out of
the repo: keep it in gitignored locations (`/tmp/opencode`, `/.superpowers/`)
and extend `.gitignore` when a new scratch kind appears.
`@jscad/modeling` resolves to `.deps-cache/OpenJSCAD.org` (pinned in
`scripts/deps/sources.json`, which also pins jscad-fluent and jscad-anchors
the same way); symlink your own checkout there to edit it live.
Details, pins and GPU verification from a session: `docs/CLOUD_SESSION.md`.

## Common Commands

```bash
npm run dev        # All dev servers (turbo)
npm run build      # Build all packages
npm run test       # All tests (unit + examples + OpenSCAD comparison)
npm run validate   # lint + typecheck + test
```

## Testing

See `TESTING.md` for full test structure, commands, and coverage details.
See `packages/openscad/CLAUDE.md` for OpenSCAD transpiler guidance.

OpenSCAD quick reference:
```bash
cd packages/openscad
npx vitest run              # Unit tests (local, fast)
npm test                    # Full suite via CI on gpu (memory-intensive — do not run locally)
npm run test:bosl           # Single suite, local (for debugging)
npm run test:bosl2          # Single suite, local (for debugging)
```
See `packages/openscad/CLAUDE.md` for the full testing strategy.

Skip files auto-discovered from `skip.txt` in each example directory.

## Merge Workflow

Develop on a branch. Every commit auto-pushes the tree to simple-ci
(post-commit hook, tag `commit-<sha>`, superseding the previous job).
Merge only on green:

```bash
scripts/ship.sh [branch]   # land onto main; defaults to the current branch
```

`ship.sh` wraps `land` and adopts its conventions: run it from any worktree,
and the merge itself always happens in the main checkout, which stays on
`main` (never park it on a holding branch — `land` refuses unless the main
repo is on `main`). Concurrent ships serialize on a lock; a branch behind
`main` is rebased first. The exact tree being landed must be CI-green, and
when a rebase replaces it, the landed tree is gated too — a red landed tree
must be investigated or reverted, never left silently. `scripts/pre-land`
and `scripts/post-land` run when present.

Direct commits to `main` are blocked by the pre-commit hook
(bypass with `JSCADUI_ALLOW_MAIN=1`, emergencies only).

Deploy after landing, from the main checkout: the deploy reads hooks from
`apps/jscad-web/deploy/hooks/` (e.g. `apache.configure.post.sh` installs the
frame headers per `APP_NAME`). Deploy only a green, landed `main`.

CI discipline: every commit auto-queues exactly one simple-ci job via the
post-commit hook — never submit duplicate jobs by hand. `ship.sh` waits on
the branch HEAD's job itself and re-gates after a rebase, so do not
`sci wait` before shipping; use `sci wait`/`sci log` only to diagnose a
failure. A green tag on a pre-rebase tree is void after the rebase.

`main` stays linear: the landing is `--ff-only` under the lock. Everything
the branch needs verified must be green before the merge, not after.

Pull requests are used only as the CI channel for sessions that can't reach
simple-ci: opening one makes the GPU host run the OpenSCAD suite on its head
commit (`ci/gpu-poll.mjs`, see `ci/README.md`) and report back on the PR. Never
merge through GitHub; land as above, and GitHub marks the PR merged.

## Refactoring / Future Work

See `docs/backlog.md` (Refactoring section) for remaining structural refactoring TODO items.
