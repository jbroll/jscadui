/**
 * Transpile declarations from AST for bundling
 */
import type { FunctionDeclarationStmt, ModuleDeclarationStmt } from 'openscad-parser'
import type { Declaration } from '../managers/DeclarationTracker.js'
import type { TranspileContext } from '../context.js'
import { transpileFunctionDeclaration, transpileModuleDeclaration, transpileStatement } from '../statements.js'

/**
 * Transpile a single declaration from its AST
 */
export function transpileDeclaration(decl: Declaration, ctx: TranspileContext): string {
  switch (decl.kind) {
    case 'function':
      return transpileFunctionDeclaration(decl.ast as FunctionDeclarationStmt, ctx)
    case 'module':
      return transpileModuleDeclaration(decl.ast as ModuleDeclarationStmt, ctx)
    case 'constant': {
      const code = transpileStatement(decl.ast, ctx)
      return code ?? ''  // Return empty string if null
    }
    default:
      throw new Error(`Unknown declaration kind: ${decl.kind}`)
  }
}

/**
 * Transpile a list of declarations
 */
export function transpileDeclarations(decls: Declaration[], ctx: TranspileContext): string {
  return decls.map(d => transpileDeclaration(d, ctx)).join('\n\n')
}
