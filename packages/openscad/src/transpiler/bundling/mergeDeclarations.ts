/**
 * Merge and organize declarations for AST-based bundling
 */
import type { Declaration } from '../managers/DeclarationTracker.js'

/**
 * Merge declarations from multiple sources, deduplicating by name.
 * First occurrence wins (matches current string-based behavior).
 */
export function mergeDeclarations(sources: Declaration[][]): Declaration[] {
  const merged = new Map<string, Declaration>()

  for (const sourceDecls of sources) {
    for (const decl of sourceDecls) {
      // First definition wins
      if (!merged.has(decl.name)) {
        merged.set(decl.name, decl)
      }
    }
  }

  return Array.from(merged.values())
}

/**
 * Split declarations by kind (for organized output)
 */
export function splitDeclarationsByKind(decls: Declaration[]): {
  functions: Declaration[]
  modules: Declaration[]
  constants: Declaration[]
} {
  const functions: Declaration[] = []
  const modules: Declaration[] = []
  const constants: Declaration[] = []

  for (const decl of decls) {
    switch (decl.kind) {
      case 'function':
        functions.push(decl)
        break
      case 'module':
        modules.push(decl)
        break
      case 'constant':
        constants.push(decl)
        break
    }
  }

  return { functions, modules, constants }
}
