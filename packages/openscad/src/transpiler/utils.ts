/**
 * Transpiler utility functions
 */
import type { AssignmentNode } from 'openscad-parser'
import type { TranspiledFile, TranspileContext } from './context.js'

/**
 * Deduplicate parameters, keeping the LAST occurrence of each name.
 * This matches OpenSCAD behavior where duplicate parameter names are allowed
 * (e.g., `module foo(r, d, r)`), but JavaScript doesn't support this,
 * so we keep only the last occurrence of each parameter name.
 *
 * @param args - Array of assignment nodes representing parameters
 * @returns Filtered array with only the last occurrence of each name
 */
export function deduplicateArgs(args: readonly AssignmentNode[]): AssignmentNode[] {
  const seenNames = new Map<string, number>()
  args.forEach((arg, i) => seenNames.set(arg.name, i))
  return args.filter((arg, i) => seenNames.get(arg.name) === i)
}

/**
 * Deduplicate parameter names, keeping the LAST occurrence of each name.
 * Convenience wrapper around deduplicateArgs that returns just the names.
 *
 * @param args - Array of assignment nodes representing parameters
 * @returns Array of unique parameter names
 */
export function deduplicateParamNames(args: readonly AssignmentNode[]): string[] {
  return deduplicateArgs(args).map(a => a.name)
}

/**
 * Merge all elements from source into target Set.
 * Replaces verbose for-loop pattern for Set merging.
 *
 * @param target - The Set to merge into
 * @param source - The iterable to merge from
 */
export function mergeSetInto<T>(target: Set<T>, source: Iterable<T>): void {
  for (const item of source) target.add(item)
}

/**
 * Register a dual-defined __fn variant for a symbol.
 * Dual-defined symbols have both module and function definitions.
 * The __fn suffix is used when calling the function version.
 *
 * @param name - The base symbol name
 * @param symbols - The symbol table to register in
 * @param skipIfExists - Skip registration if __fn variant already exists
 */
export function registerDualDefinedVariant(
  name: string,
  symbols: { getParams(name: string, type: 'module' | 'function'): string[] | undefined; registerParams(name: string, type: 'module' | 'function', params: string[]): void },
  skipIfExists = false
): void {
  // Get params from function version first (may have more params), fallback to module
  const params = symbols.getParams(name, 'function') || symbols.getParams(name, 'module')
  if (!params) return

  // Check if __fn variant already exists (for skipIfExists mode)
  if (skipIfExists && symbols.getParams(`${name}__fn`, 'module')) return

  // Register __fn variant so reorderNamedArgs can find it
  symbols.registerParams(`${name}__fn`, 'module', params)
}

/**
 * Extract names from code strings using a regex pattern.
 * Used to extract function/module/constant names from generated code at creation time.
 *
 * @param codeStrings - Array of code strings
 * @param pattern - Regex pattern with first capture group as the name
 * @returns Array of extracted names (parallel to input array)
 *
 * @example
 * ```typescript
 * const functions = ['function foo_$f() {}', 'function bar_$f() {}']
 * const names = extractNamesFromCode(functions, /^function\s+(\w+)/)
 * // Returns: ['foo_$f', 'bar_$f']
 * ```
 */
export function extractNamesFromCode(codeStrings: string[], pattern: RegExp): string[] {
  return codeStrings.map(code => {
    const match = code.match(pattern)
    return match?.[1] || ''
  })
}

/**
 * Import symbols from a cached transpiled file into the context.
 * Handles the common pattern of importing function/module exports, registering parameter lists,
 * and handling dual-defined names.
 *
 * This consolidates the duplicated logic from processUseStatements, propagateUseImportsFromInclude,
 * and mergeImportedSymbols.
 *
 * @param cachedFile - The transpiled file to import symbols from
 * @param ctx - The transpile context to import symbols into
 * @param options - Configuration for what to import
 *   - defineModules: Whether to define modules in SymbolTable (default: true). Set to false for use imports.
 *   - registerParams: Whether to register parameter lists (default: true). Set to false if already registered.
 *   - registerDualDefined: Whether to register dual-defined __fn variants (default: true).
 */
export function importSymbolsFromFile(
  cachedFile: TranspiledFile | undefined,
  ctx: TranspileContext,
  options?: {
    defineModules?: boolean
    registerParams?: boolean
    registerDualDefined?: boolean
  }
): void {
  if (!cachedFile) return

  const opts = {
    defineModules: true,
    registerParams: true,
    registerDualDefined: true,
    ...options,
  }

  // Import function exports (always imported regardless of use vs include)
  if (cachedFile.functionExports) {
    for (const fn of cachedFile.functionExports) {
      const params = cachedFile.functionParamLists?.get(fn)
      ctx.symbols.define(fn, { kind: 'function', source: 'imported', params })
    }
  }

  // Import module exports (only for include - use files are accessed via require())
  if (opts.defineModules && cachedFile.moduleExports) {
    for (const mod of cachedFile.moduleExports) {
      const params = cachedFile.paramLists?.get(mod)
      ctx.symbols.define(mod, { kind: 'module', source: 'imported', params })
    }
  }

  // Register parameter lists for named argument reordering
  if (opts.registerParams) {
    if (cachedFile.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.symbols.registerParams(name, 'module', params)
      }
    }
    if (cachedFile.functionParamLists) {
      for (const [name, params] of cachedFile.functionParamLists) {
        ctx.symbols.registerParams(name, 'function', params)
      }
    }
  }

  // Register dual-defined __fn variants
  if (opts.registerDualDefined && cachedFile.dualDefinedNames) {
    for (const name of cachedFile.dualDefinedNames) {
      registerDualDefinedVariant(name, ctx.symbols)
    }
  }
}
