# OpenSCAD Package Testing Guide

All tests run against `apps/jscad-web/examples/` — the vetted production examples.

## Quick Reference

```bash
# Unit tests
npm test

# All examples (comprehensive comparison against OpenSCAD)
npm run test:comparison

# Individual library subsets
npm run test:bosl
npm run test:bosl2
npm run test:snippet
npm run test:basics

# Single file CLI
node bin/run-jscad.js path/to/file.scad
```

---

## 1. npm Scripts

| Script | What it tests |
|--------|---------------|
| `npm test` | Build + unit tests + full comparison suite |
| `npm run test:unit` | Unit tests only (vitest) |
| `npm run test:comparison` | All examples in `apps/jscad-web/examples/openscad/` |
| `npm run test:bosl` | BOSL v1 examples |
| `npm run test:bosl2` | BOSL2 examples |
| `npm run test:snippet` | Snippet/community examples |
| `npm run test:basics` | 01-basics examples |

### Skip files

Each library directory may have a `skip.txt` listing files to exclude. The test harness auto-discovers these — no `--skip-file` flags needed:

```
apps/jscad-web/examples/openscad/
├── bosl/skip.txt        ← auto-loaded for bosl tests
├── bosl2/skip.txt       ← auto-loaded for bosl2 tests
└── snippet/skip.txt     ← auto-loaded for snippet tests
```

To add a file to a skip list, append to the relevant `skip.txt` with a comment explaining why.

---

## 2. Test Harness (Direct CLI)

```bash
cd packages/openscad

# Test all examples
node bin/test-harness.js ../../apps/jscad-web/examples/openscad

# Test a specific library
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl2

# Test a specific subdirectory
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl2/01-core

# Filter to specific files
node bin/test-harness.js ../../apps/jscad-web/examples/openscad --match "*/bosl/*"

# Show all results (including passes)
node bin/test-harness.js ../../apps/jscad-web/examples/openscad --verbose
```

Skip files in each directory are auto-discovered. Explicit overrides still work:

```bash
node bin/test-harness.js ../../apps/jscad-web/examples/openscad --skip-file my-extra-skip.txt
```

### Understanding output

```
align.scad: PASS (1.0000)
dashed-stroke.scad: FAIL (0.4512)   ← low Jaccard similarity
interior-fillet.scad: NOT GRADED - reference OpenSCAD: ...  ← OpenSCAD itself failed
my-module.scad: ERROR - JSCAD: ...   ← transpiler/runtime error

Summary: 128 passed, 1 failed, 1 errors out of 130 tested (98.5%)
Not graded: 12 whose OpenSCAD reference failed (NOT GRADED above)
Skipped: 5 in skip list
```

A model whose reference render fails is listed by name and left out of
`tested`; it does not fail the run. Reference STLs, and a `.failed` sentinel for
a reference that errored, are cached in `~/.cache/jscadui/openscad-stl/<lib>/`,
invalidated when that library's `lib/` or the OpenSCAD version changes. A
reference that hits the 60s limit is not cached, so a timeout under load is
retried on the next run.

---

## 3. Browser Testing

Start the dev server and open examples directly:

```bash
cd apps/jscad-web
npm run dev
```

URL format:
```
http://localhost:PORT/#examples/openscad/bosl2/01-core/align.scad
http://localhost:PORT/#examples/openscad/snippet/02-intermediate/Coin_02.scad
http://localhost:PORT/#examples/openscad/bosl/ALL.js
```

---

## 4. CLI Testing (Single Files)

```bash
cd packages/openscad

# Transpile and run
node bin/run-jscad.js path/to/file.scad

# Export to STL
node bin/run-jscad.js file.scad -o output.stl

# Show transpiled JavaScript
node bin/run-jscad.js file.scad --debug-transpile

# Include source line comments
node bin/run-jscad.js file.scad --source-comments
```

For files that use library includes (BOSL, BOSL2), the lib-path is auto-detected from the file's location. Explicit override if needed:

```bash
node bin/run-jscad.js ../../apps/jscad-web/examples/openscad/bosl2/01-core/align.scad \
  --lib-path ../../apps/jscad-web/examples/openscad/bosl2
```

---

## 5. Display Conversion (browser-only failures)

The STL path unions `main()`'s result; the browser converts every entity
separately and rejects anything that is not geometry. `display-check.js` runs
that conversion in Node, so a browser-only failure can be reproduced without a
browser:

```bash
node bin/display-check.js file.scad [--preview] [--lib-path <p>] [--fn <n>]
```

It prints each rejected entity with the reason, e.g. `invalid jscad geometry,
not an object — symbol Symbol(no_child)`, and exits 1. A result with no
entities, or none with a vertex, prints `empty:` and exits 3, since the browser
draws nothing for it.

### Open 2D geometry

`linear_extrude` and friends call `geom2.toOutlines()`, which throws
`geometry is not closed at vertex x,y`. The throw names the extrusion, not the
boolean that broke the profile. `geom2-trace.js` wraps `union`, `subtract` and
`intersect`, checks every geom2 they return, and reports the first open result
with its dangling vertices, the geometry's epsilon and how far apart the
unmatched points are:

```bash
node bin/geom2-trace.js file.scad --engine jscad [--lib-path <p>] [--fn <n>] \
  [--preview] [--all] [--dump <file>]
```

Each dangling vertex is reported with the distance to the vertex a repair
would have to join it to, in epsilon units. A partner within a few epsilon is
a snapping failure; hundreds or thousands of epsilon means whole sides are
missing from the boolean's output. `--all` reports every open result rather
than only the first, and `--dump` writes the first one's operands as JSON so
that single boolean call can be replayed without the model around it.

Pass `--preview` to match what the browser runs. Several models fail in the
render sweep and not here without it.

---

## 6. Unit Tests

```bash
cd packages/openscad

# Run all unit tests
npm run test:unit

# Watch mode
npm run test:watch

# Run specific test file
npx vitest run test/transpile.test.ts

# Run tests matching pattern
npx vitest run -t "function calls"
```

---

## 7. Debugging Failures

### Check transpiled output

```bash
node bin/transpile-file.js path/to/file.scad --source-comments
```

### Test workflow

1. **Identify failing file** from test output
2. **Run individually**: `node bin/run-jscad.js path/to/file.scad`
3. **Check transpiled code**: `node bin/transpile-file.js path/to/file.scad`
4. **Fix and rebuild**: `npm run build`
5. **Re-run comparison**: `npm run test:comparison`

### Adding to skip list

When a file fails due to a known unfixable issue:

1. Identify the root cause (library bug, font difference, rands() mismatch, etc.)
2. Add to the appropriate `apps/jscad-web/examples/openscad/{library}/skip.txt`:

```
# Reason for skipping
filename.scad
```

3. Re-run the test to verify it's now skipped

---

## 8. Comparing with OpenSCAD

```bash
# Generate reference STL from OpenSCAD
openscad --backend=manifold -o reference.stl file.scad

# Generate JSCAD output
node bin/run-jscad.js file.scad -o generated.stl

# Compare
node bin/compare-stl.js reference.stl generated.stl
```

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot find module" | Run `npm install` in package directory |
| Build errors | Run `npm run build` |
| Browser shows old code | Clear cache or use Ctrl+Shift+R |
| Test harness shows 0 files | Check path — should point to a directory containing .scad files |
| Wrong PORT in browser URL | Check dev server console output for actual port |
| 404 in browser | Use `#examples/` not `#src=./examples/` |
