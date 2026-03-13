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
- `bosl2/` - BOSL2 library examples (88% pass, 17 in skip list)
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
| BOSL v1 | ~200 | ~200 | 100% |
| BOSL2 | 145 | 128 | 88% |
| OpenSCAD snippets | ~400 | ~400 | 100% |

### Target Goals

1. **Unit tests**: Maintain 100% pass rate
2. **JSCAD examples**: Maintain 100% pass
3. **OpenSCAD examples**:
   - Maintain 100% for basics and BOSL v1
   - Improve BOSL2 to 95%+ (reduce skip list from 17 to <8)

---

## Related Documentation

- `packages/openscad/TESTING.md` - OpenSCAD-specific testing guide
- `packages/openscad/ARCHITECTURE.md` - Transpiler architecture
- `CLAUDE.md` - Development guidelines
