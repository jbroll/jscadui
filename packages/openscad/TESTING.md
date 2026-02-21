# OpenSCAD Package Testing Guide

Comprehensive guide for testing OpenSCAD transpilation and examples.

## Quick Reference

```bash
# Unit tests
npm test

# Test single file CLI
node bin/run-jscad.js file.scad

# Test corpus (with library includes)
node bin/test-harness.js test/corpus/bosl2

# Browser testing
# Start dev server, then navigate to:
http://localhost:PORT/#examples/openscad/bosl2/01-core/align.scad
```

---

## 1. Browser Testing (Primary Method)

### Starting the Dev Server

```bash
cd apps/jscad-web
npm run dev
```

This starts a server at `http://127.0.0.1:PORT` (port shown in console output).

### Loading Examples

**URL Format:**
```
http://localhost:PORT/#examples/PATH/TO/FILE.scad
```

**Important:**
- Use `#examples/` (NOT `#src=./examples/`)
- Path is relative to `apps/jscad-web/examples/`
- Examples:
  ```
  http://localhost:39475/#examples/openscad/bosl2/01-core/align.scad
  http://localhost:39475/#examples/openscad/snippet/02-intermediate/Coin_02.scad
  http://localhost:39475/#examples/openscad/snippet/02-intermediate/ALL.js
  ```

### Testing Files with Dependencies

Files like `Coin_02.scad` that use `use <Coin_01.scad>` should load automatically if the fix is working.

**Example:**
```
http://localhost:39475/#examples/openscad/snippet/02-intermediate/Coin_02.scad
```

Expected: Renders a gold coin (uses Coin_01.scad module internally)

### Common Browser Errors

| Error | Cause | Solution |
|-------|-------|----------|
| 404 Not Found | Wrong URL format | Use `#examples/` not `#src=./examples/` |
| "Failed to load module" | Path doubling bug | Check resolvedPath in transpiler |
| "file not found .scad" | Missing library include | Add `--lib-path` or check fileResolver |

---

## 2. Test Harness (Corpus Testing)

The test harness runs multiple files and reports pass/fail statistics.

### Basic Usage

```bash
cd packages/openscad

# Test all BOSL2 examples
node bin/test-harness.js test/corpus/bosl2

# Test BOSL v1 examples
node bin/test-harness.js test/corpus/bosl

# Test specific subdirectory
node bin/test-harness.js test/corpus/bosl2/01-core
```

### Understanding Test Harness Output

```
Testing directory: test/corpus/bosl2
Found 145 .scad files
Processing: align.scad ✓
Processing: interior-fillet.scad ✗ (skipped - in skip.txt)
...
Results: 128/145 passed (88.3%)
Failed: 17 files
```

### Skip List

Files in `test/corpus/bosl2/skip.txt` are excluded from testing.

**Format:**
```
# Comment explaining why file is skipped
filename.scad

# Another comment
another-file.scad
```

**Categories:**
- Library bugs (e.g., `interior-fillet.scad` - BOSL2 parameter order bug)
- Function tests (e.g., `comparisons-ex.scad` - produces empty geometry)
- Transpiler bugs (e.g., `dashed-stroke.scad` - polygon generation issue)

---

## 3. CLI Testing (Single Files)

### Basic File Testing

```bash
cd packages/openscad

# Transpile and run
node bin/run-jscad.js path/to/file.scad

# Export to STL
node bin/run-jscad.js file.scad -o output.stl

# Show volume (for comparison with OpenSCAD)
node bin/run-jscad.js file.scad --volume
```

### Testing with Library Includes

**Critical:** Most BOSL/BOSL2 files need library paths set.

```bash
# BOSL2 examples
node bin/run-jscad.js \
  ../../apps/jscad-web/examples/openscad/bosl2/01-core/align.scad \
  --lib-path ../../apps/jscad-web/examples/openscad/bosl2

# Multiple library paths
node bin/run-jscad.js file.scad \
  --lib-path /path/to/lib1 \
  --lib-path /path/to/lib2
```

### Debug Options

```bash
# Show transpiled JavaScript
node bin/run-jscad.js file.scad --debug-transpile

# Include source line comments in transpiled code
node bin/run-jscad.js file.scad --source-comments

# Show volume and bounding box
node bin/run-jscad.js file.scad --volume --bbox
```

---

## 4. Unit Tests

```bash
cd packages/openscad

# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest run src/parser/parse.test.ts

# Run tests matching pattern
npx vitest run -t "function calls"
```

---

## 5. Transpiler Testing

### Transpile Single File

```bash
cd packages/openscad

# Transpile and print JavaScript
node bin/transpile-file.js file.scad

# Transpile and execute
node bin/transpile-file.js file.scad --run

# Show detailed info (exports, imports, all transpiled files)
node bin/transpile-file.js file.scad --info

# Include source comments for debugging
node bin/transpile-file.js file.scad --source-comments
```

### Example: Testing Multi-File Dependencies

```bash
# Transpile file with dependencies
node bin/transpile-file.js \
  ../../apps/jscad-web/examples/openscad/snippet/02-intermediate/Coin_02.scad \
  --info

# Expected output shows:
# Exports: []
# Imports: Coin_01_$m (from Coin_01.scad)
# Transpiled Files:
#   [/examples/.../Coin_01.scad] exports: Coin_01_$m
#   [/examples/.../Coin_02.scad] exports: (none)
```

---

## 6. Comparing with OpenSCAD

### Generate STL from OpenSCAD

```bash
openscad -o reference.stl file.scad
```

### Compare STL Files

```bash
cd packages/openscad

# Compare transpiled output with OpenSCAD reference
node bin/compare-stl.js reference.stl output.stl
```

This compares:
- Triangle count
- Vertex positions (with tolerance)
- Overall geometry structure

---

## 7. Common Test Workflows

### Testing a Bug Fix

1. **Identify failing file:**
   ```bash
   node bin/test-harness.js test/corpus/bosl2 | grep "✗"
   ```

2. **Test file individually:**
   ```bash
   node bin/run-jscad.js path/to/failing.scad --lib-path ...
   ```

3. **Check transpiled code:**
   ```bash
   node bin/transpile-file.js path/to/failing.scad --source-comments
   ```

4. **Fix and verify:**
   ```bash
   npm run build  # Rebuild transpiler
   node bin/run-jscad.js path/to/failing.scad --lib-path ...
   ```

5. **Test in browser:**
   ```bash
   cd apps/jscad-web
   npm run build  # Rebuild browser bundles
   npm run dev
   # Navigate to http://localhost:PORT/#examples/path/to/failing.scad
   ```

### Testing Examples with Dependencies

**Example: Coin_02.scad (uses Coin_01.scad)**

```bash
# CLI test
cd packages/openscad
node bin/run-jscad.js \
  ../../apps/jscad-web/examples/openscad/snippet/02-intermediate/Coin_02.scad

# Browser test
cd apps/jscad-web
npm run dev
# Navigate to:
# http://localhost:39475/#examples/openscad/snippet/02-intermediate/Coin_02.scad
```

Expected: Renders a gold coin (Mat=2 parameter from Coin_02 using Coin_01 module)

### Adding Files to Skip List

When a file fails due to a known issue:

1. **Identify root cause** (library bug, transpiler limitation, etc.)

2. **Add to skip.txt with explanation:**
   ```bash
   cd packages/openscad/test/corpus/bosl2
   nano skip.txt
   ```

   Add:
   ```
   # BOSL2 bug: interior_fillet() has incorrect parameter order
   interior-fillet.scad
   ```

3. **Regenerate examples** (if file was in examples):
   ```bash
   cd packages/openscad
   node bin/generate-all-files.js
   ```

4. **Verify skip works:**
   ```bash
   node bin/test-harness.js test/corpus/bosl2 | grep interior-fillet
   # Should show: "✗ (skipped)"
   ```

---

## 8. Debugging Path Resolution Issues

### Symptoms
- Error: `failed to load module .//examples/...` (note double slash)
- Error: `file not found http://.../.../examples/.../file.scad` (path doubled)

### Debug Steps

1. **Check transpiled require() statements:**
   ```bash
   node bin/transpile-file.js file.scad | grep "require("
   ```

   Should see:
   ```javascript
   const { module_$m } = require('/absolute/path/to/file.scad')
   ```

   NOT:
   ```javascript
   const { module_$m } = require('.//absolute/path/to/file.scad')
   ```

2. **Check fileResolver return value:**

   In `bundle.worker.js` or `transpile-file.js`, fileResolver must return:
   ```javascript
   {
     path: "/absolute/path/to/file.scad",  // No ./ prefix!
     content: "... file content ..."
   }
   ```

3. **Verify resolveUrl handling:**

   The transpiler generates `require(resolvedPath)` where resolvedPath is absolute.
   The require system's resolveUrl() strips the leading "/" and resolves from root.

---

## 9. Test Coverage

### Current Status

| Category | Pass Rate | Notes |
|----------|-----------|-------|
| BOSL v1 | ~100% | All working examples |
| BOSL2 Core | ~95% | 17 files in skip.txt |
| Snippets | 100% | After path fix |
| Unit Tests | 100% | Parser, transpiler, runtime |

### Files in Skip List

See `packages/openscad/test/corpus/bosl2/skip.txt` for current list.

**Categories:**
- **Library bugs (3)**: interior-fillet, egg, oval
- **Function tests (10)**: comparisons-ex, fnliterals-ex, hooks-ex, etc.
- **Transpiler bugs (4)**: dashed-stroke, torus, hull-points, miscellaneous-ex

---

## 10. Performance Testing

### Measure Transpile Time

```bash
time node bin/transpile-file.js large-file.scad > /dev/null
```

### Measure Execution Time

```bash
time node bin/run-jscad.js large-file.scad -o /dev/null
```

### Memory Usage

```bash
/usr/bin/time -v node bin/run-jscad.js large-file.scad -o /dev/null 2>&1 | grep "Maximum resident"
```

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot find module" | Run `npm install` in package directory |
| "tsc not found" | Run `npm run build` from root |
| Browser shows old code | Clear cache or use Ctrl+Shift+R |
| Test harness shows 0 files | Check path - should be relative to packages/openscad |
| Wrong PORT in browser URL | Check dev server console output for actual port |
| 404 in browser | Use `#examples/` not `#src=./examples/` |
