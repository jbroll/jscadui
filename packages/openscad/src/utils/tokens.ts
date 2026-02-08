/**
 * Token type constants from openscad-parser
 *
 * These match the numeric values used by openscad-parser's TokenType enum.
 * Using named constants makes the transpiler code more readable.
 */

export const TokenType = {
  // Logical operators
  Bang: 18,        // !

  // Comparison operators
  Less: 19,        // <
  Greater: 20,     // >
  LessEqual: 21,   // <=
  GreaterEqual: 22, // >=
  EqualEqual: 23,  // ==
  BangEqual: 25,   // !=

  // Logical connectives
  AND: 26,         // &&
  OR: 27,          // ||

  // Arithmetic operators
  Plus: 28,        // +
  Minus: 29,       // -
  Star: 30,        // *
  Slash: 31,       // /
  Percent: 32,     // %
  Caret: 33,       // ^ (power)
} as const

export type TokenTypeValue = typeof TokenType[keyof typeof TokenType]
