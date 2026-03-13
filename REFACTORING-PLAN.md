# Structural Refactoring — Remaining TODO

Branch: `hierarchical-params` | Last updated: 2026-03-13

## Completed

- ✅ `CacheManager` — O(1) LRU, `packages/require/src/caching/cacheManager.ts`
- ✅ `DependencyProcessor` — `packages/openscad/src/transpiler/dependencies/dependencyProcessor.ts`
- ✅ `WorkerState` — globals 9→1, `packages/worker/src/state/workerState.js`
- ✅ `DeclarationTracker` + `mergeDeclarations.ts` / `transpileDeclaration.ts`
- ✅ `ModuleResolver` — memoised resolution, `packages/require/src/resolution/moduleResolver.js`
- ✅ Sealed proxy in `createParamsProxy.js`
- ✅ Include optimisation (`canOptimizeInclude`) in `transpile.ts`

## Not Done (optional, in rough priority order)

### Async module loading (Phase 3.1)
Replace sync XHR in `readFileWeb.js` with `fetch()`, make `require()` async, parallelize
dependency loading. Breaking change — requires worker protocol update and migration guide.
Estimated: 2–3 weeks.

### Transpiler extraction
- `output/outputBuilder.ts` — extract `buildOutputCode()` (~110 lines)
- `bundling/deduplicator.ts` — extract 3× identical dedup loops from `processIncludeStatements()`
- `bundling/symbolMerger.ts` — extract 3 merge functions (~40 lines)

### Worker extraction
- `src/parameters/parameterHandler.ts` — consolidate 220 lines of parameter logic
- `src/locks/scriptLock.ts` — extract lock/generation code (77 lines)
- `src/geometry/geometryProcessor.ts` — extract Manifold eval + format conversion

### require.js extraction
- `loading/errorRecovery.ts` — extract CDN redirect, .scad search, .ts fallback
- `loading/formatHandler.ts` — extract JSON/custom extension handling

### params-core proxy system (low priority)
- `proxy/proxyHandlers.ts`, `proxy/discoveryTracker.ts`, `proxy/proxyFactory.ts`
- `legacy/legacyConverter.ts`
- `tree/treeBuilder.ts`
