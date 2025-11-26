# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jscadui is a JSCAD UI playground - a collection of libraries and example apps for building 3D CAD interfaces using jscad modeling. The main production app is [jscad.app](https://jscad.app) located in `apps/jscad-web`.

## Repository Structure

This is an npm workspaces monorepo with three workspace directories:
- `packages/*` - Core libraries (@jscadui/*)
- `apps/*` - Example applications
- `file-format/*` - File format exporters (3MF)

### Key Packages

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
- `packages/scene` - Scene utilities (grid, axis)

**Rendering:**
- `packages/render-threejs`, `render-babylonjs`, `render-regl`, `render-twgl` - Engine-specific renderers

## Common Commands

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
npm run coverage     # Run tests with coverage
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
