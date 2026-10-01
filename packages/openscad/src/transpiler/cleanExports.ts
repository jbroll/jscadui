import type { AssignmentNode, FunctionDeclarationStmt, ModuleDeclarationStmt } from 'openscad-parser'
import type { TranspileContext } from './context.js'
import type { Declaration } from './managers/DeclarationTracker.js'

export interface MetaParam { name: string; default?: string }
export interface MetaEntry { name: string; kind: 'module' | 'function' | 'variable'; params?: MetaParam[]; lazy?: true }

// value.span covers only the operator of a binary expression, so slice the source between tokens.
export const defaultText = (arg: AssignmentNode, closeParenStart: number): string | undefined => {
  const eq = arg.tokens.equals
  if (!eq) return undefined
  const to = arg.tokens.trailingCommas?.[0]?.span.start.char ?? closeParenStart
  return eq.span.start.file?.code.slice(eq.span.end.char, to).trim()
}

const paramsOf = (stmt: ModuleDeclarationStmt | FunctionDeclarationStmt): MetaParam[] => {
  const close = stmt.tokens.secondParen.span.start.char
  return stmt.definitionArgs.map((arg) => {
    const text = defaultText(arg, close)
    return text === undefined ? { name: arg.name } : { name: arg.name, default: text }
  })
}

// Bundled includes keep their declarations in the cache, not in ctx.declarations.
// First wins, matching the order processIncludeStatements bundles them in.
const bundledDeclarations = (ctx: TranspileContext): Map<string, Declaration> => {
  const decls = new Map<string, Declaration>()
  for (const imp of ctx.includeImports) {
    if (ctx.useImports.includes(imp)) continue
    for (const d of ctx.transpiledFiles.get(imp.resolvedPath)?.declarations ?? []) {
      if (!decls.has(d.name)) decls.set(d.name, d)
    }
  }
  return decls
}

export const metaEntries = (ctx: TranspileContext, exportNames: string[]): MetaEntry[] => {
  const bundled = bundledDeclarations(ctx)
  const declarationOf = (name: string) => ctx.declarations.get(name) ?? bundled.get(name)
  const variables = new Set(ctx.variableNames)
  const entries: MetaEntry[] = []
  for (const name of exportNames) {
    if (name.endsWith('_$m') || name.endsWith('_$f')) {
      const decl = declarationOf(name)
      const kind = name.endsWith('_$m') ? 'module' : 'function'
      if (decl?.ast) entries.push({ name: name.slice(0, -3), kind, params: paramsOf(decl.ast as ModuleDeclarationStmt | FunctionDeclarationStmt) })
    } else if (variables.has(name) || bundled.get(name)?.kind === 'constant') {
      entries.push(ctx.lazyVarNames.has(name) ? { name, kind: 'variable', lazy: true } : { name, kind: 'variable' })
    }
  }
  return entries
}

export const exportCleanLine = (ctx: TranspileContext, exportNames: string[], includeNamespaces: string[]): string => {
  const spreads = includeNamespaces.map((ns) => `...(${ns}.$meta ?? [])`)
  const literal = metaEntries(ctx, exportNames).map((e) => JSON.stringify(e))
  return `j$.exportClean(exports, exports.$scad, [${[...spreads, ...literal].join(', ')}])`
}
