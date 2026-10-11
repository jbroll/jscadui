import type { TranspileContext, BundledParts, TranspiledFile } from '../context.js'
import { importSymbolsFromFile } from '../utils.js'

/**
 * Propagate use imports from included files to parent context
 */
export function propagateUseImportsFromInclude(ctx: TranspileContext, parts: BundledParts): void {
  if (!parts.useImports) return

  for (const useImp of parts.useImports) {
    // Add to useImports if not already present (by resolved path)
    if (!ctx.useImports.some(u => u.resolvedPath === useImp.resolvedPath)) {
      ctx.useImports.push(useImp)
      // Import symbols from the propagated use import.
      // registerParams must be true so that param lists are available for named-arg
      // reordering at call sites in this file (e.g., rounded_square calls from global.scad).
      const usedFile = ctx.transpiledFiles.get(useImp.resolvedPath)
      importSymbolsFromFile(usedFile, ctx, {
        defineModules: false,
        registerParams: true,
      })
    }
  }
}

/**
 * Merge imported symbols from a cached file
 * Used for include statements which import both functions and modules
 */
export function mergeImportedSymbols(ctx: TranspileContext, cachedFile: TranspiledFile | undefined): void {
  // Import all symbols with default options (import everything)
  importSymbolsFromFile(cachedFile, ctx)
}
