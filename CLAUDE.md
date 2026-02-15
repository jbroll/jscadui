# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jscadui is a JSCAD UI playground - a collection of libraries and example apps for building 3D CAD interfaces using jscad modeling. The main production app is [jscad.app](https://jscad.app) located in `apps/jscad-web`.

## Browser Support

**This project targets modern browsers only.** We use ES2022+ features (like `Object.hasOwn`, private class fields `#field`, etc.) without polyfills. Do not add compatibility shims for older browsers.

## Repository Structure

This is an npm workspaces monorepo with three workspace directories:
- `packages/*` - Core libraries (@jscadui/*)
- `apps/*` - Example applications
- `file-format/*` - File format exporters (3MF)

### Key Packages

**OpenSCAD Support:**
- `packages/openscad` - Transpiles OpenSCAD (.scad) files to JavaScript for execution in the JSCAD worker
- `packages/openscad-runtime` - Runtime helpers for transpiled OpenSCAD code
- `packages/manifold` - Manifold-based CSG operations, drop-in replacement for @jscad/modeling booleans

**Geometry Conversion Pipeline:**
- `packages/format-jscad` - Converts JSCAD CSG geometries to WebGL-ready format (Float32Arrays for vertices/normals/indices)
- `packages/format-common` - TypeScript type definitions for the geometry pipeline
- `packages/format-threejs`, `format-babylonjs`, `format-regl`, `format-twgl` - Renderer-specific adapters

**Worker System:**
- `packages/worker` - Web Worker for executing JSCAD scripts, handles `jscadInit`, `jscadScript`, `jscadMain`, exports
- `packages/postmessage` - RPC-style postMessage wrapper for worker communication
- `packages/require` - ES module loader/resolver for worker, supports npm packages from unpkg

**UI Components:**
- `packages/orbit` - Camera orbit controls (works with CSS transforms and multiple 3D engines)
- `packages/html-gizmo` - Camera orientation gizmo widget
- `packages/params-form` - No-dependency parameter form generator from JSCAD parameter definitions
- `packages/params-proxy` - Hierarchical parameter system with inline parameter definitions
- `packages/scene` - Scene utilities (grid, axis)

**Rendering:**
- `packages/render-threejs`, `render-babylonjs`, `render-regl`, `render-twgl` - Engine-specific renderers

## Common Commands

### Root-level commands (from monorepo root)
```bash
npm run dev          # Run all dev servers (turbo)
npm run build        # Build all packages (turbo)
npm run test         # Run all tests (turbo)
npm run lint         # ESLint check
npm run lint:fix     # ESLint autofix
npm run typecheck    # TypeScript check
npm run validate     # lint + typecheck + test
```

### Development (jscad-web app)
```bash
cd apps/jscad-web
npm run start        # Dev server with hot reload (skips docs generation)
npm run start:full   # Dev server including docs generation
npm run build        # Production build
npm run serve        # Serve production build
```

### Testing (individual packages)
Most packages use vitest:
```bash
cd packages/orbit    # or require, worker, etc.
npm test             # Run tests with vitest
npm run test:watch   # Run tests in watch mode
npm run coverage     # Run tests with coverage

# Run single test file
npx vitest run path/to/test.test.ts

# Run tests matching pattern
npx vitest run -t "pattern"
```

### OpenSCAD package testing
```bash
cd packages/openscad
npm test             # Build + vitest + test-harness (corpus tests)

# Run test-harness on specific directories
node bin/test-harness.js test/corpus/bosl

# Compare STL output
node bin/compare-stl.js file1.stl file2.stl
```

### Building packages
```bash
cd packages/<package-name>
npm run build        # ESM bundle
npm run build-cjs    # CJS bundle
```

## Architecture Notes

**Geometry Flow:** JSCAD script runs in worker -> produces CSG polygons -> `format-jscad` converts to Float32Arrays (vertices, normals, indices) -> transferred via postMessage (zero-copy) -> renderer-specific format package adapts for Three.js/Babylon/regl

**Worker Communication:** Uses `@jscadui/postmessage` which wraps postMessage with Promise-based RPC semantics. The worker exposes `jscadScript` (load and run script), `jscadMain` (run with parameters), `jscadExportData` (export formats).

**Module Loading:** Scripts in the worker can use ES6 imports, require(), and even npm packages (loaded from unpkg). TypeScript is supported via Babel transform.

**Instanced Rendering:** When `userInstances` is enabled, identical geometries are deduplicated and rendered as instances for performance.

**OpenSCAD Transpilation:** The `@jscadui/openscad` package parses `.scad` files, recursively resolves `use` statements, and transpiles to JavaScript with cached results. See `packages/openscad/ARCHITECTURE.md` for details.

**Hierarchical Parameters:** The `params-proxy` package enables inline parameter definitions in model code (e.g., `params.radius = { type: 'slider', default: 5 }`). Parameters are organized in a tree structure and can be linked via `_class` for synchronized updates. Fully backwards-compatible with traditional `getParameterDefinitions()`.

## PR Workflow

This repository only allows **rebase merges**. Merge commits and squash merges are disabled.

```bash
gh pr merge <PR_NUMBER> --rebase --delete-branch
```
