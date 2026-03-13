# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

jscadui is a JSCAD UI playground — libraries and apps for building 3D CAD interfaces.
Main production app: [jscad.app](https://jscad.app) at `apps/jscad-web`. See `README.md`.

**Targets modern browsers only.** Uses ES2022+ features without polyfills. No compat shims.

## Repository Structure

npm workspaces monorepo: `packages/*` (libraries), `apps/*` (applications), `file-format/*` (exporters).

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
npx vitest run              # Unit tests
npm run test:comparison     # Full comparison suite
npm run test:bosl           # BOSL v1 only
npm run test:bosl2          # BOSL2 only
```

Skip files auto-discovered from `skip.txt` in each example directory.

## PR Workflow

Rebase merges only:
```bash
gh pr merge <PR_NUMBER> --rebase --delete-branch
```

## Refactoring / Future Work

See `REFACTORING-PLAN.md` for remaining structural refactoring TODO items.
