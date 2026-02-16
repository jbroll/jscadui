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
 * Check if a string is a valid JavaScript identifier
 * (letters, digits, underscore, dollar sign; can't start with digit)
 */
export function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)
}

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
 * Skips matches inside string literals to avoid corrupting error messages.
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
  // Pattern to match identifiers with proper word boundaries:
  // 1. Not preceded by an identifier character (part of a larger identifier)
  // 2. Not preceded by an identifier character followed by a dot (property access like obj.name)
  // 3. Not immediately followed by a colon (object key like `{ name: value }`)
  //    This distinguishes from ternary operator where there's a space: `cond ? x : y`
  // But allow spread operators: ...name should be replaced
  // Note: $ is a valid JS identifier character, so include it in both lookbehind and lookahead
  const identifierPattern = new RegExp(
    `(?<![a-zA-Z0-9_$])(?<![a-zA-Z0-9_$]\\.)${escaped}(?![a-zA-Z0-9_$])(?!:)`,
    'g'
  )

  // Split code into string literals and code segments to avoid replacing inside strings
  // This regex matches single-quoted, double-quoted, and template strings
  const stringPattern = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = stringPattern.exec(code)) !== null) {
    // Process code segment before this string
    const codeSegment = code.slice(lastIndex, match.index)
    result += codeSegment.replace(identifierPattern, replacement)
    // Add the string literal unchanged
    result += match[0]
    lastIndex = match.index + match[0].length
  }

  // Process remaining code after the last string
  result += code.slice(lastIndex).replace(identifierPattern, replacement)

  return result
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

/**
 * Get the filename portion of a file path (basename).
 * Handles both forward and backslash separators.
 *
 * @param filePath - The file path (optional, defaults to 'input.scad')
 * @returns The filename portion (last component after slash)
 */
export function getShortFilename(filePath: string | undefined): string {
  if (!filePath) return 'input.scad'
  return filePath.split(/[/\\]/).pop() || filePath
}
