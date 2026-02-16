/**
 * Transpiler utility functions
 */
import type { AssignmentNode } from 'openscad-parser'
import type { TranspiledFile, TranspileContext } from './context.js'
import { safeIdentifier } from '../utils/identifiers.js'

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
 */
export function importSymbolsFromFile(
  cachedFile: TranspiledFile | undefined,
  ctx: TranspileContext,
  options?: {
    defineModules?: boolean
    registerParams?: boolean
  }
): void {
  if (!cachedFile) return

  const opts = {
    defineModules: true,
    registerParams: true,
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

  // Dual-defined names are already tracked in SymbolTable via define() calls
  // No additional registration needed
}

/**
 * Map arguments to parameters and format as positional args or object literal.
 * Consolidates the logic from reorderNamedArgs (expressions.ts) and transpileArgsAsOptions (statements.ts).
 *
 * @param name - The function/module name (for parameter list lookup)
 * @param argsArray - Array of arguments with optional names
 * @param ctx - The transpile context
 * @param format - Output format: 'positional' for "a, b, c" or 'object' for "{ x: a, y: b }"
 * @param preferFunction - For positional format, whether to prefer function params over module params
 * @returns Formatted argument string
 */
export function mapArgsToParams(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  format: 'positional' | 'object',
  preferFunction = false
): string {
  // Handle empty args for object format
  if (format === 'object' && argsArray.length === 0) return '{}'

  // Get parameter list from SymbolTable
  let paramList: string[] | undefined
  if (preferFunction) {
    // Function call context - prefer function params, fall back to module params
    paramList = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
  } else {
    // Module instantiation context - prefer module params, fall back to function params
    paramList = ctx.symbols.getParams(name, 'module') || ctx.symbols.getParams(name, 'function')
  }

  // If no param list (or empty param list), use simple positional order or _argN fallback
  const hasNamedArgs = argsArray.some(a => a.name !== null)
  if (!paramList || paramList.length === 0) {
    if (format === 'object') {
      // Generate object with named args or _argN fallback for positional
      const entries: string[] = []
      let index = 0
      for (const arg of argsArray) {
        if (arg.name) {
          const key = arg.name.startsWith('$') ? `'${arg.name}'` : safeIdentifier(arg.name)
          entries.push(`${key}: ${arg.value}`)
        } else {
          entries.push(`_arg${index}: ${arg.value}`)
          index++
        }
      }
      return `{ ${entries.join(', ')} }`
    } else {
      return argsArray.map(a => a.value).join(', ')
    }
  }

  // If no named args and we have param list, we can map positional args directly
  // This is an optimization for the common case
  if (!hasNamedArgs && format === 'positional') {
    return argsArray.map(a => a.value).join(', ')
  }

  // Map arguments to parameters
  const namedArgMap = new Map<string, string>()
  const explicitlyProvided = new Set<string>()
  const usedNames = new Set<string>()
  let positionalIndex = 0

  for (const arg of argsArray) {
    if (arg.name) {
      // Named argument
      namedArgMap.set(arg.name, arg.value)
      explicitlyProvided.add(arg.name)
      usedNames.add(arg.name)
    } else {
      // Positional argument - skip already-used parameters
      while (positionalIndex < paramList.length && usedNames.has(paramList[positionalIndex])) {
        positionalIndex++
      }
      if (positionalIndex < paramList.length) {
        const paramName = paramList[positionalIndex]
        namedArgMap.set(paramName, arg.value)
        explicitlyProvided.add(paramName)
        usedNames.add(paramName)
        positionalIndex++
      }
      // Note: for object format with extra positional args beyond paramList,
      // they're silently dropped (same behavior as transpileArgsAsOptions)
    }
  }

  // Format output
  if (format === 'object') {
    // Object literal format: only include provided parameters
    const entries: string[] = []
    for (const [paramName, value] of namedArgMap) {
      const key = paramName.startsWith('$') ? `'${paramName}'` : safeIdentifier(paramName)
      entries.push(`${key}: ${value}`)
    }
    return `{ ${entries.join(', ')} }`
  } else {
    // Positional format: fill complete parameter list with undefined for missing params
    const result: string[] = []
    const wasExplicit: boolean[] = []

    for (const paramName of paramList) {
      if (namedArgMap.has(paramName)) {
        let value = namedArgMap.get(paramName)!
        const isExplicit = explicitlyProvided.has(paramName)
        // If caller explicitly passed 'undefined' (from 'undef' literal), use the EXPLICIT_UNDEF sentinel.
        // This prevents JavaScript's default parameter behavior from overriding the caller's intent.
        if (value === 'undefined' && isExplicit) {
          value = 'j$.EXPLICIT_UNDEF'
        }
        result.push(value)
        wasExplicit.push(isExplicit)
      } else {
        result.push('undefined')
        wasExplicit.push(false)
      }
    }

    // Trim trailing undefined values (not explicitly provided)
    while (result.length > 0 && result[result.length - 1] === 'undefined' && !wasExplicit[result.length - 1]) {
      result.pop()
      wasExplicit.pop()
    }

    return result.join(', ')
  }
}
