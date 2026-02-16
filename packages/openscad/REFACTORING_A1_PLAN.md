# A1: Split Context into Focused Managers - Detailed Plan (UPDATED: Middle Ground)

## Goal
Extract the two most complex concerns (code generation tracking and scope management) into focused manager classes. Keep simple fields (imports, cache) as direct context fields.

## Rationale for Middle Ground
- **CodeGenState** and **ScopeManager** are genuinely complex with multiple related fields and methods
- **ImportTracker** and **FileCacheManager** would be overkill - just simple maps
- Get ~70% of the benefit with ~40% of the work

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

✅ **DONE** - Both managers created and committed!

---

## Phase 2: Add Managers to Context (Low Risk)

### Step 2.1: Add managers to TranspileContext

**Goal**: Add CodeGenState and ScopeManager instances to context

**Edit**: `src/transpiler/context.ts`

Add imports and manager fields:
```typescript
import { CodeGenState } from './managers/CodeGenState.js'
import { ScopeManager } from './managers/ScopeManager.js'

export class TranspileContext {
  // NEW: Manager instances
  readonly codeGen = new CodeGenState()
  readonly scopes = new ScopeManager()
  
  // Keep existing fields for now (will remove in Phase 4)
  readonly usedPrimitives = new Set<string>()
  readonly usedTransforms = new Set<string>()
  // ... etc ...
  
  scopeBindings: Map<string, string>[] = []
  localFunctionBindings = new Map<string, string>()
  letCounter = 1
  // ... etc ...
}
```

Update `cloneForNested()` to clone managers:
```typescript
cloneForNested(): TranspileContext {
  const nested = new TranspileContext(this.options, this.symbols, this.filepath)
  
  // Clone managers
  nested.codeGen = this.codeGen.clone()
  nested.scopes = this.scopes.clone()
  
  // ... rest of cloning ...
  return nested
}
```

**Test**: Build and run tests (should pass - managers present but not used yet)

**Commit**: `refactor(openscad): A1 Phase 2 - add managers to context`

---

## Phase 3: Migrate Call Sites (Medium Risk)

**Goal**: Change all code to use `ctx.codeGen.*` and `ctx.scopes.*` instead of direct fields

### Step 3.1: Migrate CodeGenState call sites

**Files to update** (~15 files):
- `src/transpiler/builtins.ts`
- `src/transpiler/helpers/index.ts`
- `src/transpiler/statements.ts`
- `src/transpiler/expressions.ts`
- `src/transpiler/modules.ts`
- `src/transpiler/functions.ts`
- And others that reference `usedPrimitives`, `usedTransforms`, etc.

**Pattern**:
```typescript
// Before
ctx.usedPrimitives.add('cube')
ctx.usedColors = true

// After
ctx.codeGen.usedPrimitives.add('cube')
ctx.codeGen.usedColors = true
```

**Strategy**:
1. Use find/replace in your editor to replace patterns
2. Build after each file change
3. Run tests after every 2-3 files

**Commit after**: `refactor(openscad): A1 Phase 3.1 - migrate codeGen call sites`

---

### Step 3.2: Migrate ScopeManager call sites

**Files to update** (~8 files):
- `src/transpiler/statements.ts` (let expressions, for loops)
- `src/transpiler/expressions.ts` (identifier lookups)
- `src/transpiler/helpers/index.ts` (scope operations)
- And others that reference `scopeBindings`, `localFunctionBindings`, `letCounter`

**Pattern**:
```typescript
// Before
const suffix = `$${ctx.letCounter++}`
ctx.scopeBindings.push(bindings)
const renamed = ctx.localFunctionBindings.get(name)

// After
const suffix = ctx.scopes.generateSuffix()
ctx.scopes.pushScope(bindings)
const renamed = ctx.scopes.lookupFunctionBinding(name)
```

**Strategy**:
1. Update one type of operation at a time (suffix generation, then scope stack, then bindings)
2. Build and test after each change
3. Be extra careful with scope stack operations

**Commit after**: `refactor(openscad): A1 Phase 3.2 - migrate scopes call sites`

---

## Phase 4: Remove Old Fields (Low Risk)

**Goal**: Delete the old redundant fields from TranspileContext

### Step 4.1: Remove old CodeGenState fields

**Edit**: `src/transpiler/context.ts`

Remove these fields:
```typescript
// DELETE THESE:
readonly usedPrimitives = new Set<string>()
readonly usedTransforms = new Set<string>()
readonly usedBooleans = new Set<string>()
readonly usedExtrusions = new Set<string>()
readonly usedHelpers = new Set<string>()
usedColors = false
usedHulls = false
usedMaths = false
usedMinMax = false
```

**Test**: Build - should get TypeScript errors if you missed any call sites in Phase 3

**Commit**: `refactor(openscad): A1 Phase 4.1 - remove old codeGen fields`

---

### Step 4.2: Remove old ScopeManager fields

**Edit**: `src/transpiler/context.ts`

Remove these fields:
```typescript
// DELETE THESE:
scopeBindings: Map<string, string>[] = []
localFunctionBindings = new Map<string, string>()
letCounter = 1
```

**Test**: Build - should get TypeScript errors if you missed any call sites

**Commit**: `refactor(openscad): A1 Phase 4.2 - remove old scope fields`

---

## Phase 5: Add Manager Tests (Low Risk)

**Goal**: Add unit tests for the two manager classes

### Step 5.1: Test CodeGenState

**Create**: `test/managers/CodeGenState.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { CodeGenState } from '../../src/transpiler/managers/CodeGenState.js'

describe('CodeGenState', () => {
  it('should track primitives', () => {
    const state = new CodeGenState()
    state.usedPrimitives.add('cube')
    state.usedPrimitives.add('sphere')
    expect(state.usedPrimitives.has('cube')).toBe(true)
    expect(state.usedPrimitives.size).toBe(2)
  })

  it('should clone correctly', () => {
    const state = new CodeGenState()
    state.usedPrimitives.add('cube')
    state.usedColors = true
    
    const copy = state.clone()
    expect(copy.usedPrimitives.has('cube')).toBe(true)
    expect(copy.usedColors).toBe(true)
    
    // Verify deep copy
    copy.usedPrimitives.add('sphere')
    expect(state.usedPrimitives.has('sphere')).toBe(false)
  })

  it('should merge from another state', () => {
    const state1 = new CodeGenState()
    state1.usedPrimitives.add('cube')
    
    const state2 = new CodeGenState()
    state2.usedPrimitives.add('sphere')
    state2.usedColors = true
    
    state1.mergeFrom(state2)
    expect(state1.usedPrimitives.has('cube')).toBe(true)
    expect(state1.usedPrimitives.has('sphere')).toBe(true)
    expect(state1.usedColors).toBe(true)
  })
})
```

**Test**: `npx vitest run test/managers/CodeGenState.test.ts`

**Commit**: `test(openscad): A1 Phase 5.1 - add CodeGenState tests`

---

### Step 5.2: Test ScopeManager

**Create**: `test/managers/ScopeManager.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { ScopeManager } from '../../src/transpiler/managers/ScopeManager.js'

describe('ScopeManager', () => {
  it('should generate unique suffixes', () => {
    const mgr = new ScopeManager()
    expect(mgr.generateSuffix()).toBe('$1')
    expect(mgr.generateSuffix()).toBe('$2')
    expect(mgr.generateSuffix()).toBe('$3')
  })

  it('should manage scope stack', () => {
    const mgr = new ScopeManager()
    expect(mgr.scopeDepth).toBe(0)
    
    mgr.pushScope(new Map([['x', 'x$1']]))
    expect(mgr.scopeDepth).toBe(1)
    expect(mgr.lookupBinding('x')).toBe('x$1')
    
    mgr.pushScope(new Map([['y', 'y$2']]))
    expect(mgr.scopeDepth).toBe(2)
    expect(mgr.lookupBinding('y')).toBe('y$2')
    expect(mgr.lookupBinding('x')).toBe('x$1') // still accessible
    
    mgr.popScope()
    expect(mgr.scopeDepth).toBe(1)
    expect(mgr.lookupBinding('y')).toBeUndefined()
    expect(mgr.lookupBinding('x')).toBe('x$1')
  })

  it('should shadow bindings correctly', () => {
    const mgr = new ScopeManager()
    mgr.pushScope(new Map([['x', 'x$1']]))
    mgr.pushScope(new Map([['x', 'x$2']])) // shadow
    
    expect(mgr.lookupBinding('x')).toBe('x$2') // inner wins
    
    mgr.popScope()
    expect(mgr.lookupBinding('x')).toBe('x$1') // outer restored
  })

  it('should manage function bindings', () => {
    const mgr = new ScopeManager()
    mgr.registerFunctionBinding('foo', 'foo$1')
    expect(mgr.lookupFunctionBinding('foo')).toBe('foo$1')
    
    mgr.unregisterFunctionBinding('foo')
    expect(mgr.lookupFunctionBinding('foo')).toBeUndefined()
  })

  it('should clone correctly', () => {
    const mgr = new ScopeManager()
    mgr.pushScope(new Map([['x', 'x$1']]))
    mgr.registerFunctionBinding('foo', 'foo$2')
    
    const copy = mgr.clone()
    expect(copy.scopeDepth).toBe(1)
    expect(copy.lookupBinding('x')).toBe('x$1')
    expect(copy.lookupFunctionBinding('foo')).toBe('foo$2')
    
    // Verify deep copy
    copy.pushScope(new Map([['y', 'y$3']]))
    expect(mgr.scopeDepth).toBe(1)
    expect(copy.scopeDepth).toBe(2)
  })
})
```

**Test**: `npx vitest run test/managers/ScopeManager.test.ts`

**Commit**: `test(openscad): A1 Phase 5.2 - add ScopeManager tests`

---

## Summary

**What we're doing**:
- Creating 2 manager classes (CodeGenState, ScopeManager) for complex concerns
- Keeping simple fields (imports, cache) as direct context fields
- ~5 phases, ~10 steps total

**What we're NOT doing** (decided as overkill):
- ImportTracker manager
- FileCacheManager manager

**Time estimate**: 1-2 days instead of 2-3 days

**Phases**:
1. ✅ Create managers (DONE)
2. ⏳ Add to context
3. ⏳ Migrate call sites
4. ⏳ Remove old fields
5. ⏳ Add tests

**Testing after each step**:
```bash
npm run build && npx vitest run
```
