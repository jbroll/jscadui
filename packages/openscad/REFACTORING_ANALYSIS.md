# OpenSCAD Transpiler: Deep Analysis & Refactoring Plan

**Date:** 2026-02-16
**Analysis Type:** Multi-agent deep code review
**Status:** Planning phase

## Executive Summary

This document presents findings from a comprehensive multi-agent analysis of the OpenSCAD transpiler codebase, examining code quality, data structures, architecture, security, and performance. The transpiler shows evidence of solid recent refactoring (Phase 4 completion) with well-organized manager classes and unified symbol tables. However, several opportunities exist to improve maintainability, reduce complexity, and better align the code with OpenSCAD's semantic requirements.

**Overall Assessment:** B+ architecture with good separation of concerns, but room for consolidation and simplification.

---

## 1. Critical Issues (Must Fix)

### 1.1 Duplicated Parameter Mapping Logic

**Locations:**
- `src/transpiler/builtins.ts` lines 80-92
- `src/transpiler/builtins.ts` lines 226-237

**Problem:** Identical code for mapping positional arguments to named parameters appears twice. Changes must be applied in both locations.

**Impact:** High - violates DRY principle, increases bug risk

**Proposed Fix:**
```typescript
// Extract to shared helper
function mapPositionalArgsToNamed(
  argsArray: Array<{name: string | null, value: string}>,
  paramNames: string[]
): string[] {
  return argsArray.map((arg, i) => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    const paramName = paramNames[i]
    if (paramName) {
      return `${paramName}: ${arg.value}`
    }
    return arg.value
  })
}
```

**Testing:** Unit tests for the extracted function, ensure all corpus tests pass

---

### 1.2 Magic Numbers in Array Indexing

**Location:** `src/transpiler/builtins.ts` lines 206, 264

**Problem:** Hardcoded array indices `[0]`, `[1]` for parameter access without named constants.

**Current code:**
```typescript
const colorValue = argsArray[0]?.value || '"gray"'
const alphaValue = argsArray[1]?.value || 'undefined'
```

**Impact:** High - brittle, unclear intent

**Proposed Fix:**
```typescript
const colorArg = argsArray.find(a => a.name === 'c' || !a.name)
const alphaArg = argsArray.find(a => a.name === 'alpha')
const colorValue = colorArg?.value || '"gray"'
const alphaValue = alphaArg?.value || 'undefined'
```

**Testing:** Existing color tests should continue to pass

---

### 1.3 Prototype Pollution Risk in Generated Code

**Location:** `src/transpiler/utils.ts` lines 224-227

**Problem:** Generated object literals from user-provided parameter names don't check for dangerous keys like `__proto__`, `constructor`.

**Impact:** Medium-High - security concern if malicious .scad files processed

**Proposed Fix:**
```typescript
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// In object generation:
if (DANGEROUS_KEYS.has(paramName)) {
  ctx.warnings.push({
    code: WarningCode.DANGEROUS_PARAMETER_NAME,
    message: `Parameter name '${paramName}' is reserved and will be skipped`,
    file: ctx.options.currentFile
  })
  continue
}
```

**Testing:** Add test case with dangerous parameter names, verify warning

---

## 2. High Priority Refactoring (Architecture)

### 2.1 Argument Resolution vs Output Formatting

**Location:** `src/transpiler/utils.ts` - `mapArgsToParams()` function (260 lines)

**Problem:** Single function handles two concerns:
1. Resolving named/positional arguments to parameters (OpenSCAD semantics)
2. Formatting output as positional string vs object literal (JavaScript syntax)

**Current complexity:** O(n²) conditional logic with format-specific branches throughout

**Proposed Architecture:**
```typescript
// Phase 1: Pure parameter resolution (no formatting)
interface ResolvedArgument {
  paramName: string
  value: string
  isExplicit: boolean
}

function resolveArguments(
  name: string,
  args: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  kind: 'module' | 'function'
): Map<string, string> {
  const paramList = ctx.symbols.getParams(name, kind)
  const resolved = new Map<string, string>()

  // Map named args
  const namedArgMap = new Map<string, string>()
  for (const arg of args) {
    if (arg.name) {
      namedArgMap.set(arg.name, arg.value)
    }
  }

  // Fill positional args
  let positionalIndex = 0
  for (const param of paramList) {
    if (namedArgMap.has(param)) {
      resolved.set(param, namedArgMap.get(param)!)
    } else if (positionalIndex < args.length && !args[positionalIndex].name) {
      resolved.set(param, args[positionalIndex].value)
      positionalIndex++
    }
  }

  return resolved
}

// Phase 2: Format for JavaScript output
function formatAsPositional(
  resolved: Map<string, string>,
  params: string[]
): string {
  const values = params.map(p => resolved.get(p) || 'undefined')
  // Trim trailing undefined
  while (values.length > 0 && values[values.length - 1] === 'undefined') {
    values.pop()
  }
  return values.join(', ')
}

function formatAsObject(resolved: Map<string, string>): string {
  const entries: string[] = []
  for (const [param, value] of resolved) {
    const key = param.startsWith('$') ? `'${param}'` : safeIdentifier(param)
    entries.push(`${key}: ${value}`)
  }
  return `{ ${entries.join(', ')} }`
}

// High-level API (backward compatible)
function mapArgsToParams(
  name: string,
  args: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  format: 'positional' | 'object',
  kind: 'module' | 'function'
): string {
  const resolved = resolveArguments(name, args, ctx, kind)
  const paramList = ctx.symbols.getParams(name, kind) || []

  return format === 'positional'
    ? formatAsPositional(resolved, paramList)
    : formatAsObject(resolved)
}
```

**Benefits:**
- Each function is independently testable
- Easier to add new output formats
- Clearer separation of concerns
- Replace `preferFunction` boolean with explicit `kind` parameter

**Testing Strategy:**
- Unit tests for `resolveArguments()` with various arg patterns
- Unit tests for both formatters
- All corpus tests must pass unchanged

---

### 2.2 Unify Symbol Tracking (Eliminate Redundancy)

**Location:** `src/transpiler/context.ts`

**Problem:** Multiple overlapping structures for tracking symbols:
```typescript
ctx.availableSymbols: Set<string>           // All symbols
ctx.includedModuleNames: Set<string>        // Included modules
ctx.includedFunctionNames: Set<string>      // Included functions
ctx.symbols: SymbolTable                    // Unified tracker
```

**Proposed Simplification:**
```typescript
// Remove redundant Sets, use only SymbolTable

// Replace:
ctx.availableSymbols.has(name)
// With:
ctx.symbols.isDefined(name)

// Replace:
ctx.includedModuleNames.has(name)
// With:
ctx.symbols.isFromSource(name, 'included') && ctx.symbols.isKind(name, 'module')
```

**Implementation Steps:**
1. Add convenience methods to SymbolTable:
   ```typescript
   isDefined(name: string): boolean
   isFromSource(name: string, source: SymbolSource): boolean
   ```

2. Replace all `ctx.availableSymbols` usages

3. Replace `ctx.includedModuleNames` and `ctx.includedFunctionNames`

4. Remove fields from TranspileContext

**Testing:** Run full corpus after each step, ensure no regressions

---

### 2.3 Refactor Module Body Building

**Location:** `src/transpiler/statements.ts` - `buildModuleBody()` (98 lines, lines 842-939)

**Problem:** Single function handles:
- Processing nested functions
- Processing nested modules
- Handling local variable assignments
- Managing function binding registration/cleanup
- Detecting shadowing
- Special variable handling
- Building geometry expressions

**High cyclomatic complexity, temporal coupling in binding registration**

**Proposed Refactoring:**
```typescript
class ModuleBodyBuilder {
  private bodyParts: string[] = []
  private declaredVars: Set<string>
  private localVarNames: string[] = []

  constructor(
    private ctx: TranspileContext,
    private indent: string,
    paramNames: string[]
  ) {
    this.declaredVars = new Set(paramNames)
  }

  buildNestedFunctions(functions: FunctionDeclarationStmt[]): this {
    for (const func of functions) {
      const varName = func.name
      this.ctx.scopes.registerFunctionBinding(varName, varName)
      this.localVarNames.push(varName)

      const funcCode = transpileFunctionDeclaration(func, this.ctx)
      this.bodyParts.push(`${this.indent}${funcCode}`)
      this.declaredVars.add(func.name)
    }
    return this
  }

  buildNestedModules(modules: ModuleDeclarationStmt[]): this {
    for (const mod of modules) {
      const varName = mod.name
      this.ctx.scopes.registerFunctionBinding(varName, varName)
      this.localVarNames.push(varName)

      const modCode = transpileModuleDeclaration(mod, this.ctx)
      this.bodyParts.push(`${this.indent}${modCode}`)
      this.declaredVars.add(mod.name)
    }
    return this
  }

  buildAssignments(assignments: AssignmentStmt[]): this {
    for (const assign of assignments) {
      const varName = assign.name
      const isFuncLiteral = isFunctionLiteralExpr(assign.value)

      // Register function binding before transpilation for recursion
      if (isFuncLiteral) {
        this.ctx.scopes.registerFunctionBinding(varName, varName)
      }

      const value = transpileExpression(assign.value, this.ctx)

      if (isStackSpecialVar(varName)) {
        this.bodyParts.push(`${this.indent}j$.setSpecialVar('${varName}', ${value})`)
      } else if (this.declaredVars.has(varName)) {
        this.bodyParts.push(`${this.indent}${varName} = ${value}`)
      } else {
        this.bodyParts.push(`${this.indent}const ${varName} = ${value}`)
        this.declaredVars.add(varName)
      }

      // Register non-function literals after transpilation
      if (!isFuncLiteral && !isStackSpecialVar(varName)) {
        this.ctx.scopes.registerFunctionBinding(varName, varName)
        this.localVarNames.push(varName)
      }
    }
    return this
  }

  buildReturn(geometryStmts: Statement[]): this {
    if (geometryStmts.length === 0) {
      this.bodyParts.push(`${this.indent}return undefined`)
    } else {
      const geomExpressions = geometryStmts
        .map(s => transpileStatement(s, this.ctx))
        .filter(code => code !== null)

      if (geomExpressions.length === 0) {
        this.bodyParts.push(`${this.indent}return undefined`)
      } else if (geomExpressions.length === 1) {
        this.bodyParts.push(`${this.indent}return ${geomExpressions[0]}`)
      } else {
        const arrayStr = `[${geomExpressions.join(', ')}]`
        this.bodyParts.push(`${this.indent}return j$.union(${arrayStr})`)
        this.ctx.codeGen.usedBooleans.add('union')
      }
    }
    return this
  }

  generate(): string {
    return this.bodyParts.join('\n')
  }

  cleanup(): void {
    for (const varName of this.localVarNames) {
      this.ctx.scopes.unregisterFunctionBinding(varName)
    }
  }
}

// Usage:
export function buildModuleBody(
  moduleStmt: ModuleDeclarationStmt,
  ctx: TranspileContext,
  indent: string = '  ',
  paramNames: string[] = []
): string {
  const parts = extractModuleBody(moduleStmt.body)

  const builder = new ModuleBodyBuilder(ctx, indent, paramNames)
  const result = builder
    .buildNestedFunctions(parts.nestedFunctions)
    .buildNestedModules(parts.nestedModules)
    .buildAssignments(parts.assignments)
    .buildReturn(parts.geometryStmts)
    .generate()

  builder.cleanup()
  return result
}
```

**Benefits:**
- Each step is independently testable
- Side effects are localized to builder methods
- Linear control flow (no deep nesting)
- Easy to add new processing steps

**Testing:** Existing module tests should continue to pass

---

## 3. Medium Priority (Maintainability)

### 3.1 Inconsistent Naming Conventions

**Problem:** Mixed naming patterns for similar concepts:
- `transpileBuiltinPrimitive` vs `transpileUserDefinedCall` vs `transpileFunctionCallExprHandler`
- Functions ending in `Handler` vs no suffix
- `transpile*` prefix inconsistently applied

**Proposed Standards:**
- **Public transpilation functions:** `transpile*` prefix (e.g., `transpileExpression`)
- **Internal helpers:** `build*` prefix (e.g., `buildModuleBody`)
- **No `Handler` suffix** - remove from expression transpilers
- **Dispatch functions:** `try*` or `dispatch*` prefix

**Examples:**
```typescript
// Before:
transpileFunctionCallExprHandler() → transpileFunctionCallExpr()
transpileLcForExprHandler()        → transpileLcForExpr()
tryDispatchBuiltin()               → dispatchBuiltin() (always returns, null means no match)
```

**Implementation:** Rename functions, update all call sites

**Testing:** Should be pure refactoring, all tests pass

---

### 3.2 Consolidate Include Processing Passes

**Location:** `src/transpiler/transpile.ts`

**Problem:** Three passes over include files:
1. **Pass 1** (lines 530-645): `collectSignaturesFromIncludes()` - Parse and extract signatures
2. **Pass 2** (lines 101-163): `processIncludeStatements()` - Transpile files
3. **Pass 3** (lines 377-421): `createBundledParts()` - Extract declarations

**Proposed Two-Phase Approach:**
```typescript
class IncludeProcessor {
  private astCache = new Map<string, ScadFile>()
  private symbolCache = new Map<string, SymbolInfo[]>()
  private transpiledCache = new Map<string, TranspiledFile>()

  // Phase 1: Collect signatures (lightweight, no transpilation)
  async collectSignatures(includes: IncludeImport[]): Promise<void> {
    for (const inc of includes) {
      if (this.symbolCache.has(inc.filename)) continue

      const ast = await this.parseFile(inc.filename)
      this.astCache.set(inc.filename, ast)

      // Extract symbols without transpiling
      const symbols = this.extractSymbolSignatures(ast)
      this.symbolCache.set(inc.filename, symbols)

      // Recursively process nested includes
      await this.collectSignatures(ast.includes)
    }
  }

  // Phase 2: Transpile and bundle (now all signatures are known)
  transpileAndBundle(includes: IncludeImport[]): BundledParts {
    const allDeclarations: Declaration[] = []

    for (const inc of includes) {
      const ast = this.astCache.get(inc.filename)!
      const transpiled = transpile(ast, createNestedContext())

      this.transpiledCache.set(inc.filename, transpiled)
      allDeclarations.push(...transpiled.declarations)
    }

    return this.deduplicateAndBundle(allDeclarations)
  }

  private extractSymbolSignatures(ast: ScadFile): SymbolInfo[] {
    // Extract module/function names and parameters WITHOUT transpiling
    const symbols: SymbolInfo[] = []

    for (const stmt of ast.statements) {
      if (isModuleDeclaration(stmt)) {
        symbols.push({
          kind: 'module',
          source: 'local',
          params: extractParamNames(stmt.params)
        })
      } else if (isFunctionDeclaration(stmt)) {
        symbols.push({
          kind: 'function',
          source: 'local',
          params: extractParamNames(stmt.params)
        })
      }
    }

    return symbols
  }
}
```

**Benefits:**
- Eliminates redundant parsing
- Clear separation of phases
- Easier to understand and debug
- 30% reduction in include-related code

**Testing:** All include and BOSL tests must pass

---

### 3.3 Extract Builtin Handling to Registry

**Location:** Scattered across `builtins.ts`, `expressions.ts`, `statements.ts`

**Problem:** Builtin checks and transpilation logic distributed across multiple files

**Proposed Architecture:**
```typescript
interface BuiltinHandler {
  matches(name: string): boolean
  transpile(args: ArgsArray, child: string | null, ctx: TranspileContext): string
}

class PrimitiveHandler implements BuiltinHandler {
  matches(name: string): boolean {
    return ['cube', 'sphere', 'cylinder', 'circle', 'square', 'polygon', 'polyhedron', 'text'].includes(name)
  }

  transpile(args: ArgsArray, child: string | null, ctx: TranspileContext): string {
    // Implementation from transpileBuiltinPrimitive
  }
}

class TransformHandler implements BuiltinHandler { /* ... */ }
class BooleanHandler implements BuiltinHandler { /* ... */ }
class ExtrusionHandler implements BuiltinHandler { /* ... */ }

class BuiltinRegistry {
  private handlers: BuiltinHandler[] = [
    new PrimitiveHandler(),
    new TransformHandler(),
    new BooleanHandler(),
    new ExtrusionHandler()
  ]

  dispatch(name: string, args: ArgsArray, child: string | null, ctx: TranspileContext): string | null {
    if (!shouldUseBuiltin(name, 'module', ctx)) {
      return null
    }

    for (const handler of this.handlers) {
      if (handler.matches(name)) {
        return handler.transpile(args, child, ctx)
      }
    }

    return null
  }
}
```

**Benefits:**
- Single place to add new builtins
- Consistent interface
- Easier to test
- Clear extension point

**Testing:** All builtin tests continue to pass

---

## 4. Low Priority (Code Quality)

### 4.1 Boolean Parameter Anti-Pattern

**Location:** `src/transpiler/utils.ts` line 148

```typescript
export function mapArgsToParams(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  format: 'positional' | 'object',
  preferFunction = false  // ← Boolean parameter reduces readability
): string
```

**Problem:** At call sites, `mapArgsToParams(name, args, ctx, 'object', true)` - unclear what `true` means

**Proposed Fix:**
```typescript
type SymbolKind = 'module' | 'function'

export function mapArgsToParams(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  format: 'positional' | 'object',
  kind: SymbolKind = 'module'  // Explicit enum
): string
```

**Testing:** Update all call sites, ensure tests pass

---

### 4.2 Magic 'undefined' String Literal

**Locations:** Multiple files
- `expressions.ts` lines 572, 614
- `statements.ts` line 134
- `utils.ts` line 231

**Problem:** String literal `'undefined'` scattered throughout code

**Proposed Fix:**
```typescript
// In src/transpiler/constants.ts
export const UNDEFINED_LITERAL = 'undefined'
export const NULL_LITERAL = 'null'
export const TRUE_LITERAL = 'true'
export const FALSE_LITERAL = 'false'
```

**Testing:** Simple find-replace, tests should pass

---

### 4.3 Silent Failures in Switch Statements

**Location:** `src/transpiler/builtins.ts` lines 99-140, 175-212, 240-252

**Problem:** Unknown primitives return comment strings but don't track warnings

```typescript
default:
  return `/* unknown primitive: ${baseName} */`
```

**Proposed Fix:**
```typescript
default:
  ctx.warnings.push({
    code: WarningCode.UNKNOWN_BUILTIN,
    message: `Unknown primitive: ${baseName}`,
    file: ctx.options.currentFile
  })
  return `/* unknown primitive: ${baseName} */`
```

**Testing:** Add test case with unknown builtin, verify warning emitted

---

### 4.4 Add Missing JSDoc

**Locations:** Complex functions throughout codebase

**Functions needing documentation:**
- `mapArgsToParams()` - parameter resolution algorithm
- `buildModuleBody()` - body building process
- `collectSignaturesFromIncludes()` - multi-pass include handling
- `shouldUseBuiltin()` - builtin override logic

**Template:**
```typescript
/**
 * Maps OpenSCAD function/module arguments to parameter list
 *
 * Handles:
 * - Named arguments (can be out of order)
 * - Positional arguments (must match param order)
 * - Mixed named and positional
 * - Dual-defined symbols (both module and function)
 *
 * @param name - Function or module name to resolve params for
 * @param argsArray - Parsed arguments from call site
 * @param ctx - Transpilation context with symbol table
 * @param format - Output format ('positional' for functions, 'object' for modules)
 * @param kind - Symbol kind for dual-defined names
 * @returns JavaScript code string for arguments
 *
 * @example
 * // OpenSCAD: cube(size=10, center=true)
 * // Returns: "{ size: 10, center: true }"
 */
```

---

## 5. Performance Optimizations (Future)

### 5.1 Cache Parameter List Extraction

**Problem:** `ctx.symbols.getParams()` called multiple times for same symbol

**Proposed Fix:** Memoization in SymbolTable
```typescript
private paramCache = new Map<string, string[] | undefined>()

getParams(name: string, preferKind?: SymbolKind): string[] | undefined {
  const cacheKey = `${name}:${preferKind || 'any'}`
  if (this.paramCache.has(cacheKey)) {
    return this.paramCache.get(cacheKey)
  }

  const result = this.getParamsUncached(name, preferKind)
  this.paramCache.set(cacheKey, result)
  return result
}
```

---

### 5.2 Copy-on-Write for SymbolTable

**Problem:** Deep cloning in nested contexts is expensive

**Proposed:** Immutable data structures with structural sharing (e.g., Immer.js)

---

## 6. Security Hardening

### 6.1 Input Validation

**Add checks for:**
- Maximum identifier length (prevent memory exhaustion)
- Maximum nesting depth (prevent stack overflow)
- Circular dependency detection (already exists, verify coverage)

### 6.2 ReDoS Protection

**Location:** `src/utils/identifiers.ts` line 54

**Review regex patterns for complexity, add input length limits**

---

## Implementation Plan

### Phase 1: Critical Fixes (Week 1)
**Goal:** Fix bugs and security issues

**Tasks:**
1. ✅ **Extract duplicated parameter mapping logic** (Issue 1.1)
   - Create `mapPositionalArgsToNamed()` helper
   - Replace both occurrences
   - **Test:** All corpus tests pass

2. ✅ **Replace magic array indices** (Issue 1.2)
   - Use `.find()` for color/alpha parameters
   - **Test:** Color tests pass

3. ✅ **Add prototype pollution checks** (Issue 1.3)
   - Add `DANGEROUS_KEYS` set
   - Check in object generation
   - **Test:** Add dangerous parameter test case

4. ✅ **Fix silent failures in switch statements** (Issue 4.3)
   - Add warning tracking for unknown builtins
   - **Test:** Verify warnings emitted

**Exit Criteria:**
- All corpus tests pass (main + BOSL v1 + BOSL2)
- No new test failures
- Code coverage maintained or improved

---

### Phase 2: Argument Resolution Refactoring (Week 2)
**Goal:** Simplify parameter mapping

**Tasks:**
1. ✅ **Extract `resolveArguments()` function** (Issue 2.1)
   - Pure function: args + params → Map
   - **Test:** Unit tests for resolution logic

2. ✅ **Extract `formatAsPositional()` and `formatAsObject()`**
   - Separate formatting from resolution
   - **Test:** Unit tests for both formatters

3. ✅ **Refactor `mapArgsToParams()` to use new helpers**
   - Replace internal logic with calls to helpers
   - **Test:** All function and module call tests pass

4. ✅ **Replace `preferFunction` with explicit `kind` parameter** (Issue 4.1)
   - Update all call sites
   - **Test:** Full corpus

**Exit Criteria:**
- All corpus tests pass
- `mapArgsToParams()` reduced from 260 to ~50 lines
- New functions have >90% test coverage

---

### Phase 3: Symbol Tracking Consolidation (Week 3)
**Goal:** Eliminate redundant data structures

**Tasks:**
1. ✅ **Add convenience methods to SymbolTable** (Issue 2.2)
   - `isDefined(name): boolean`
   - `isFromSource(name, source): boolean`
   - **Test:** Unit tests for new methods

2. ✅ **Replace `ctx.availableSymbols` usages**
   - Search and replace with `ctx.symbols.isDefined()`
   - **Test:** After each file, run tests

3. ✅ **Replace `ctx.includedModuleNames` and `ctx.includedFunctionNames`**
   - Use `isFromSource()` queries
   - **Test:** Include tests pass

4. ✅ **Remove fields from TranspileContext**
   - Clean up interface
   - **Test:** Full corpus

**Exit Criteria:**
- All corpus tests pass
- No more redundant Sets in context
- Single source of truth: SymbolTable

---

### Phase 4: Module Body Builder Refactoring (Week 4)
**Goal:** Reduce complexity of module body generation

**Tasks:**
1. ✅ **Create `ModuleBodyBuilder` class** (Issue 2.3)
   - Extract builder with fluent interface
   - **Test:** Unit tests for each builder method

2. ✅ **Refactor `buildModuleBody()` to use builder**
   - Replace 98-line function with builder usage
   - **Test:** All module declaration tests pass

3. ✅ **Add comprehensive tests for edge cases**
   - Nested functions
   - Nested modules
   - Function literal detection
   - Special variable assignments
   - **Test:** Achieve >95% coverage of builder

**Exit Criteria:**
- All corpus tests pass
- `buildModuleBody()` reduced to ~20 lines
- Builder class fully tested

---

### Phase 5: Include Processing Consolidation (Week 5)
**Goal:** Reduce multi-pass complexity

**Tasks:**
1. ✅ **Create `IncludeProcessor` class** (Issue 3.2)
   - Two-phase design: collect then transpile
   - **Test:** Unit tests for both phases

2. ✅ **Extract `extractSymbolSignatures()` helper**
   - Lightweight signature extraction from AST
   - **Test:** Unit test with sample ASTs

3. ✅ **Refactor `collectSignaturesFromIncludes()`**
   - Use new processor
   - **Test:** BOSL v1 tests pass

4. ✅ **Refactor `processIncludeStatements()`**
   - Use new processor
   - **Test:** BOSL v1 + BOSL2 tests pass

**Exit Criteria:**
- All include tests pass
- BOSL v1: 100% pass rate maintained
- BOSL2: Pass rate maintained or improved
- 30% reduction in include code

---

### Phase 6: Code Quality Improvements (Week 6)
**Goal:** Polish and documentation

**Tasks:**
1. ✅ **Standardize naming conventions** (Issue 3.1)
   - Remove `Handler` suffix
   - Consistent `transpile*` / `build*` prefixes
   - **Test:** All tests pass (pure rename)

2. ✅ **Replace magic literals with constants** (Issue 4.2)
   - Create `constants.ts`
   - Replace `'undefined'` etc.
   - **Test:** All tests pass

3. ✅ **Add JSDoc to complex functions** (Issue 4.4)
   - Document 10+ key functions
   - Include examples
   - **Test:** No functional changes

4. ✅ **Create builtin registry** (Issue 3.3)
   - Extract handler classes
   - Centralize dispatch
   - **Test:** All builtin tests pass

**Exit Criteria:**
- All corpus tests pass
- Documentation coverage >80%
- Code follows consistent style

---

## Testing Requirements

### Mandatory Test Suite (Run Before Every Commit)

```bash
# 1. Unit tests
npx vitest run

# 2. Main corpus (MUST be 100%)
node bin/test-harness.js test/corpus

# 3. BOSL v1 library tests (MUST be 100%)
node bin/test-harness.js test/corpus/bosl

# 4. BOSL2 library tests (maintain or improve pass rate)
node bin/test-harness.js test/corpus/bosl2

# 5. Type checking
npm run typecheck
```

### Regression Prevention

**Before every commit:**
1. Run full test suite
2. Verify all corpus tests pass
3. Check for new warnings/errors
4. Ensure BOSL v1 remains at 100%
5. Document any intentional behavior changes

**Branch protection:**
- No direct commits to main
- All changes via PR with passing tests
- Rebase merges only

---

## Success Metrics

### Code Quality Metrics
- **Lines of code:** Target 15-20% reduction through deduplication
- **Cyclomatic complexity:** No function >15
- **Test coverage:** Maintain >85%
- **Documentation coverage:** >80% of public functions

### Test Coverage Metrics
- **Main corpus:** 100% pass rate (maintain)
- **BOSL v1:** 100% pass rate (maintain)
- **BOSL2:** Maintain or improve current pass rate

### Performance Metrics
- **Transpilation time:** No regression >5%
- **Memory usage:** No regression >10%

---

## Risk Mitigation

### High-Risk Changes
- Argument resolution refactoring (Phase 2)
- Symbol table consolidation (Phase 3)
- Include processing changes (Phase 5)

**Mitigation:**
- Incremental changes with tests after each step
- Keep old code path temporarily (feature flag)
- A/B testing: run both old and new, compare output

### Rollback Plan
- Each phase in separate branch
- Merge only when all tests pass
- Git tags before major changes
- Can revert per-phase if issues found

---

## Open Questions

1. **Should we unify module and function calling conventions?**
   - Currently: modules use object args `{ x: 1 }`, functions use positional `x, y`
   - Tradeoff: Consistency vs. JavaScript idioms

2. **Should special variable scoping become explicit in generated code?**
   - Currently: Hidden stack manipulation
   - Alternative: `j$.withSpecialVars({ $fn: 32 }, () => ...)` pattern

3. **Should we add TypeScript types to generated JavaScript?**
   - Could improve debugging
   - Increases code size

---

## References

### Related Documents
- `ARCHITECTURE.md` - Overall transpiler architecture
- `CLAUDE.md` - Development guidelines
- Phase 4 completion notes (git commit 0135131)

### Key Files to Understand
1. `src/transpiler/symbolTable.ts` - Symbol tracking
2. `src/transpiler/context.ts` - Context management
3. `src/transpiler/utils.ts` - Argument mapping
4. `src/transpiler/statements.ts` - Module/statement transpilation
5. `src/transpiler/builtins.ts` - Builtin handling

---

## Appendix: Agent Analysis Summary

This plan synthesizes findings from four specialized agents:

1. **Code Quality Agent** - Found duplicated logic, magic numbers, inconsistent patterns
2. **Data Structure Agent** - Analyzed symbol tables, context flow, identifier tracking
3. **Architecture Agent** - Examined separation of concerns, missing abstractions
4. **Security/Performance Agent** - Identified security issues, performance concerns

All recommendations are prioritized by impact and feasibility.
