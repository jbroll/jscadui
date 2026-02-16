# OpenSCAD Transpiler Refactoring Plan

**Date:** 2026-02-15
**Status:** Phase 1 Complete ✅ - Phase 2 Ready to Start

This document provides a comprehensive analysis of code quality issues, architectural problems, and opportunities for improvement in the OpenSCAD transpiler. It is organized by severity and includes specific implementation plans.

---

## Executive Summary

**UPDATED 2026-02-15**: ✅ **Phase 1 Complete** - SymbolTable migration finished successfully! All legacy symbol tracking fields have been removed. SymbolTable is now the single source of truth for all symbol and parameter tracking.

The transpiler has evolved organically and still suffers from:
- ~~**Redundant data structures**: Legacy sets/maps/arrays that duplicate SymbolTable data~~ ✅ **FIXED**
- **Copy-paste code**: 40+ instances of duplicated logic
- **Missing abstractions**: Common patterns repeated inline
- **Complex state management**: Context object with 30+ mutable fields (reduced from original count)
- **Semantic impedance**: OpenSCAD features fighting JavaScript's design

**Current focus**: Move to Phase 2 (Quick Wins) - eliminate duplicate code with minimal risk.

**Impact**: Maintenance burden, bug risk from sync failures, difficulty adding features.

**Recommended approach**: Incremental refactoring in phases, maintaining test coverage throughout.

---

## Critical Issues (Severity: CRITICAL)

### Issue C1: Parallel Symbol Tracking Systems

**Problem**: The transpiler maintains **4 overlapping systems** for tracking symbols:

**System 1 - Raw Lists** (`context.ts:145-147`):
```typescript
moduleNames: string[]
functionNames: string[]
variableNames: string[]
```

**System 2 - "Available" Sets** (`context.ts:156-161`):
```typescript
availableSymbols: Set<string>
availableModules: Set<string>
availableFunctions: Set<string>
```

**System 3 - "Imported" Sets** (`context.ts:162-165`):
```typescript
importedFunctions: Set<string>
importedModules: Set<string>
```

**System 4 - SymbolTable** (`context.ts:175`):
```typescript
symbols: SymbolTable  // Unified table with all symbol info
```

**Impact**:
- Same data stored in 3-4 places
- Manual synchronization at 17+ locations in `transpile.ts`
- Bug risk: forgetting to update one structure
- Code complexity: multiple ways to check "is X a module?"

**Example of redundancy** (`transpile.ts:88-96`):
```typescript
for (const fn of cachedFile.functionExports) {
  ctx.importedFunctions.add(fn)      // System 3
  ctx.availableFunctions.add(fn)     // System 2
  ctx.symbols.define(fn, {...})      // System 4
}
```

**Implementation Plan**:

**Phase**: Migrate to SymbolTable exclusively
- **Step 1**: Audit all usages of old Sets/arrays
- **Step 2**: Add migration shims to SymbolTable (getters that query internal state)
- **Step 3**: Replace direct Set access with SymbolTable queries
- **Step 4**: Remove legacy fields from TranspileContext
- **Step 5**: Verify all tests pass

**Files to modify**:
- `context.ts` - Remove legacy fields
- `transpile.ts` - Replace 17 sync locations
- `statements.ts` - Update symbol lookups
- `expressions.ts` - Update symbol lookups

**Test coverage**: Existing 246 unit tests + 143 BOSL2 corpus tests should catch regressions

---

### Issue C2: Parameter Lists Stored in 4 Places

**Problem**: Function/module parameters are tracked in **4 data structures**:

```typescript
// Direct Maps (context.ts:148-151)
moduleParamLists: Map<string, string[]>
functionParamLists: Map<string, string[]>

// Inside SymbolTable (symbolTable.ts:59-60)
private moduleParams: Map<string, string[]>
private functionParams: Map<string, string[]>
```

**Impact**:
- Code must update both when registering symbols
- Lookups check both: `ctx.symbols.getParams()` OR `ctx.moduleParamLists.get()`
- Silent failures if one is updated but not the other

**Example** (`transpile.ts:103-106`):
```typescript
ctx.moduleParamLists.set(name, params)           // Update #1
ctx.symbols.registerParams(name, 'module', params) // Update #2
```

**Implementation Plan**:

**Phase**: Consolidate parameter storage
- **Step 1**: Ensure SymbolTable has all parameter data
- **Step 2**: Create migration getters on TranspileContext that delegate to SymbolTable
- **Step 3**: Replace direct Map access with getters
- **Step 4**: Remove `moduleParamLists` and `functionParamLists` from context
- **Step 5**: Add utility function for parameter registration

**Utility to add** (`utils.ts`):
```typescript
export function registerSymbol(
  name: string,
  kind: 'module' | 'function',
  params: string[],
  ctx: TranspileContext,
  source: 'local' | 'imported' | 'included'
): void {
  ctx.symbols.define(name, { kind, source, params })
}
```

---

### Issue C3: Dual Data Structures for Primitives/Transforms/Helpers

**Problem**: Runtime functions are duplicated inline instead of using runtime versions.

**Location**: `helpers/math.ts:84-104`, `helpers/primitives.ts:10-129`

**Duplicated functions**:
- `_min`, `_max` (generated in transpiler, exist in runtime `math.js:91-94`)
- `_num` (generated in transpiler, exists in runtime `math.js:98`)
- `_getSegments` (generated in transpiler, exists in runtime `segments.js:12`)
- `_cube`, `_cylinder`, `_sphere`, `_circle`, `_square`, `_polyhedron` (all duplicated)

**Impact**:
- Bundle size: Every transpiled file includes 50+ lines of helpers
- Version skew: Runtime fixes don't propagate to generated code
- Maintenance: Bug fixes must be applied twice

**Implementation Plan**:

**Phase**: Use runtime helpers exclusively
- **Step 1**: Add type predicates to runtime (`j$.isNum`, `j$.isBool`, etc.)
- **Step 2**: Update expressions.ts:958-970 to call runtime helpers
- **Step 3**: Remove inline generation from `helpers/math.ts`
- **Step 4**: Remove primitive wrappers from `helpers/primitives.ts`
- **Step 5**: Update tests to verify runtime calls

**Runtime additions needed** (`openscad-runtime/src/index.js`):
```javascript
j$.isNum = (x) => typeof x === 'number' && !isNaN(x)
j$.isBool = (x) => typeof x === 'boolean'
j$.isStr = (x) => typeof x === 'string'
j$.isList = (x) => Array.isArray(x)
j$.isFunc = (x) => typeof x === 'function'
```

---

## High-Priority Issues (Severity: HIGH)

### Issue H1: Copy-Paste Symbol Merge Functions

**Problem**: 5 functions do nearly identical symbol merging with slight variations:
- `processUseStatements()` (transpile.ts:79-131)
- `processIncludeStatements()` (transpile.ts:137-202)
- `propagateUseImportsFromInclude()` (transpile.ts:207-230)
- `mergeImportedSymbols()` (transpile.ts:250-295)
- `collectSignaturesFromIncludes()` (transpile.ts:556-699)

**Duplication** (`transpile.ts:91-97` vs `transpile.ts:254-260`):
```typescript
// IDENTICAL CODE in two functions:
for (const fn of cachedFile.functionExports) {
  ctx.importedFunctions.add(fn)
  ctx.availableFunctions.add(fn)
  const params = cachedFile.functionParamLists?.get(fn)
  ctx.symbols.define(fn, { kind: 'function', source: 'imported', params })
}
```

**Implementation Plan**:

**Phase**: Extract common merge logic
- **Step 1**: Create `importSymbolsFromFile(cachedFile, ctx, options)` utility
- **Step 2**: Parameterize: import vs include semantics
- **Step 3**: Replace 5 copies with utility calls
- **Step 4**: Remove duplicated code

**Utility signature**:
```typescript
function importSymbolsFromFile(
  cachedFile: TranspiledFile,
  ctx: TranspileContext,
  options: {
    importType: 'use' | 'include'
    trackAs: 'imported' | 'included'
  }
): void
```

---

### Issue H2: `__fn` Variant Registration Repeated 5 Times

**Problem**: Dual-defined names require special `__fn` suffix variant, registered identically in 5 places.

**Locations**:
- transpile.ts:120-125 (processUseStatements)
- transpile.ts:286-291 (mergeImportedSymbols)
- transpile.ts:318-323 (transpileAllStatements)
- transpile.ts:636-641 (collectSignaturesFromIncludes)
- transpile.ts:677-683 (collectSignaturesFromIncludes nested)

**Identical pattern**:
```typescript
const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
if (params) {
  ctx.moduleParamLists.set(`${name}__fn`, params)
  ctx.symbols.registerParams(`${name}__fn`, 'module', params)
}
```

**Implementation Plan**:

**Phase**: Extract utility function
- **Step 1**: Create `registerDualDefinedVariant(name, ctx)` in `utils.ts`
- **Step 2**: Replace 5 identical blocks with utility calls
- **Step 3**: Document the `__fn` naming convention

**Utility**:
```typescript
export function registerDualDefinedVariant(
  name: string,
  ctx: TranspileContext
): void {
  const params = ctx.symbols.getParams(name, 'function') ||
                 ctx.symbols.getParams(name, 'module')
  if (params) {
    ctx.moduleParamLists.set(`${name}__fn`, params)
    ctx.symbols.registerParams(`${name}__fn`, 'module', params)
  }
}
```

---

### Issue H3: Builtin Dispatch Logic Duplication

**Problem**: Builtin function/module dispatch appears in 2 places with different logic:

**Location 1**: `statements.ts:307-431` (module instantiation)
- Checks `(!hasUserDefinedModule || isUnderscorePrefixed)` 4 times
- Dispatches to primitives, transforms, booleans, extrusions

**Location 2**: `expressions.ts:897-1022` (function calls)
- Checks builtin math functions
- Checks string functions
- No underscore-prefix override mechanism

**Impact**:
- Inconsistent precedence rules
- Bug in one dispatcher doesn't fix the other
- Underscore-prefix workaround (BOSL2 feature) only works for modules

**Implementation Plan**:

**Phase**: Unify builtin dispatch
- **Step 1**: Extract shared dispatch logic to `builtins.ts`
- **Step 2**: Create single function: `tryDispatchBuiltin(name, args, kind, ctx)`
- **Step 3**: Call from both statements.ts and expressions.ts
- **Step 4**: Document underscore-prefix override behavior

**Unified signature**:
```typescript
function tryDispatchBuiltin(
  name: string,
  args: string,
  kind: 'module' | 'function',
  ctx: TranspileContext,
  hasUserDefined: boolean
): string | null
```

---

### Issue H4: Argument Reordering Logic Duplicated

**Problem**: Named argument mapping appears in 2 functions with 95% identical logic:

**Location 1**: `expressions.ts:783-864` (reorderNamedArgs) - 80 lines
- Used for function calls (returns positional args string)

**Location 2**: `statements.ts:451-496` (transpileArgsAsOptions) - 45 lines
- Used for module calls (returns object literal)

**Implementation Plan**:

**Phase**: Merge into single utility
- **Step 1**: Create `mapArgsToParams(name, args, ctx, format)` in utils.ts
- **Step 2**: Support both 'positional' and 'object' output formats
- **Step 3**: Replace both functions with parameterized utility
- **Step 4**: Remove duplicated code

**Utility signature**:
```typescript
function mapArgsToParams(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  format: 'positional' | 'object',
  preferFunction?: boolean
): string
```

---

## Medium-Priority Issues (Severity: MEDIUM)

### Issue M1: Vector Comprehension Complexity

**Problem**: `transpileVectorExpr()` handles 5+ different cases in 100 lines with nested conditionals.

**Location**: `expressions.ts:231-329`

**Cases handled**:
1. Pure list comprehensions: `[for (i=r) expr]`
2. Mixed vectors with spreads: `[0, each arr, 1]`
3. Conditionals with filtering: `[if(c) val]`
4. Nested comprehensions: `[for(...) for(...) expr]`
5. Conditionals containing comprehensions: `[if(c) for(...) expr]`

**Helper functions with overlapping logic**:
- `containsNestedForExpr()` (220-222)
- `directlyProducesArray()` (197-213)
- `containsComprehensionExpr()` (166-182)
- `transpileConditionalForSpread()` (295-329)

**Implementation Plan**:

**Phase**: Extract comprehension handlers
- **Step 1**: Create `comprehensions.ts` module
- **Step 2**: Move helper functions to new module
- **Step 3**: Extract handler for each case type
- **Step 4**: Simplify main dispatcher

**Target structure**:
```typescript
// comprehensions.ts
export function handleListComprehension(...)
export function handleMixedVector(...)
export function handleConditionalFilter(...)
export function handleNestedComprehension(...)

// expressions.ts (simplified)
function transpileVectorExpr(expr, ctx) {
  if (isPureComprehension) return handleListComprehension(...)
  if (hasMixedElements) return handleMixedVector(...)
  // ...etc
}
```

---

### Issue M2: Special Variable Scoping Scattered

**Problem**: Special variable handling uses 3 different mechanisms:

1. **Stack-based dynamic scoping** (j$.pushScope/popScope/getSpecialVar/setSpecialVar)
2. **Scope binding shadowing** (context.scopeBindings)
3. **Options object parameters** (module preamble)

**Locations**:
- `specialVars.ts:11-40` - 41-variable whitelist (not extensible)
- `statements.ts:59-71` - Special handling in blocks
- `statements.ts:596-641` - Options destructuring splits user vs system $vars
- `expressions.ts:302-303` - Stack variable lookup
- Multiple try/finally patterns for scope wrapping

**Implementation Plan**:

**Phase**: Consolidate special var handling
- **Step 1**: Add `j$.withScope(vars, fn)` helper to runtime
- **Step 2**: Update transpiler to use helper instead of inline try/finally
- **Step 3**: Document which variables use which scoping mechanism
- **Step 4**: Consider making special var list extensible

**Runtime helper**:
```javascript
// openscad-runtime/src/index.js
j$.withScope = (assignments, fn) => {
  j$.pushScope()
  for (const [name, value] of Object.entries(assignments)) {
    j$.setSpecialVar(name, value)
  }
  try {
    return fn()
  } finally {
    j$.popScope()
  }
}
```

**Usage in transpiler**:
```javascript
// Instead of:
(() => { j$.pushScope(); j$.setSpecialVar('$fn', 32); try { return j$.cube(...); } finally { j$.popScope(); } })()

// Generate:
j$.withScope({ '$fn': 32 }, () => j$.cube(...))
```

---

### Issue M3: Options Destructuring Complexity

**Problem**: `buildOptionsDestructuring()` handles special vars, regular args, and user $vars in complex nested logic.

**Location**: `statements.ts:710-780`

**Issues**:
- 4 separate categorization passes over parameters
- EXPLICIT_UNDEF conversion logic duplicated
- Magic variable list `['$fn', '$fa', '$fs']` appears multiple times
- Mixing concerns: conversion, stack setting, defaults

**Implementation Plan**:

**Phase**: Simplify options destructuring
- **Step 1**: Extract parameter categorization into single pass
- **Step 2**: Create dedicated handler for each category
- **Step 3**: Remove magic lists (use `isStackSpecialVar()`)
- **Step 4**: Document the categorization logic

**Simplified structure**:
```typescript
function buildOptionsDestructuring(args, ctx) {
  const categories = categorizeParameters(args)

  const destructure = buildDestructurePattern(categories)
  const conversions = buildConversions(categories.explicitUndef)
  const stackUpdates = buildStackUpdates(categories.stackSpecial)
  const defaults = buildDefaults(categories.commonSpecial)

  return { destructure, preamble: conversions + stackUpdates + defaults }
}
```

---

### Issue M4: Let/For Expression Handling Duplication

**Problem**: Let binding logic appears in 4 places with similar patterns:

**Locations**:
- `expressions.ts:96-147` (transpileLetBindings - for expressions)
- `statements.ts:596-672` (transpileLetModule - module version)
- `expressions.ts:533-645` (transpileLcForExprHandler - comprehensions)
- `statements.ts:596-672` (transpileForLoop - module version)

**Duplicated patterns**:
- `suffix = $${counter++}` naming
- Scope push/pop
- Binding registration in `localFunctionBindings`
- Cleanup of bindings

**Implementation Plan**:

**Phase**: Extract shared let/for logic
- **Step 1**: Create `scoping.ts` module
- **Step 2**: Extract `createLetScope(bindings, ctx)` utility
- **Step 3**: Extract `createForScope(iterables, ctx)` utility
- **Step 4**: Replace 4 implementations with utility calls

---

### Issue M5: Context Initialization Boilerplate

**Problem**: `createContext()` has repetitive initialization code for Sets/Maps.

**Location**: `context.ts:207-312`

**Pattern repeated 5 times**:
```typescript
const dualDefinedNames = new Set<string>()
if (options.initialDualDefinedNames) {
  for (const name of options.initialDualDefinedNames) {
    dualDefinedNames.add(name)
  }
}
```

**Implementation Plan**:

**Phase**: Add initialization helpers
- **Step 1**: Create `initializeSet<T>(initial?)` utility
- **Step 2**: Create `initializeMap<K, V>(initial?)` utility
- **Step 3**: Replace 5 repetitive blocks
- **Step 4**: Reduce context.ts by ~30 lines

**Utilities**:
```typescript
function initializeSet<T>(initial?: Iterable<T>): Set<T> {
  return initial ? new Set(initial) : new Set()
}

function initializeMap<K, V>(initial?: Iterable<[K, V]>): Map<K, V> {
  return initial ? new Map(initial) : new Map()
}
```

---

### Issue M6: Name Extraction and Deduplication

**Problem**: Bundled content processing extracts names via regex 3 times with identical dedup logic.

**Location**: `transpile.ts:159-184`

**Pattern**:
```typescript
for (const fn of parts.functions) {
  const match = fn.match(/^function\s+(\w+)/)
  const name = match?.[1]
  if (!name || !bundledFunctionNames.has(name)) {
    if (name) bundledFunctionNames.add(name)
    bundledFunctions.push(fn)
  }
}
// Repeated 2 more times for modules and constants
```

**Implementation Plan**:

**Phase**: Extract deduplication utility
- **Step 1**: Create `deduplicateByName(items, seenNames, extractor)` in utils.ts
- **Step 2**: Create `extractDeclarationName(code, pattern)` helper
- **Step 3**: Replace 3 loops with utility calls

**Utilities**:
```typescript
export function extractDeclarationName(declaration: string, pattern: RegExp): string | undefined {
  return declaration.match(pattern)?.[1]
}

export function deduplicateByName(
  items: string[],
  seenNames: Set<string>,
  extractor: (item: string) => string | undefined
): string[] {
  const result: string[] = []
  for (const item of items) {
    const name = extractor(item)
    if (!name || !seenNames.has(name)) {
      if (name) seenNames.add(name)
      result.push(item)
    }
  }
  return result
}
```

---

### Issue M7: Set Merging Verbosity

**Problem**: Merging Sets requires verbose for loops.

**Location**: `transpile.ts:235-245`

**Current code**:
```typescript
for (const p of parts.usedPrimitives) ctx.usedPrimitives.add(p)
for (const t of parts.usedTransforms) ctx.usedTransforms.add(t)
for (const b of parts.usedBooleans) ctx.usedBooleans.add(b)
for (const e of parts.usedExtrusions) ctx.usedExtrusions.add(e)
for (const h of parts.usedHelpers) ctx.usedHelpers.add(h)
```

**Implementation Plan**:

**Phase**: Add Set utility
- **Step 1**: Create `mergeSetInto<T>(target, source)` in utils.ts
- **Step 2**: Replace 5 loops with utility calls

**Utility**:
```typescript
export function mergeSetInto<T>(target: Set<T>, source: Iterable<T>): void {
  for (const item of source) target.add(item)
}
```

---

## Low-Priority Issues (Severity: LOW)

### Issue L1: Unused `lookupBinding()` Function

**Problem**: `lookupBinding()` is exported but never called.

**Location**: `context.ts:339-348`

**Implementation Plan**:
- **Step 1**: Verify no external usage via grep
- **Step 2**: Remove export and function
- **Step 3**: Verify tests pass

---

### Issue L2: Missing `replaceIdentifier()` Abstraction

**Problem**: Identifier replacement uses inline regex without utility function.

**Location**: `expressions.ts:1016`

**Current pattern**:
```typescript
const isSimpleIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callee)
```

**Implementation Plan**:

**Phase**: Extract identifier utilities
- **Step 1**: Create `isValidIdentifier(name)` in utils.ts
- **Step 2**: Create `safeIdentifier(name)` that handles escaping
- **Step 3**: Replace inline regex with utility calls

---

### Issue L3: Path Manipulation for Source Comments

**Problem**: Short filename extraction is inline.

**Location**: `statements.ts:42-54`

**Pattern**:
```typescript
const filename = ctx.options.currentFile || 'input.scad'
const shortFilename = filename.split('/').pop() || filename
```

**Implementation Plan**:

**Phase**: Extract path utility
- **Step 1**: Create `getShortFilename(path)` in utils.ts
- **Step 2**: Replace inline extraction

**Utility**:
```typescript
export function getShortFilename(path: string | undefined): string {
  if (!path) return 'input.scad'
  return path.split('/').pop() || path
}
```

---

## Architectural Issues (Deep Refactoring)

### Issue A1: Context God Object

**Problem**: TranspileContext has 30+ fields with unclear mutation patterns.

**Location**: `context.ts:145-200`

**Current fields**:
- Symbol tracking: 10+ fields
- Import tracking: 4 fields
- Scope management: 3 fields
- JSCAD usage flags: 5 fields
- Configuration: options, cache, errors, warnings
- Counters: letCounter, childrenVarCounter

**Impact**:
- Functions mutate context at multiple levels
- Hard to track side effects
- Unclear ownership of state

**Implementation Plan** (Major refactoring):

**Phase 1**: Group related fields into sub-objects
```typescript
interface TranspileContext {
  // Symbol management
  symbols: SymbolManager  // Consolidates all symbol tracking

  // Scope management
  scopes: ScopeManager    // Consolidates scope stack and bindings

  // Import tracking
  imports: ImportTracker  // Consolidates use/include tracking

  // Code generation state
  codeGen: CodeGenState   // Consolidates JSCAD usage flags, counters

  // Configuration (immutable)
  readonly options: TranspileOptions

  // Results (write-only)
  results: ResultCollector
}
```

**Phase 2**: Create focused manager classes
- `SymbolManager` - handles all symbol lookup/registration
- `ScopeManager` - handles scope stack and let bindings
- `ImportTracker` - tracks use/include imports
- `CodeGenState` - tracks primitives/helpers usage

**Benefits**:
- Clear ownership of state
- Explicit mutation points
- Better testability
- Easier to add features

---

### Issue A2: File Bundling via String Manipulation

**Problem**: Include bundling extracts names from generated JavaScript strings using regex.

**Location**: `transpile.ts:159-184`

**Current approach**:
1. Transpile included file to JavaScript
2. Extract function/module names via regex: `/^function\s+(\w+)/`
3. Deduplicate based on extracted names
4. Concatenate strings

**Issues**:
- Fragile: depends on exact code generation format
- Inefficient: generates code just to parse it
- Loses AST information
- Won't work if code format changes

**Implementation Plan** (Major refactoring):

**Phase**: Use AST for bundling
- **Step 1**: Track declarations at AST level during transpilation
- **Step 2**: Store declarations as AST nodes, not strings
- **Step 3**: Deduplicate at AST level
- **Step 4**: Generate code from merged AST

**Benefits**:
- More robust
- Preserves source information
- Enables smarter merging
- Allows for tree-shaking

---

### Issue A3: Dual-Defined Name Complexity

**Problem**: When a name is both module and function, system creates 3 variants with complex tracking.

**Related to**: Issue C2 (parameter lists), Issue H2 (`__fn` variants)

**Current approach**:
- Track in `dualDefinedNames` Set
- Track in `SymbolTable.dualDefined` Set
- Track function version in `SymbolTable.functionVersions` Map
- Create `name__fn` variant with special parameter list
- Apply complex swap logic when defining (symbolTable.ts:55-59)

**Implementation Plan** (Major refactoring):

**Phase**: Simplify dual-defined handling
- **Step 1**: Store both versions in SymbolTable without swap logic
- **Step 2**: Remove `__fn` suffix convention (use explicit kind parameter)
- **Step 3**: Update call sites to specify which kind they want
- **Step 4**: Remove special variant registration

**Target design**:
```typescript
// Instead of name__fn variants
ctx.symbols.define(name, {
  kind: 'dual',
  moduleInfo: { params: [...], source: 'local' },
  functionInfo: { params: [...], source: 'local' }
})

// Call sites specify which they want
const params = ctx.symbols.getParams(name, preferKind)
```

---

## Semantic Impedance Issues (OpenSCAD vs JavaScript)

These issues arise from fundamental differences between OpenSCAD and JavaScript semantics. Some may not be fixable without changing the runtime model.

### Issue S1: Module Children as Curried Functions

**Problem**: OpenSCAD modules take children syntactically, but JavaScript requires explicit parameters.

**Current solution**: Two-level currying: `module_$m(_opts) => (_children) => body`

**Impact**:
- All module calls require `()()` pattern
- Children wrapped in thunks for deferred execution
- Complex to understand and maintain

**Status**: **Architectural constraint** - likely cannot be simplified without runtime changes

**Documentation needed**: Explain why this pattern exists and when to use it

---

### Issue S2: Three Overlapping Scoping Systems

**Problem**: OpenSCAD has three different scoping mechanisms:
1. Let binding with incremental scope (each binding sees previous ones)
2. Stack-based dynamic scoping for special variables ($fn, etc.)
3. Local function bindings for recursion support

**Current solution**: Separate tracking for each mechanism

**Status**: **Semantic requirement** - each mechanism serves a different OpenSCAD feature

**Documentation needed**: Explain which mechanism is used when and why

---

### Issue S3: Special Variable Stack Management

**Problem**: Special variables use dynamic scoping (OpenSCAD semantics) which JavaScript doesn't support natively.

**Current solution**: Runtime stack via `j$.pushScope()/popScope()`

**Related**: Issue M2 (scattered special var handling)

**Status**: **Architectural constraint** - requires runtime support

**Improvement possible**: Consolidate the try/finally patterns (see Issue M2)

---

## Implementation Roadmap

**UPDATED**: SymbolTable migration takes priority as the foundation is already in place.

### Phase 1: Complete SymbolTable Migration ✅ COMPLETED (2026-02-15)

**Goal**: Remove all redundant symbol tracking, make SymbolTable the single source of truth

**Status**: **COMPLETE** - Migration finished successfully on 2026-02-15.

**Completed**:
- [x] **Step 1.1**: Migrated all READ operations from legacy fields to SymbolTable
- [x] **Step 1.2**: Removed all WRITE operations to legacy param tracking fields (commit 75d13d7)
- [x] **Step 1.3**: Removed 9 legacy field definitions from TranspileContext (commit 15ff4e1)
- [x] **Step 1.4**: Removed all `ctx.moduleParamLists.set()` / `ctx.functionParamLists.set()` calls
- [x] **Step 1.5**: Removed all `ctx.availableModules.add()` / `ctx.availableFunctions.add()` calls
- [x] **Step 1.6**: Removed all `ctx.dualDefinedNames.add()` / `ctx.importedFunctions.add()` calls
- [x] **Step 1.7**: Updated all export logic to use `ctx.symbols.getByKind()` with `isFromSource()` filtering
- [x] **Step 1.8**: Removed legacy field initialization from createContext()
- [x] **Step 1.9**: All TypeScript compilation passes (no errors)
- [x] **Step 1.10**: All 246 unit tests pass
- [x] **Step 1.11**: BOSL2 corpus baseline maintained (108/143 passing)

**Fields Removed from TranspileContext**:
- `moduleNames: string[]`
- `functionNames: string[]`
- `moduleParamLists: Map<string, string[]>`
- `functionParamLists: Map<string, string[]>`
- `availableModules: Set<string>`
- `availableFunctions: Set<string>`
- `importedModules: Set<string>`
- `importedFunctions: Set<string>`
- `dualDefinedNames: Set<string>`

**Fields Retained** (still needed for specific purposes):
- `includedModuleNames` - Global tracking for builtin override detection
- `includedFunctionNames` - Global tracking for suffix selection
- `variableNames` - Top-level variable exports
- `symbols: SymbolTable` - Single source of truth

**Actual Impact**: ~76 lines removed, 17+ manual sync points eliminated, single source of truth established

**Note**: TranspiledFile interface still uses Maps/Sets for serialization (cache format), but these are built from SymbolTable when caching and used to populate SymbolTable when reading cache.

---

### Phase 2: Quick Wins ✅ COMPLETED (2026-02-15)

**Status**: **COMPLETE** - Phase 2 finished successfully on 2026-02-15.

**Goal**: Eliminate duplicate code with minimal risk

**Completed**:
- [x] **H2**: Extract `registerDualDefinedVariant()` utility (5 copies → 1) - Commit 8ac1bc6
- [x] **M7**: Add `mergeSetInto()` utility (5 loops → 1 call) - Commit 972f938
- [x] **L1**: Remove unused `lookupBinding()` function - SKIPPED (function is used)
- [x] **M6**: Extract name deduplication utilities - REPLACED with proper BundledParts fix
- [x] **M5**: Add context initialization helpers - Commit d77816c
- [x] **BONUS**: Restructure BundledParts to eliminate regex name extraction - Commit d77816c

**Actual impact**:
- ~60 lines removed from transpile.ts and context.ts
- 3 new utilities added (`registerDualDefinedVariant`, `mergeSetInto`, `extractNamesFromCode`)
- Eliminated regex-based name extraction from generated code (architectural improvement)
- All 246 unit tests passing ✅

---

### Phase 3: Runtime Integration (2 weeks)

**Goal**: Reduce generated code size by using runtime helpers

- [ ] **C3**: Add type predicates to runtime (isNum, isBool, etc.)
- [ ] **C3**: Remove inline type check generation
- [ ] **M2**: Add `j$.withScope()` helper to runtime
- [ ] **M2**: Replace try/finally patterns with runtime helper
- [ ] **C3**: Remove primitive wrapper duplication

**Estimated impact**: 50+ lines per transpiled file saved

---

### Phase 4: Code Deduplication (2-3 weeks)

**Goal**: Eliminate copy-paste logic

- [ ] **H1**: Extract common symbol merge logic
- [ ] **H4**: Merge argument reordering functions
- [ ] **H3**: Unify builtin dispatch
- [ ] **M4**: Extract shared let/for logic
- [ ] **M1**: Extract comprehension handlers

**Estimated impact**: ~300 lines of duplication eliminated

---

### Phase 5: Structural Improvements (4-6 weeks)

**Goal**: Improve architecture for long-term maintainability

- [ ] **A1**: Split context into focused managers
- [ ] **A2**: Use AST for bundling instead of string parsing
- [ ] **A3**: Simplify dual-defined name handling
- [ ] **M3**: Simplify options destructuring

**Estimated impact**: Better separation of concerns, easier to add features

---

## Testing Strategy

**CRITICAL: Run tests after EVERY step to catch regressions immediately**

**For each step in each phase**:

1. **Before step**: Ensure tests are passing
2. **After step**: Run full test suite immediately
   ```bash
   npm run build && npx vitest run  # Unit tests (246 tests)
   node bin/test-harness.js test/corpus  # Main corpus (19 tests)
   node bin/test-harness.js test/corpus/bosl  # BOSL v1 (119 tests)
   node bin/test-harness.js test/corpus/bosl2  # BOSL2 (143 tests)
   ```
3. **If tests fail**:
   - Stop immediately
   - Revert the change
   - Investigate root cause
   - Fix and re-test before proceeding
4. **If tests pass**:
   - Commit the change
   - Document what was changed
   - Move to next step

**Regression prevention**:
- Never proceed to next step with failing tests
- Commit after each passing step (atomic changes)
- Add specific tests for new utilities before using them
- Use TypeScript compilation as first-pass validation
- Run corpus tests to verify geometry generation unchanged

---

## Success Metrics

**Code quality**:
- [ ] Reduce transpiler codebase by 500+ lines
- [ ] Eliminate 40+ instances of duplication
- [ ] Consolidate 4 symbol tracking systems into 1
- [ ] Remove 4 duplicate parameter storage locations

**Maintainability**:
- [ ] Clear ownership of state (context managers)
- [ ] Single source of truth for symbols
- [ ] Documented architectural constraints
- [ ] Utilities for common patterns

**Performance**:
- [ ] Smaller generated code (runtime helpers vs inline)
- [ ] Faster transpilation (less redundant work)
- [ ] Better caching (AST-based bundling)

---

## Risks and Mitigation

**Risk 1: Breaking existing functionality**
- **Mitigation**: Incremental changes, test after each step
- **Rollback plan**: Git commits for each phase

**Risk 2: Test suite incomplete**
- **Mitigation**: Add tests for utilities before replacing
- **Verification**: Manual testing of BOSL2 examples

**Risk 3: Runtime changes break compatibility**
- **Mitigation**: Version runtime changes, add feature detection
- **Testing**: Test with both old and new runtime

**Risk 4: Performance regression**
- **Mitigation**: Benchmark before/after each phase
- **Monitoring**: Track transpilation time for corpus

---

## Notes

**Code smell indicators**:
- Comments explaining why something is complex
- Multiple data structures tracking same information
- Copy-paste code with slight variations
- God objects with 30+ fields
- String manipulation of generated code
- Inline logic that should be utilities

**Design principles**:
- Single source of truth
- Clear ownership of state
- Explicit over implicit
- Utilities for common patterns
- AST manipulation over string parsing
- Runtime helpers over generated code

**Documentation needs**:
- Architecture overview (when to use modules vs functions)
- Scoping mechanisms (three systems explained)
- Curried module pattern (why it exists)
- Special variable handling (stack vs parameters)
- Symbol tracking (unified approach)

---

**Last updated**: 2026-02-15
**Next review**: After Phase 1 completion
