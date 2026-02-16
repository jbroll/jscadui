# A2: Use AST for Bundling Instead of String Parsing - Detailed Plan

## Goal
Replace fragile regex-based bundling with robust AST-based approach. Instead of generating JavaScript strings and parsing them back, keep AST representations and merge at the AST level.

## Success Criteria
- All 246 unit tests pass after each step
- 246/281 corpus tests pass after each step (87.5%)
- No behavioral changes - pure refactoring
- More robust bundling (no dependency on code format)
- Foundation for future optimizations (tree-shaking, etc.)

## Current Problem

**What happens now** when processing `include <foo.scad>`:

```typescript
// 1. Transpile foo.scad to JavaScript string
const fooCode = transpile(fooAst, ctx)
// => "function bar_$f() { }\nfunction baz_$f() { }\nconst qux_$m = ..."

// 2. Extract names via regex
const functionNames = extractNamesFromCode(fooCode, /^function\s+(\w+)/)
// => ["bar_$f", "baz_$f"]

// 3. Deduplicate by comparing names
if (!seenNames.has(name)) {
  bundledFunctions.push(functionCode)
}

// 4. Concatenate strings
const result = bundledFunctions.join('\n')
```

**Problems:**
- **Fragile**: Depends on exact code format (`function foo()` not `const foo =`)
- **Inefficient**: Generates code just to parse it back
- **Information loss**: Can't map back to original AST locations
- **No optimization**: Can't tell if function is actually used

---

## New Approach

**AST-based bundling:**

```typescript
// 1. Keep declarations as AST nodes during transpilation
interface Declaration {
  name: string
  kind: 'function' | 'module' | 'constant'
  ast: FunctionDeclaration | ModuleDeclaration | Assignment
  dependencies: string[]  // For future tree-shaking
}

// 2. Store declarations in context
ctx.declarations.addFunction('bar_$f', ast, ['cube', 'translate'])

// 3. Deduplicate at AST level
const uniqueDecls = deduplicateDeclarations(declarations)

// 4. Generate code from merged declarations
const code = uniqueDecls.map(d => transpileDeclaration(d)).join('\n')
```

**Benefits:**
- **Robust**: No regex parsing
- **Efficient**: Single pass through AST
- **Traceable**: Can point to source locations
- **Optimizable**: Have dependency information

---

## Phase 1: Add Declaration Tracking (Low Risk)

### Step 1.1: Define Declaration types
**Goal**: Create data structures to represent declarations

**Create**: `src/transpiler/managers/DeclarationTracker.ts`

```typescript
import type { FunctionDeclaration, ModuleDeclaration, Statement } from 'openscad-parser'

export type DeclarationKind = 'function' | 'module' | 'constant'

/**
 * Represents a declaration that can be bundled
 */
export interface Declaration {
  /** The exported name (with suffix) */
  name: string

  /** What kind of declaration */
  kind: DeclarationKind

  /** The original AST node */
  ast: Statement

  /** Parameter names (for functions/modules) */
  params?: string[]

  /** Where this came from (for debugging) */
  source: {
    file: string
    kind: 'local' | 'included'
  }
}

/**
 * Tracks declarations during transpilation for bundling
 */
export class DeclarationTracker {
  private declarations = new Map<string, Declaration>()

  /**
   * Add a function declaration
   */
  addFunction(name: string, ast: FunctionDeclaration, params: string[], source: Declaration['source']): void {
    // Avoid duplicates (first definition wins)
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'function',
      ast,
      params,
      source,
    })
  }

  /**
   * Add a module declaration
   */
  addModule(name: string, ast: ModuleDeclaration, params: string[], source: Declaration['source']): void {
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'module',
      ast,
      params,
      source,
    })
  }

  /**
   * Add a constant declaration (top-level assignment)
   */
  addConstant(name: string, ast: Statement, source: Declaration['source']): void {
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'constant',
      ast,
      source,
    })
  }

  /**
   * Check if a declaration exists
   */
  has(name: string): boolean {
    return this.declarations.has(name)
  }

  /**
   * Get a declaration
   */
  get(name: string): Declaration | undefined {
    return this.declarations.get(name)
  }

  /**
   * Get all declarations of a specific kind
   */
  getByKind(kind: DeclarationKind): Declaration[] {
    const result: Declaration[] = []
    for (const decl of this.declarations.values()) {
      if (decl.kind === kind) {
        result.push(decl)
      }
    }
    return result
  }

  /**
   * Get all declarations
   */
  getAll(): Declaration[] {
    return Array.from(this.declarations.values())
  }

  /**
   * Merge declarations from another tracker
   */
  mergeFrom(other: DeclarationTracker): void {
    for (const [name, decl] of other.declarations) {
      // First definition wins (same as current string-based deduplication)
      if (!this.declarations.has(name)) {
        this.declarations.set(name, decl)
      }
    }
  }

  /**
   * Get count of declarations (for debugging)
   */
  get size(): number {
    return this.declarations.size
  }
}
```

**Test**: Build (should pass - file not used yet)

---

### Step 1.2: Add declarations to TranspileContext
**Goal**: Make DeclarationTracker available during transpilation

**Edit**: `src/transpiler/context.ts`

```typescript
import { DeclarationTracker } from './managers/DeclarationTracker.js'

export interface TranspileContext {
  // ... existing fields ...

  // NEW: Track declarations at AST level
  declarations: DeclarationTracker
}

export function createContext(options: TranspileOptions, cache?: Map<string, TranspiledFile>): TranspileContext {
  return {
    // ... existing initialization ...

    // NEW
    declarations: new DeclarationTracker(),
  }
}
```

**Test**: Build and run all tests (should pass - tracker not used yet)

---

### Step 1.3: Add declarations to TranspiledFile cache
**Goal**: Cache declarations alongside generated code

**Edit**: `src/transpiler/context.ts`

```typescript
export interface TranspiledFile {
  // ... existing fields ...

  // NEW: AST-level declarations (for robust bundling)
  declarations?: Declaration[]
}
```

**Test**: Build and run all tests

---

## Phase 2: Track Declarations During Transpilation (Medium Risk)

### Step 2.1: Track function declarations
**Goal**: Record function declarations as they're transpiled

**Edit**: `src/transpiler/statements.ts` in `transpileFunctionDeclaration()`

```typescript
export function transpileFunctionDeclaration(
  stmt: FunctionDeclaration,
  ctx: TranspileContext
): string {
  const name = safeIdentifier(stmt.name)
  // ... existing param handling ...

  // NEW: Track this declaration
  ctx.declarations.addFunction(
    `${name}_$f`,  // Suffixed name
    stmt,           // Original AST
    paramNames,     // Parameters
    {
      file: ctx.options.currentFile || 'input.scad',
      kind: 'local',
    }
  )

  // ... rest of existing transpilation ...
  return code
}
```

**Why safe**: We're only adding tracking, not changing behavior. If tracking fails, transpilation still works.

**Test**: Build and run tests. Verify `ctx.declarations` is being populated (add debug log if needed, then remove).

---

### Step 2.2: Track module declarations
**Edit**: `src/transpiler/statements.ts` in `transpileModuleDeclaration()`

**Similar pattern to 2.1**

**Test**: Build and run tests

---

### Step 2.3: Track constant declarations
**Edit**: `src/transpiler/transpile.ts` where top-level assignments are processed

```typescript
// In transpile() main loop
if (isAssignmentNode(stmt)) {
  const name = safeIdentifier(stmt.name)

  // NEW: Track as constant
  ctx.declarations.addConstant(
    name,
    stmt,
    {
      file: ctx.options.currentFile || 'input.scad',
      kind: 'local',
    }
  )

  // ... existing transpilation ...
}
```

**Test**: Build and run tests

---

### Step 2.4: Store declarations in cache
**Goal**: Save declarations when caching transpiled files

**Edit**: `src/transpiler/transpile.ts` in `transpile()` where we cache results

```typescript
// Store in cache for reuse
const transpiledFile: TranspiledFile = {
  // ... existing fields ...

  // NEW: Store declarations for bundling
  declarations: ctx.declarations.getAll(),
}

ctx.transpiledFiles.set(resolvedPath, transpiledFile)
```

**Test**: Build and run tests

---

## Phase 3: Create AST-Based Bundling (Low Risk - Parallel Implementation)

### Step 3.1: Create declaration transpiler
**Goal**: Transpile declarations from AST (needed for bundling)

**Create**: `src/transpiler/bundling/transpileDeclaration.ts`

```typescript
import type { Declaration } from '../managers/DeclarationTracker.js'
import type { TranspileContext } from '../context.js'
import { transpileFunctionDeclaration, transpileModuleDeclaration, transpileStatement } from '../statements.js'

/**
 * Transpile a single declaration from its AST
 */
export function transpileDeclaration(decl: Declaration, ctx: TranspileContext): string {
  switch (decl.kind) {
    case 'function':
      return transpileFunctionDeclaration(decl.ast as any, ctx)
    case 'module':
      return transpileModuleDeclaration(decl.ast as any, ctx)
    case 'constant':
      return transpileStatement(decl.ast, ctx)
    default:
      throw new Error(`Unknown declaration kind: ${(decl as any).kind}`)
  }
}

/**
 * Transpile a list of declarations
 */
export function transpileDeclarations(decls: Declaration[], ctx: TranspileContext): string {
  return decls.map(d => transpileDeclaration(d, ctx)).join('\n\n')
}
```

**Test**: Build (should pass)

---

### Step 3.2: Create AST-based bundler
**Goal**: Merge declarations from includes using AST

**Create**: `src/transpiler/bundling/mergeDeclarations.ts`

```typescript
import type { Declaration } from '../managers/DeclarationTracker.js'

/**
 * Merge declarations from multiple sources, deduplicating by name.
 * First occurrence wins (matches current string-based behavior).
 */
export function mergeDeclarations(sources: Declaration[][]): Declaration[] {
  const merged = new Map<string, Declaration>()

  for (const sourceDecls of sources) {
    for (const decl of sourceDecls) {
      // First definition wins
      if (!merged.has(decl.name)) {
        merged.set(decl.name, decl)
      }
    }
  }

  return Array.from(merged.values())
}

/**
 * Split declarations by kind (for organized output)
 */
export function splitDeclarationsByKind(decls: Declaration[]): {
  functions: Declaration[]
  modules: Declaration[]
  constants: Declaration[]
} {
  const functions: Declaration[] = []
  const modules: Declaration[] = []
  const constants: Declaration[] = []

  for (const decl of decls) {
    switch (decl.kind) {
      case 'function':
        functions.push(decl)
        break
      case 'module':
        modules.push(decl)
        break
      case 'constant':
        constants.push(decl)
        break
    }
  }

  return { functions, modules, constants }
}
```

**Test**: Create unit tests for this (pure functions, easy to test)

**Create**: `test/bundling/mergeDeclarations.test.ts`
```typescript
describe('mergeDeclarations', () => {
  it('should deduplicate by name', () => {
    const decls1 = [{ name: 'foo', kind: 'function', ... }]
    const decls2 = [{ name: 'foo', kind: 'function', ... }]  // Duplicate
    const merged = mergeDeclarations([decls1, decls2])
    expect(merged).toHaveLength(1)
  })

  it('should keep first occurrence', () => {
    // Test that first definition wins
  })
})
```

---

## Phase 4: Add Fallback Path (Medium Risk)

**Goal**: Keep both old and new bundling paths, controlled by flag. This lets us test incrementally.

### Step 4.1: Add feature flag
**Edit**: `src/transpiler/context.ts`

```typescript
export interface TranspileOptions {
  // ... existing options ...

  /**
   * Use AST-based bundling instead of string-based bundling (experimental)
   * @default false
   */
  useAstBundling?: boolean
}
```

---

### Step 4.2: Implement dual path in include processing
**Edit**: `src/transpiler/transpile.ts` in `processIncludeStatements()`

```typescript
function bundleIncludedDeclarations(ctx: TranspileContext): string {
  if (ctx.options.useAstBundling) {
    // NEW PATH: AST-based bundling
    return bundleViaAst(ctx)
  } else {
    // OLD PATH: String-based bundling (keep for now)
    return bundleViaStrings(ctx)
  }
}

function bundleViaAst(ctx: TranspileContext): string {
  // Get declarations from all includes
  const allDeclarations: Declaration[][] = []

  for (const incl of ctx.includeImports) {
    const file = ctx.transpiledFiles.get(incl.resolvedPath)
    if (file?.declarations) {
      allDeclarations.push(file.declarations)
    }
  }

  // Merge and deduplicate
  const merged = mergeDeclarations(allDeclarations)

  // Split by kind
  const { functions, modules, constants } = splitDeclarationsByKind(merged)

  // Transpile each group
  const parts: string[] = []
  if (constants.length > 0) {
    parts.push(transpileDeclarations(constants, ctx))
  }
  if (functions.length > 0) {
    parts.push(transpileDeclarations(functions, ctx))
  }
  if (modules.length > 0) {
    parts.push(transpileDeclarations(modules, ctx))
  }

  return parts.join('\n\n')
}

function bundleViaStrings(ctx: TranspileContext): string {
  // EXISTING CODE - unchanged
  // ... current regex-based extraction ...
}
```

**Test**: Build and run tests with `useAstBundling: false` (should pass - using old path)

---

### Step 4.3: Test new path on simple cases
**Create**: `test/bundling/ast-bundling.test.ts`

```typescript
describe('AST bundling', () => {
  it('should bundle included functions', async () => {
    const code = `
      include <lib.scad>
      cube(1);
    `
    const lib = `
      function double(x) = x * 2;
      function triple(x) = x * 3;
    `

    const result = await transpile(code, {
      useAstBundling: true,
      resolver: (path) => path === 'lib.scad' ? lib : null
    })

    expect(result.code).toContain('function double_$f')
    expect(result.code).toContain('function triple_$f')
  })

  it('should deduplicate included declarations', async () => {
    // Test that same function from multiple includes only appears once
  })
})
```

**Run tests**: Should pass with new bundling path

---

## Phase 5: Enable and Verify (Medium Risk)

### Step 5.1: Enable AST bundling by default
**Edit**: `src/transpiler/context.ts`

```typescript
export const defaultOptions = {
  // ... existing defaults ...
  useAstBundling: true,  // Enable by default
}
```

**Test**: Run full test suite. If failures:
- Debug and fix
- Or revert to `false` and debug incrementally

---

### Step 5.2: Test on complex BOSL2 includes
**Manual testing**:
```bash
# Test files that include lots of BOSL2 modules
node bin/run-jscad.js test/corpus/bosl2/954-shapes3d-ex.scad -o test.stl
```

**Look for**:
- Duplicate declarations (shouldn't happen)
- Missing declarations (bundling failed)
- Wrong order (constants after functions)

---

### Step 5.3: Compare output with old bundling
**Strategy**: Run same file with both bundling methods, compare

```typescript
// Generate with old bundling
const oldResult = transpile(code, { useAstBundling: false })

// Generate with new bundling
const newResult = transpile(code, { useAstBundling: true })

// Should produce equivalent code (order may differ)
```

---

## Phase 6: Remove Old Path (Low Risk)

### Step 6.1: Remove string-based bundling code
**Edit**: `src/transpiler/transpile.ts`

Delete:
- `extractNamesFromCode()` function
- `bundleViaStrings()` function
- All regex patterns for name extraction

**Edit**: `src/transpiler/utils.ts`

Delete:
- `extractNamesFromCode()` export

---

### Step 6.2: Remove feature flag
**Edit**: `src/transpiler/context.ts`

```typescript
export interface TranspileOptions {
  // REMOVE: useAstBundling option
}
```

Simplify bundling:
```typescript
function bundleIncludedDeclarations(ctx: TranspileContext): string {
  // Only AST path remains
  return bundleViaAst(ctx)
}
```

**Test**: Full test suite

---

## Phase 7: Add Optimizations (Future Work - Not Required)

These are enabled by having AST-level information:

### Optional: Add tree-shaking
**Goal**: Only include functions that are actually called

**Track dependencies**:
```typescript
interface Declaration {
  // ... existing fields ...
  dependencies: string[]  // Functions/modules this calls
  isUsed: boolean         // Marked during tree-shaking
}
```

**Mark used declarations**:
```typescript
function markUsed(decl: Declaration, allDecls: Map<string, Declaration>) {
  if (decl.isUsed) return  // Already marked
  decl.isUsed = true

  // Recursively mark dependencies
  for (const dep of decl.dependencies) {
    const depDecl = allDecls.get(dep)
    if (depDecl) markUsed(depDecl, allDecls)
  }
}
```

### Optional: Add source maps
**Goal**: Map generated code back to original .scad files

**Store locations**:
```typescript
interface Declaration {
  // ... existing fields ...
  location: {
    file: string
    line: number
    column: number
  }
}
```

---

## Verification Strategy

After each step:
1. `npm run build` - must pass
2. `npx vitest run` - all 246 unit tests must pass
3. `node bin/test-harness.js test/corpus test/corpus/bosl test/corpus/bosl2` - 246/281 must pass

After Phase 4 (dual path):
- Run tests with both `useAstBundling: true` and `false`
- Both should pass with same results

After Phase 5 (enable by default):
- Full test suite
- Manual testing on complex BOSL2 files
- Compare output size (should be similar)

---

## Rollback Strategy

- Phases 1-3: Pure additions, easy to abandon
- Phase 4: Feature flag allows instant rollback to old behavior
- Phase 5: Can revert flag to `false`
- Phase 6: Point of no return, but well-tested by then

---

## Estimated Timeline

- Phase 1 (Declaration tracking): 2-3 hours
- Phase 2 (Track during transpilation): 3-4 hours
- Phase 3 (Create bundling logic): 3-4 hours
- Phase 4 (Dual path): 2-3 hours
- Phase 5 (Enable and verify): 4-6 hours (testing-heavy)
- Phase 6 (Remove old path): 1-2 hours
- Phase 7 (Optimizations): Future work

**Total: 3-4 days of careful work**

---

## Success Metrics

**Before:**
- Bundling depends on regex: `/^function\s+(\w+)/`
- Fragile to code format changes
- No source information preserved
- Can't optimize or tree-shake

**After:**
- Bundling uses AST declarations
- Robust to code format
- Full source information available
- Foundation for tree-shaking
- Same test pass rate (246 unit, 246/281 corpus)

**Future enabled:**
- Dead code elimination
- Source maps for debugging
- Smarter module bundling
- Dependency analysis
