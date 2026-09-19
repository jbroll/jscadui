# Fluent bundle in the production worker — design

Date: 2026-09-19. Status: all sections approved in brainstorming.

## Goal

`require('@jbroll/jscad-fluent')` resolves inside the production workers so
fluent-writing agents run in the app, with full params support and existing
demos untouched.

## Background

Both apps build worker bundles from `src_bundle/` via esbuild (`build.js`)
and map module names to bundle URLs through the `bundles` option of
`jscadInit` (`bundles.js` in jscad-web, equivalent in studio-run).
`bundle.model-tools.js` is the precedent: a thin re-export with
`@jscad/modeling` external, loaded lazily on first `require`, keeping one
shared modeling copy. The worker extracts params from source text
(`@jscad-params`) or the `getParameterDefinitions` export — both work for
any CJS module, and fluent ships neither of its own, so params ride the
classic paths with no plumbing changes.

## 1. Bundle and alias (both apps)

- New `src_bundle/bundle.jscad-fluent.js` re-exporting
  `@jbroll/jscad-fluent`, `@jscad/modeling` external.
- `build.js` entry per app (cjs format, same loader treatment as the
  model-tools bundle).
- Bundle alias `'@jbroll/jscad-fluent'` pointing at the built file, in
  `bundles.js` (web) and the studio-run equivalent.
- `file:` dependency on the local fluent checkout in both apps, matching
  the agent-loop devDependency.

## 2. Back-compat

Purely additive: no existing bundle, alias, or demo changes. The fluent
bundle loads lazily on first `require`, so initial demo load is unchanged.
Gate: both apps' existing example suites pass unmodified. No shipped
fluent demo.

## 3. Tests

Worker-API tests with real fluent sources through the built bundles: a
fluent cube renders entities; a fluent model with an `@jscad-params`
block and one with a `getParameterDefinitions` export both yield defs
through the existing params path. Node-side execution stays covered by
the eval backend tests.

## Non-goals

Fluent-native params API, shipped fluent demos, CDN sourcing, CI live runs.
