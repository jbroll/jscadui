# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

jscadui is a JSCAD UI playground — libraries and apps for building 3D CAD interfaces.
Main production app: [jscad.app](https://jscad.app) at `apps/jscad-web`. See `README.md`.

**Targets modern browsers only.** Uses ES2022+ features without polyfills. No compat shims.

## Repository Structure

npm workspaces monorepo: `packages/*` (libraries), `apps/*` (applications), `file-format/*` (exporters).

## Setup

Fresh clone: `npm run setup` (pinned source checkouts, `npm install`, OpenSCAD
corpora). Cloud sessions run the same via `.claude/hooks/session-start.sh`.
`@jscad/modeling` resolves to `.deps-cache/OpenJSCAD.org` (pinned in
`scripts/deps/sources.json`); symlink your own checkout there to edit it live.
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

Develop on a branch, fast-forward it into `main`, push:

```bash
git checkout main
git merge --ff-only <branch>
git push
```

`--ff-only` is the point: `main` stays linear. If the merge is refused, rebase
the branch on `main` and try again. Everything the branch needs verified must be
green before the merge, not after.

Pull requests are used only as the CI channel for sessions that can't reach
simple-ci: opening one makes the GPU host run the OpenSCAD suite on its head
commit (`ci/gpu-poll.mjs`, see `ci/README.md`) and report back on the PR. Never
merge through GitHub; fast-forward as above, and GitHub marks the PR merged.

## Refactoring / Future Work

See `REFACTORING-PLAN.md` for remaining structural refactoring TODO items.
