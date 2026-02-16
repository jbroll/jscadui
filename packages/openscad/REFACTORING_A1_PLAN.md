# A1: Split Context into Focused Managers - Detailed Plan

## Goal
Transform TranspileContext from a 30+ field "god object" into focused manager classes with clear ownership and responsibilities.

## Success Criteria
- All 246 unit tests pass after each step
- 246/281 corpus tests pass after each step (87.5%)
- No behavioral changes - pure refactoring
- Clearer ownership of state mutations
- Better testability and debuggability

## Current Context Fields (30+ fields)

### Symbol Tracking (10 fields)
- `symbols: SymbolTable` - unified symbol table
- `availableSymbols: Set<string>` - all symbols (local + imported)
- `includedModuleNames: Set<string>` - modules from includes
- `includedFunctionNames: Set<string>` - functions from includes
- `variableNames: string[]` - top-level variables for export

### JSCAD Usage Tracking (8 fields)
- `usedPrimitives: Set<string>`
- `usedTransforms: Set<string>`
- `usedBooleans: Set<string>`
- `usedExtrusions: Set<string>`
- `usedHelpers: Set<string>`
- `usedColors: boolean`
- `usedHulls: boolean`
- `usedMaths: boolean`
- `usedMinMax: boolean`

### Import Tracking (3 fields)
- `useImports: UseImport[]`
- `includeImports: UseImport[]`

### Scope Management (3 fields)
- `scopeBindings: Map<string, string>[]` - scope stack
- `localFunctionBindings: Map<string, string>` - let-bound functions
- `letCounter: number` - unique suffix generator

### File Caching (3 fields)
- `transpiledFiles: Map<string, TranspiledFile>`
- `parsedFiles: Map<string, ScadFile>`
- `processingFiles: Set<string>` - cycle detection

### Configuration/Results (4 fields)
- `options: TranspileOptions & ...`
- `warnings: TranspileWarning[]`
- `errors: TranspileError[]`
- `indentLevel: number`

---

## Phase 1: Create Manager Interfaces (Low Risk)

### Step 1.1: Create CodeGenState manager
**Goal**: Extract JSCAD usage tracking into focused class

**Create**: `src/transpiler/managers/CodeGenState.ts`
```typescript
/**
 * Tracks which JSCAD primitives, transforms, and helpers are used.
 * Used to generate minimal import statements.
 */
export class CodeGenState {
  readonly usedPrimitives = new Set<string>()
  readonly usedTransforms = new Set<string>()
  readonly usedBooleans = new Set<string>()
  readonly usedExtrusions = new Set<string>()
  readonly usedHelpers = new Set<string>()

  usedColors = false
  usedHulls = false
  usedMaths = false
  usedMinMax = false

  /**
   * Create a deep copy for nested contexts
   */
  clone(): CodeGenState {
    const copy = new CodeGenState()
    for (const p of this.usedPrimitives) copy.usedPrimitives.add(p)
    for (const t of this.usedTransforms) copy.usedTransforms.add(t)
    for (const b of this.usedBooleans) copy.usedBooleans.add(b)
    for (const e of this.usedExtrusions) copy.usedExtrusions.add(e)
    for (const h of this.usedHelpers) copy.usedHelpers.add(h)
    copy.usedColors = this.usedColors
    copy.usedHulls = this.usedHulls
    copy.usedMaths = this.usedMaths
    copy.usedMinMax = this.usedMinMax
    return copy
  }

  /**
   * Merge usage from another context (for nested transpilations)
   */
  mergeFrom(other: CodeGenState): void {
    for (const p of other.usedPrimitives) this.usedPrimitives.add(p)
    for (const t of other.usedTransforms) this.usedTransforms.add(t)
    for (const b of other.usedBooleans) this.usedBooleans.add(b)
    for (const e of other.usedExtrusions) this.usedExtrusions.add(e)
    for (const h of other.usedHelpers) this.usedHelpers.add(h)
    this.usedColors = this.usedColors || other.usedColors
    this.usedHulls = this.usedHulls || other.usedHulls
    this.usedMaths = this.usedMaths || other.usedMaths
    this.usedMinMax = this.usedMinMax || other.usedMinMax
  }
}
```

**Test**: Build and run tests (should pass - file not used yet)

---

### Step 1.2: Create ScopeManager
**Goal**: Extract scope stack and let binding management

**Create**: `src/transpiler/managers/ScopeManager.ts`
```typescript
/**
 * Manages lexical scoping for let bindings and for-loop variables.
 */
export class ScopeManager {
  /** Scope stack for variable bindings (maps original name -> renamed name) */
  private scopeStack: Map<string, string>[] = []

  /** Let-bound functions (maps original name -> renamed suffixed name) */
  private functionBindings = new Map<string, string>()

  /** Counter for unique let binding suffixes */
  private counter = 1

  /**
   * Generate a unique scope suffix ($1, $2, etc.)
   */
  generateSuffix(): string {
    const suffix = `$${this.counter}`
    this.counter++
    return suffix
  }

  /**
   * Push a new scope level
   */
  pushScope(bindings: Map<string, string>): void {
    this.scopeStack.push(bindings)
  }

  /**
   * Pop the current scope level
   */
  popScope(): void {
    this.scopeStack.pop()
  }

  /**
   * Look up a variable in the scope stack (innermost to outermost)
   */
  lookupBinding(name: string): string | undefined {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const binding = this.scopeStack[i].get(name)
      if (binding) return binding
    }
    return undefined
  }

  /**
   * Register a let-bound function
   */
  registerFunctionBinding(originalName: string, renamedName: string): void {
    this.functionBindings.set(originalName, renamedName)
  }

  /**
   * Unregister a let-bound function
   */
  unregisterFunctionBinding(originalName: string): void {
    this.functionBindings.delete(originalName)
  }

  /**
   * Look up a function binding
   */
  lookupFunctionBinding(name: string): string | undefined {
    return this.functionBindings.get(name)
  }

  /**
   * Get current scope depth (for debugging)
   */
  get scopeDepth(): number {
    return this.scopeStack.length
  }

  /**
   * Create a deep copy for nested contexts
   */
  clone(): ScopeManager {
    const copy = new ScopeManager()
    copy.scopeStack = this.scopeStack.map(scope => new Map(scope))
    copy.functionBindings = new Map(this.functionBindings)
    copy.counter = this.counter
    return copy
  }
}
```

**Test**: Build and run tests (should pass - file not used yet)

---

### Step 1.3: Create ImportTracker
**Goal**: Extract use/include import tracking

**Create**: `src/transpiler/managers/ImportTracker.ts`
```typescript
import type { UseImport } from '../context.js'

/**
 * Tracks use and include imports during transpilation.
 */
export class ImportTracker {
  /** Use imports (imported symbols accessed via require()) */
  readonly useImports: UseImport[] = []

  /** Include imports (symbols merged into current namespace) */
  readonly includeImports: UseImport[] = []

  /** Top-level variable assignments for export */
  readonly variableNames: string[] = []

  /** All available symbols (local + imported) */
  readonly availableSymbols = new Set<string>()

  /** Module names from all includes (for builtin override detection) */
  readonly includedModuleNames = new Set<string>()

  /** Function names from all includes (for suffix selection) */
  readonly includedFunctionNames = new Set<string>()

  /**
   * Register a use import
   */
  addUseImport(imp: UseImport): void {
    this.useImports.push(imp)
  }

  /**
   * Register an include import
   */
  addIncludeImport(imp: UseImport): void {
    this.includeImports.push(imp)
  }

  /**
   * Add a top-level variable
   */
  addVariable(name: string): void {
    this.variableNames.push(name)
  }

  /**
   * Mark a symbol as available
   */
  addAvailableSymbol(name: string): void {
    this.availableSymbols.add(name)
  }

  /**
   * Mark a module as included
   */
  addIncludedModule(name: string): void {
    this.includedModuleNames.add(name)
  }

  /**
   * Mark a function as included
   */
  addIncludedFunction(name: string): void {
    this.includedFunctionNames.add(name)
  }

  /**
   * Merge imports from another tracker (for nested includes)
   */
  mergeFrom(other: ImportTracker): void {
    this.useImports.push(...other.useImports)
    this.includeImports.push(...other.includeImports)
    this.variableNames.push(...other.variableNames)
    for (const s of other.availableSymbols) this.availableSymbols.add(s)
    for (const m of other.includedModuleNames) this.includedModuleNames.add(m)
    for (const f of other.includedFunctionNames) this.includedFunctionNames.add(f)
  }

  /**
   * Create a copy for nested contexts
   */
  clone(): ImportTracker {
    const copy = new ImportTracker()
    copy.useImports.push(...this.useImports)
    copy.includeImports.push(...this.includeImports)
    copy.variableNames.push(...this.variableNames)
    for (const s of this.availableSymbols) copy.availableSymbols.add(s)
    for (const m of this.includedModuleNames) copy.includedModuleNames.add(m)
    for (const f of this.includedFunctionNames) copy.includedFunctionNames.add(f)
    return copy
  }
}
```

**Test**: Build and run tests (should pass - file not used yet)

---

### Step 1.4: Create FileCacheManager
**Goal**: Extract file caching and cycle detection

**Create**: `src/transpiler/managers/FileCacheManager.ts`
```typescript
import type { ScadFile } from 'openscad-parser'
import type { TranspiledFile } from '../context.js'

/**
 * Manages caching of parsed ASTs and transpiled files.
 * Shared across recursive transpilation calls.
 */
export class FileCacheManager {
  /** Cache of transpiled files */
  private transpiled = new Map<string, TranspiledFile>()

  /** Cache of parsed ASTs */
  private parsed = new Map<string, ScadFile>()

  /** Files currently being processed (for cycle detection) */
  private processing = new Set<string>()

  /**
   * Check if a file is cached
   */
  hasTranspiledFile(path: string): boolean {
    return this.transpiled.has(path)
  }

  /**
   * Get a cached transpiled file
   */
  getTranspiledFile(path: string): TranspiledFile | undefined {
    return this.transpiled.get(path)
  }

  /**
   * Cache a transpiled file
   */
  setTranspiledFile(path: string, file: TranspiledFile): void {
    this.transpiled.set(path, file)
  }

  /**
   * Check if an AST is cached
   */
  hasParsedFile(path: string): boolean {
    return this.parsed.has(path)
  }

  /**
   * Get a cached AST
   */
  getParsedFile(path: string): ScadFile | undefined {
    return this.parsed.get(path)
  }

  /**
   * Cache a parsed AST
   */
  setParsedFile(path: string, ast: ScadFile): void {
    this.parsed.set(path, ast)
  }

  /**
   * Mark a file as being processed
   */
  startProcessing(path: string): void {
    this.processing.add(path)
  }

  /**
   * Mark a file as done processing
   */
  endProcessing(path: string): void {
    this.processing.delete(path)
  }

  /**
   * Check if a file is currently being processed (cycle detection)
   */
  isProcessing(path: string): boolean {
    return this.processing.has(path)
  }

  /**
   * Get all cached file paths (for debugging)
   */
  getCachedPaths(): string[] {
    return Array.from(this.transpiled.keys())
  }
}
```

**Test**: Build and run tests (should pass - file not used yet)

---

## Phase 2: Add Managers to Context (Medium Risk)

### Step 2.1: Add codeGen manager to context
**Goal**: Add CodeGenState instance alongside existing fields

**Edit**: `src/transpiler/context.ts`
```typescript
import { CodeGenState } from './managers/CodeGenState.js'

export interface TranspileContext {
  // NEW: Code generation tracking
  codeGen: CodeGenState

  // OLD: Keep existing fields for now
  usedPrimitives: Set<string>
  usedTransforms: Set<string>
  // ... rest of existing fields ...
}

export function createContext(options: TranspileOptions, cache?: Map<string, TranspiledFile>): TranspileContext {
  const codeGen = new CodeGenState()

  return {
    // NEW
    codeGen,

    // OLD: Initialize as before, but point to codeGen internals
    usedPrimitives: codeGen.usedPrimitives,
    usedTransforms: codeGen.usedTransforms,
    usedBooleans: codeGen.usedBooleans,
    usedExtrusions: codeGen.usedExtrusions,
    usedHelpers: codeGen.usedHelpers,
    // ... rest of initialization ...
  }
}
```

**Why this works**: The old fields (`usedPrimitives`, etc.) now point to the same Set instances as `codeGen.usedPrimitives`. All existing code continues to work via the old fields, but we can start migrating to use `ctx.codeGen`.

**Test**: Build and run all tests (should pass - no behavior change)

---

### Step 2.2: Add scopes manager to context
**Goal**: Add ScopeManager instance alongside existing fields

**Edit**: `src/transpiler/context.ts`
```typescript
import { ScopeManager } from './managers/ScopeManager.js'

export interface TranspileContext {
  // NEW
  codeGen: CodeGenState
  scopes: ScopeManager

  // OLD: Keep for compatibility
  letCounter: number
  localFunctionBindings: Map<string, string>
  scopeBindings: Map<string, string>[]
}

export function createContext(...): TranspileContext {
  const codeGen = new CodeGenState()
  const scopes = new ScopeManager()

  return {
    codeGen,
    scopes,

    // OLD: Point to scopes internals (use getters/setters)
    get letCounter() { return scopes['counter'] },
    set letCounter(v: number) { scopes['counter'] = v },
    localFunctionBindings: scopes['functionBindings'],
    scopeBindings: scopes['scopeStack'],
    // ...
  }
}
```

**Test**: Build and run all tests

---

### Step 2.3: Add imports manager to context
**Edit**: `src/transpiler/context.ts` - add ImportTracker

**Test**: Build and run all tests

---

### Step 2.4: Add fileCache manager to context
**Edit**: `src/transpiler/context.ts` - add FileCacheManager

**Test**: Build and run all tests

---

## Phase 3: Migrate Call Sites (High Risk - Do One Manager at a Time)

### Step 3.1: Migrate codeGen call sites
**Goal**: Change `ctx.usedPrimitives.add(...)` to `ctx.codeGen.usedPrimitives.add(...)`

**Strategy**: Use search-replace with verification
```bash
# Find all uses
grep -r "ctx.usedPrimitives" src/transpiler/
grep -r "ctx.usedTransforms" src/transpiler/
# ... for each field
```

**Files to update** (estimate ~15 files):
- `builtins.ts` - primitives, transforms, extrusions
- `helpers/index.ts` - helper function generation
- `statements.ts` - color(), hull(), etc.
- `expressions.ts` - math helpers

**For each file**:
1. Replace `ctx.usedPrimitives` with `ctx.codeGen.usedPrimitives`
2. Build
3. Run tests
4. If fail, revert and debug
5. If pass, commit

**Test**: After all codeGen migrations, run full test suite

---

### Step 3.2: Migrate scopes call sites
**Goal**: Use `ctx.scopes` methods instead of direct field access

**Strategy**: Replace direct manipulation with method calls
```typescript
// BEFORE
const suffix = `$${ctx.letCounter++}`

// AFTER
const suffix = ctx.scopes.generateSuffix()

// BEFORE
ctx.scopeBindings.push(new Map(...))
// ... later ...
ctx.scopeBindings.pop()

// AFTER
ctx.scopes.pushScope(new Map(...))
// ... later ...
ctx.scopes.popScope()
```

**Files to update** (estimate ~8 files):
- `scoping.ts` - already has helpers, adapt them
- `expressions.ts` - let expressions, for loops
- `statements.ts` - function/module bodies

**Test**: After all scopes migrations, run full test suite

---

### Step 3.3: Migrate imports call sites
**Similar pattern**

**Test**: After all imports migrations, run full test suite

---

### Step 3.4: Migrate fileCache call sites
**Similar pattern**

**Test**: After all fileCache migrations, run full test suite

---

## Phase 4: Remove Old Fields (Low Risk)

### Step 4.1: Remove codeGen compatibility fields
**Goal**: Delete `usedPrimitives`, `usedTransforms`, etc. from TranspileContext

**Edit**: `src/transpiler/context.ts`
```typescript
export interface TranspileContext {
  codeGen: CodeGenState
  scopes: ScopeManager
  imports: ImportTracker
  fileCache: FileCacheManager

  // DELETED: usedPrimitives, usedTransforms, etc.

  options: TranspileOptions & ...
  symbols: SymbolTable
  indentLevel: number
  warnings: TranspileWarning[]
  errors: TranspileError[]
}
```

**Test**: Build (should fail if any missed migrations), fix, then run tests

---

### Step 4.2: Remove scopes compatibility fields
**Similar pattern**

---

### Step 4.3: Remove imports compatibility fields
**Similar pattern**

---

### Step 4.4: Remove fileCache compatibility fields
**Similar pattern**

---

## Phase 5: Add Manager Tests (Low Risk)

### Step 5.1: Test CodeGenState
**Create**: `test/managers/CodeGenState.test.ts`
- Test clone()
- Test mergeFrom()
- Test that sets are properly shared

---

### Step 5.2: Test ScopeManager
**Create**: `test/managers/ScopeManager.test.ts`
- Test scope push/pop
- Test variable lookup
- Test function binding registration
- Test suffix generation

---

### Step 5.3: Test ImportTracker
**Similar**

---

### Step 5.4: Test FileCacheManager
**Similar**

---

## Verification Strategy

After each step:
1. `npm run build` - must pass
2. `npx vitest run` - all 246 unit tests must pass
3. `node bin/test-harness.js test/corpus test/corpus/bosl test/corpus/bosl2` - 246/281 must pass

After each phase:
1. Full test suite
2. Git commit with descriptive message
3. Optional: Test on a few complex BOSL2 files manually

---

## Rollback Strategy

- Each step is committed separately
- If a step breaks tests, `git revert HEAD` and debug
- Can abandon phase and return to previous state
- All changes are internal - no API changes

---

## Estimated Timeline

- Phase 1 (Create managers): 2-3 hours
- Phase 2 (Add to context): 1-2 hours
- Phase 3 (Migrate call sites): 8-12 hours (biggest risk)
- Phase 4 (Remove old fields): 1-2 hours
- Phase 5 (Add tests): 2-3 hours

**Total: 2-3 days of careful work**

---

## Success Metrics

**Before:**
- 1 interface with 30+ fields
- Unclear ownership of mutations
- Hard to test state changes in isolation

**After:**
- 4 focused manager classes
- Clear ownership (CodeGenState owns usage tracking)
- Each manager independently testable
- Same test pass rate (246 unit, 246/281 corpus)
