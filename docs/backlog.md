# Backlog

Outstanding work, roughly in the order it should land. Delete an item in the
commit that completes it.

## Deploy

jscad.rkroll.com runs `dev` with the AI chat folded in (2026-09-17): the
frontend is jscad-web hybrid plus the studio API on :3006, the compute frame
on jscad-run.rkroll.com. 2026-09-18: deployed from `main` with local-first
rowboat storage (versioned projects, per-project chat persistence, table sync
on sign-in via `/api/sync-token`). Smoke: site 200, `/api/health` 200,
`/api/sync-token` 401 anonymous, relay 403 on fake origin. The old `main` export breakage (worker requesting
`bundle.jscad_io` with no `/build/` prefix) is fixed on this branch by
requiring the registered `@jscad/io` alias instead. Before merging to `main`,
run the simple-ci `jscadui/render` regression check on `main` and on the
branch (`sci push jscadui/render` rsyncs the working tree, so the checkout
decides what is tested).

## Unpublished @jbroll/jscad-anchors

The package was never published, so the jsdelivr `@0` build 404s. The
default `@jscad/modeling` worker alias now points at the local
`bundle.jscad_modeling.js` instead; anchor-specific requires still fail.
Decide: publish the package (restores anchor models), or vendor a local
anchors bundle built from `/home/john/src/jscad-anchors` (browser-safe CJS,
modeling external). Do this before jscad-fluent 0.7.0.

## Shared WASM handle between clone and colorize

`packages/manifold/src/geometries/ManifoldGeom3.js` `clone()` and
`packages/manifold/src/colors/index.js` `colorize` (lines 33-36) build a new
instance around the same WASM handle. Each instance registers the handle
with the `FinalizationRegistry` that deletes it
(`ManifoldGeom3.js` constructor, `disposalRegistry.register`), so garbage
collecting either object frees the handle the other still uses. Reproduced
through jscad-anchors: after a forced GC, a kept part threw `Cannot pass
deleted object as a pointer of type Manifold const*`. jscad-anchors now
avoids `clone()` for this reason; direct callers of `clone`/`colorize` in
jscadui or elsewhere do not.

## Stale build output accumulates in `build/`

`apps/jscad-web/build.js` does not clean `build/` before writing — it only
removes and recopies `build/examples` (lines 69-71), then writes bundle and
hash output on top of whatever is already there. Building repeatedly on top
of an existing `build/` leaves leftovers: two `main.*.js` files, and doubled
hashes such as `bundle.jscad_io.315b95f2.315b95f2.js`. A single clean build
does not produce these; the fix is to remove `build/` before running.

## Orphaned alias object after a cache clear

`packages/require/src/caching/cacheManager.ts`'s `clearAllCaches` (and
`clearTempCache`) reassign `this.localCache` and `this.aliases` to new empty
objects (lines 340-341). `requireCache` in `require.js` is a snapshot,
`cacheManager.getLegacyCacheObjects()`, taken once at module load
(`require.js:319`); its `alias`/`local` fields still reference the original
objects. `packages/worker/worker.js:182` (`requireCache.alias[name] =
path`) writes to that original object, so after a clear its writes land on
an object `cacheManager` no longer reads.

## Top-level manifold functions bypass anchors

`packages/manifold/src/index.js:76-109` re-exports top-level functions
(`union`, `translate`, `rotate`, ...) beside its namespaces (`booleans`,
`transforms`, ...). `@jbroll/jscad-anchors`'s `src/wrap/groups.js`
classifies namespaced paths only, so a model that takes these top-level
functions from `@jscad/modeling` loses anchors silently in the viewer's
manifold engine.
