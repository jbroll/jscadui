/**
 * Transpiler utility functions
 */
import type { AssignmentNode } from 'openscad-parser'

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
