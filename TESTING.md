# Testing Strategy for jscadui

Comprehensive testing documentation for the jscadui monorepo covering unit tests, example execution tests, and OpenSCAD comparison tests.

## Quick Start

```bash
# Run ALL tests (unit + JSCAD examples + OpenSCAD comparison)
npm test

# Run only unit tests (fast, for development)
npm run test:unit

# Run specific test categories
npm run test:examples          # JSCAD examples only
npm run test:openscad          # OpenSCAD comparison only
npm run test:e2e               # Browser E2E tests only

# Validate everything (lint + typecheck + all tests)
npm run validate
```

## Summary

The jscadui project has three main test categories:

1. **Unit Tests**: 32 packages with vitest tests (~1,000+ tests)
2. **JSCAD Examples**: 27 example files tested for execution (100% pass)
3. **OpenSCAD Examples**: 784 .scad files tested against OpenSCAD (98% pass)

---

## Test Categories

### 1. Unit Tests (Vitest)

**What**: Test individual functions, classes, and modules in isolation.

**Coverage**:
- 70+ packages with unit tests
- Parser/transpiler logic
- Geometry operations
- UI components
- Worker communication
- Parameter system

**Run**:
```bash
# All packages
npm test

# Specific package
cd packages/openscad
npm test

# Watch mode
npm run test:watch

# Coverage
npm run coverage
```

**Key packages with tests**:
- `packages/openscad` - Transpiler and parser
- `packages/manifold` - Manifold operations
- `packages/require` - Module loading
- `packages/worker` - Worker execution
- `packages/params-*` - Parameter system
- `packages/format-*` - Format conversion
- `packages/render-*` - Rendering engines

---

### 2. JSCAD Example Execution Tests

**What**: Execute all JSCAD example files to ensure they load and run without errors.

**Coverage**: 27 JSCAD example files in `apps/jscad-web/examples/jscad/`

**Test file**: `apps/jscad-web/examples.test.js`

**What it tests**:
- ✅ Examples load without syntax errors
- ✅ `main()` function executes
- ✅ Parameter definitions work correctly
- ✅ Hierarchical and legacy parameter modes
- ✅ Relative requires work

**Run**:
```bash
# From root
npm run test:examples

# From apps/jscad-web
npm test
```

---

### 3. OpenSCAD Example Tests

**What**: Test OpenSCAD examples in two phases:
1. **Execution testing** - Verify all models (.scad and .js) execute without errors (fast)
2. **Comparison testing** - Compare .scad output against OpenSCAD+Manifold (slow, accurate)

**Why two phases**: Execution tests catch errors quickly. Comparison tests ensure geometric accuracy.

**Coverage**: 784+ model files in `apps/jscad-web/examples/openscad/`

**Categories**:
- `01-basics/` - Basic OpenSCAD primitives and operations (20 files, 100% pass)
- `bosl/` - BOSL v1 library examples (100% pass)
- `bosl2/` - BOSL2 library examples (100% pass, skip list empty)
- `snippet/` - Real-world examples (100% pass)
- `text/` - Text operations

**Test phases**:

#### Phase 1: Execution Testing (Fast) - All Models
Tests **all model files** (.scad and .js) for execution errors:
- ✅ .scad files: transpile → execute → produce geometry
- ✅ .js files: load → execute → produce geometry
- ✅ ALL.js files tested last (since they aggregate individual files)
- ⚡ Uses Manifold backend for execution
- ⚡ No STL comparison (fast!)

**Tool**: `apps/jscad-web/test-models-execution.js` (generic model tester)

```bash
# From root
npm run test:openscad

# From apps/jscad-web
npm run test:execution

# From packages/openscad
npm run test:execution
```

#### Phase 2: Comparison Testing (Slow)
Compares .scad output against OpenSCAD+Manifold:
- ✅ Geometry matches OpenSCAD reference (Jaccard similarity > 0.99)
- ✅ STL vertex positions and triangle counts match
- ✅ Uses `openscad --backend=manifold` for watertight geometry

```bash
npm run test:comparison
```

**Run all tests**:
```bash
# From root
npm run test:openscad

# From packages/openscad
npm test                      # Unit + execution + comparison
npm run test:unit             # Just vitest unit tests
npm run test:execution        # Just execution tests
npm run test:comparison       # Just comparison tests
npm run test:basics           # Comparison tests on basics only

# CLI tools directly
node apps/jscad-web/test-models-execution.js <dir> --all-last
node packages/openscad/bin/test-harness.js <dir> --skip-file <path>
```

**Test harness options**:
```bash
node bin/test-harness.js <dir> [options]

Options:
  --skip-file <path>      Skip files listed in file
  --match <glob>          Only test files matching pattern
  --threshold <n>         Minimum Jaccard score (default: 0.99)
  --fn <n>                Set $fn for both OpenSCAD and transpiler
  --concurrency <n>       Parallel test count (default: CPU-1)
  --verbose               Detailed output
  --json                  JSON output for CI
```

---

### OpenSCAD Example Pipeline

The `.scad` files in `apps/jscad-web/examples/openscad/` are **generated, not committed**. They are built from upstream library sources and deployed as-is. The `skip.txt` files in each category directory are committed; everything else is generated.

#### Pipeline Overview

```
npm run fetch-deps
  └─ scripts/fetch-deps.js
       ├─ Clone/update upstream repos into .deps-cache/
       ├─ Copy files per scripts/deps/manifest.json mappings
       │    to packages/openscad/test/corpus/
       ├─ Apply text-replace patches (fix include paths)
       └─ Run packages/openscad/bin/organize-corpus.js
            └─ Copy batched files to apps/jscad-web/examples/openscad/
```

**BOSL2** also requires an extraction step before `fetch-deps` can produce examples:

```bash
cd packages/openscad
node bin/extract-bosl2-examples.js   # Extract // Example: blocks from lib/*.scad
node bin/extract-bosl1-examples.js   # Same for BOSL v1
```

These extractors scan each library `.scad` file for `// Example:` doc blocks and generate numbered test files (`NNN-module-name.scad`) in `test/corpus/bosl2/` or `test/corpus/bosl/`.

#### Step-by-Step: Fresh Clone

```bash
# 1. Extract inline examples from library docs (generates test/corpus/bosl{,2}/*.scad)
cd packages/openscad
node bin/extract-bosl2-examples.js
node bin/extract-bosl1-examples.js

# 2. Fetch all deps and rebuild examples dir (from repo root)
npm run fetch-deps

# 3. Verify the examples are present
ls apps/jscad-web/examples/openscad/bosl2/
```

#### Step-by-Step: Update to Latest Library Version

```bash
# Re-fetch repos, pin new commit SHAs in manifest.json, rebuild examples
npm run fetch-deps:update
```

#### Step-by-Step: Only Fetch If Missing (CI / first-run shortcut)

```bash
npm run fetch-deps:missing
```

#### manifest.json Structure (`scripts/deps/manifest.json`)

Each entry in `deps[]` describes one upstream source:

| Field | Purpose |
|-------|---------|
| `url` | Git repo URL to clone |
| `ref` / `commit` | Branch or pinned SHA (updated by `--update`) |
| `mappings[].srcDir` | Subdirectory inside cloned repo to copy from |
| `mappings[].destDir` | Destination under the jscadui repo root |
| `mappings[].include` | Glob patterns to include (e.g. `["*.scad"]`) |
| `patches[]` | Text-replace patches applied after copy |

Patches fix include paths, e.g. `"BOSL2/"` → `"lib/"` so examples can find the library files that were copied into `lib/`.

#### organize-corpus.js

After `fetch-deps` copies files into `packages/openscad/test/corpus/`, `organize-corpus.js`:

1. Reads `packages/openscad/test/corpus/manifest.json` to find categories (`bosl`, `bosl2`, `snippet`)
2. Reads each category's `skip.txt` to exclude known-broken files
3. Splits files into batches of 30 (default) and copies them into numbered subdirectories:
   - `apps/jscad-web/examples/openscad/bosl/01-part1/`, `02-part2/`, …
4. Numbered files (`NNN-name.scad`) go first; unnumbered files go to the last batch

Options:
```bash
node bin/organize-corpus.js --dry-run              # Preview without writing
node bin/organize-corpus.js --category=bosl2       # One category only
node bin/organize-corpus.js --batch-size=50        # Custom batch size
node bin/organize-corpus.js --force                # Overwrite existing dirs
```

#### What Is and Isn't Committed

| Path | Committed? |
|------|-----------|
| `scripts/deps/manifest.json` | Yes — defines what to fetch |
| `scripts/deps/patches/` | Yes — patch files if any |
| `packages/openscad/bin/extract-bosl*.js` | Yes — extraction scripts |
| `packages/openscad/test/corpus/` | No — generated by fetch-deps |
| `apps/jscad-web/examples/openscad/` | No — generated by organize-corpus |
| `apps/jscad-web/examples/openscad/*/skip.txt` | Yes — known failures list |
| `.deps-cache/` | No — git clone cache |

#### Adding New Test Cases

- **BOSL2/BOSL1 inline examples**: Add a `// Example:` block to the library source, then re-run the extract script and `npm run fetch-deps`.
- **Snippet (real-world) examples**: Drop the `.scad` file into `packages/openscad/test/corpus/snippet/`, re-run `npm run fetch-deps`.
- **Skip a failing file**: Add its filename to the appropriate `apps/jscad-web/examples/openscad/<category>/skip.txt` — this file is committed and survives regeneration.

---

### 4. End-to-End Browser Tests (Playwright)

**What**: Test the full application in a real browser environment.

**Coverage**:
- Application startup and initialization
- File loading from URL hash
- Worker execution
- Renderer initialization
- Parameter UI interaction
- Export functionality

**Run**:
```bash
cd apps/jscad-web
npm run test:e2e
```

**Proposed test cases**:
1. **Basic loading**:
   - Load JSCAD example via hash
   - Load OpenSCAD example via hash
   - Verify 3D rendering appears

2. **Parameter interaction**:
   - Change slider parameter
   - Verify re-render
   - Test hierarchical parameters

3. **File operations**:
   - Export STL
   - Export 3MF
   - Load local file

4. **Worker communication**:
   - Script execution
   - Error handling
   - Progress updates

5. **Performance**:
   - Large model loading
   - Instanced rendering
   - Memory usage

---

## Test Organization

```
jscadui/
├── TESTING.md                           # This file
├── scripts/
│   └── test-all.js                      # Run all test categories
├── packages/
│   ├── */test/                          # Unit tests (vitest)
│   └── openscad/
│       ├── test/                        # Unit tests
│       ├── bin/test-harness.js          # OpenSCAD comparison testing
│       └── TESTING.md                   # OpenSCAD-specific testing docs
└── apps/
    └── jscad-web/
        ├── examples.test.js             # JSCAD example execution tests
        └── playwright/                  # E2E tests (optional)
```

---

## Future Enhancement Ideas

### 1. Geometry Validation

Add detailed validation of output geometry structure:
- Verify vertex/face counts are reasonable
- Check for degenerate geometry
- Validate normals and winding order

### 2. Performance Benchmarking

Track execution time for benchmark examples over time:
- Identify performance regressions
- Compare engine performance
- Optimize hot paths

### 3. Visual Regression Testing

```bash
# Run specific test
npx vitest run path/to/test.test.ts

# Watch mode
npx vitest
```

### JSCAD Example Failures

```bash
# Run in browser dev mode
cd apps/jscad-web
npm run dev
# Navigate to: http://localhost:PORT/#examples/jscad/failing-example.js
```

### OpenSCAD Example Failures

See `packages/openscad/TESTING.md` for detailed debugging.

Quick version:
```bash
cd packages/openscad

# Test single file
node bin/run-jscad.js path/to/file.scad

# See transpiled code
node bin/transpile-file.js path/to/file.scad

# Compare with OpenSCAD
openscad -o ref.stl path/to/file.scad
node bin/run-jscad.js path/to/file.scad -o out.stl
node bin/compare-stl.js ref.stl out.stl
```

---

## Coverage Goals

### Current Status

| Category | Count | Passing | Pass Rate |
|----------|-------|---------|-----------|
| Unit tests | ~1,000+ | ~1,000+ | 100% |
| JSCAD examples | 27 | 27 | 100% |
| OpenSCAD basics | 20 | 20 | 100% |
| BOSL v1 | 99 | 99 | 100% |
| BOSL2 | 166 | 166 | 100% |
| OpenSCAD snippets | 111 | 111 | 100% |

### Target Goals

1. **Unit tests**: Maintain 100% pass rate
2. **JSCAD examples**: Maintain 100% pass
3. **OpenSCAD examples**:
   - Maintain 100% for basics and BOSL v1
   - Maintain 100% for BOSL2 (skip list currently empty)

---

## Related Documentation

- `packages/openscad/TESTING.md` - OpenSCAD-specific testing guide
- `packages/openscad/ARCHITECTURE.md` - Transpiler architecture
- `CLAUDE.md` - Development guidelines
