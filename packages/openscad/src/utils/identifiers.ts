/**
 * Identifier utilities for OpenSCAD transpiler
 */

// JavaScript reserved words that need to be renamed
const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'await', 'async', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity'
])

/**
 * Ensure an identifier is safe for JavaScript
 * Renames reserved words by prefixing with underscore
 */
export function safeIdentifier(name: string): string {
  return JS_RESERVED.has(name) ? `_${name}` : name
}

/**
 * Replace all occurrences of an identifier in code with a new name.
 * Uses word boundaries that handle OpenSCAD's $-prefixed special variables.
 *
 * @param code - The code string to modify
 * @param original - The original identifier to replace
 * @param replacement - The new identifier name
 * @returns The modified code string
 */
export function replaceIdentifier(
  code: string,
  original: string,
  replacement: string
): string {
  const escaped = original.replace(/\$/g, '\\$')
  return code.replace(
    new RegExp(`(?<![a-zA-Z0-9_$])${escaped}(?![a-zA-Z0-9_])`, 'g'),
    replacement
  )
}

/**
 * Get the directory portion of a file path.
 * Returns empty string for files with no directory component.
 *
 * @param filePath - The file path
 * @returns The directory portion (with trailing separator) or empty string
 */
export function getFileDir(filePath: string | undefined): string {
  if (!filePath) return ''
  return filePath.replace(/[^/\\]*$/, '')
}
