/**
 * Error types for OpenSCAD translation
 */

// Source location for error reporting
export interface SourceLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

export enum ErrorCode {
  PARSE_ERROR = 'PARSE_ERROR',
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
  UNDEFINED_VARIABLE = 'UNDEFINED_VARIABLE',
  UNDEFINED_MODULE = 'UNDEFINED_MODULE',
  UNDEFINED_FUNCTION = 'UNDEFINED_FUNCTION',
  TYPE_ERROR = 'TYPE_ERROR',
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class TranslationError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public location?: SourceLocation
  ) {
    super(message)
    this.name = 'TranslationError'
  }

  toString(): string {
    if (this.location) {
      return `${this.name} [${this.code}] at line ${this.location.start.line}, column ${this.location.start.column}: ${this.message}`
    }
    return `${this.name} [${this.code}]: ${this.message}`
  }
}

export function parseError(message: string, location?: SourceLocation): TranslationError {
  return new TranslationError(message, ErrorCode.PARSE_ERROR, location)
}

export function unsupportedFeature(feature: string, location?: SourceLocation): TranslationError {
  return new TranslationError(
    `Unsupported feature: ${feature}`,
    ErrorCode.UNSUPPORTED_FEATURE,
    location
  )
}

export function undefinedVariable(name: string, location?: SourceLocation): TranslationError {
  return new TranslationError(
    `Undefined variable: ${name}`,
    ErrorCode.UNDEFINED_VARIABLE,
    location
  )
}

export function undefinedModule(name: string, location?: SourceLocation): TranslationError {
  return new TranslationError(
    `Undefined module: ${name}`,
    ErrorCode.UNDEFINED_MODULE,
    location
  )
}

export function undefinedFunction(name: string, location?: SourceLocation): TranslationError {
  return new TranslationError(
    `Undefined function: ${name}`,
    ErrorCode.UNDEFINED_FUNCTION,
    location
  )
}

export function typeError(message: string, location?: SourceLocation): TranslationError {
  return new TranslationError(message, ErrorCode.TYPE_ERROR, location)
}

export function invalidArguments(message: string, location?: SourceLocation): TranslationError {
  return new TranslationError(message, ErrorCode.INVALID_ARGUMENTS, location)
}

export function internalError(message: string): TranslationError {
  return new TranslationError(message, ErrorCode.INTERNAL_ERROR)
}
