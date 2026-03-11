# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

jscadui is a JSCAD UI playground — libraries and apps for building 3D CAD interfaces. The main production app is [jscad.app](https://jscad.app) at `apps/jscad-web`. See `README.md` for full details.

## Browser Support

**Targets modern browsers only.** Uses ES2022+ features (`Object.hasOwn`, private class fields `#field`, etc.) without polyfills. Do not add compatibility shims.

## Repository Structure

npm workspaces monorepo: `packages/*` (libraries), `apps/*` (applications), `file-format/*` (exporters).

See `README.md` for the full package list and architecture overview.

## Common Commands

```bash
# From monorepo root
npm run dev        # All dev servers (turbo)
npm run build      # Build all packages
npm run test       # Run all tests
npm run validate   # lint + typecheck + test

# jscad-web app
cd apps/jscad-web
npm run start      # Dev server

# Individual packages
cd packages/<name>
npm test           # vitest
```

## OpenSCAD Testing

```bash
cd packages/openscad

# Unit tests
npx vitest run

# Full comparison suite (all examples)
npm run test:comparison

# Individual library subsets
npm run test:bosl
npm run test:bosl2
npm run test:snippet
npm run test:basics
```

Skip files (`skip.txt`) in each library directory are auto-discovered — no flags needed.
To skip a file, add it to `apps/jscad-web/examples/openscad/{library}/skip.txt`.

**Always test against `apps/jscad-web/examples/`** — these are the vetted production examples.

See `packages/openscad/CLAUDE.md` for transpiler-specific guidance.

## PR Workflow

Rebase merges only — merge commits and squash merges are disabled.

```bash
gh pr merge <PR_NUMBER> --rebase --delete-branch
```
