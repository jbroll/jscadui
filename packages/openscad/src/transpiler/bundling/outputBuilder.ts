import type { TranspileContext } from '../context.js'
import { buildJscadImports } from '../helpers/index.js'
import { getModuleName } from '../builtins.js'
import { exportCleanLine } from '../cleanExports.js'
import { toJscadParameterDefinitions } from '../../customizer/definitions.js'
import type { CustomizerSchema } from '../../customizer/extract.js'

/**
 * Result of processing include statements
 */
export interface BundledContent {
  functions: string[]
  modules: string[]
  constants: string[]
  constantNameList: string[]  // parallel to constants ('' when unnamed)
  includeConstantStarts: number[]  // per include statement: its first index in constants
  functionNames: Set<string>
  moduleNames: Set<string>
  constantNames: Set<string>
  geometryStatements: string[]  // Top-level geometry from directly included files
}

/**
 * Result of transpiling all statements
 */
export interface TranspiledStatements {
  localFunctions: string[]
  localModules: string[]
  localConstants: string[]
  localConstantNames: string[]  // parallel to localConstants
  constantsBeforeInclude: number[]  // per include statement: local constants above it
  geometryParts: string[]
  // Customizer support (options.customizer): the schema, and the top-level
  // assignments re-run at the start of main() with parameter overrides
  customizer?: CustomizerSchema
  customizerPrologue: string[]
}

/**
 * Helpers emitted at the start of a Customizer main():
 * _$cp(name, fallback)  parameter value, or the source default
 * _$cv(name, fallback)  vector parameter reassembled from its `name[i]` components
 */
const CUSTOMIZER_HELPERS = [
  'const _$cp = (k, d) => { const v = _$params?.[k]; return v === undefined ? d : v }',
  'const _$cv = (k, d) => d.map((x, i) => _$cp(`${k}[${i}]`, x))',
]

/**
 * For each local constant, the index of the first include statement below it,
 * or undefined when it stays with the local constants. A name an include also
 * assigns is left alone: the in-place override rule places it.
 */
export function hoistAboveIncludes(names: string[], constantsBeforeInclude: number[], includedNames: Set<string>): (number | undefined)[] {
  return names.map((name, i) => {
    if (includedNames.has(name)) return undefined
    const k = constantsBeforeInclude.findIndex(count => i < count)
    return k === -1 ? undefined : k
  })
}

/**
 * Build the output code string
 */
export function buildOutputCode(
  ctx: TranspileContext,
  bundled: BundledContent,
  transpiled: TranspiledStatements
): { code: string; allExports: string[] } {
  const parts: string[] = []

  // Header with JSCAD imports
  if (ctx.options.includeHeader) {
    const imports = buildJscadImports(ctx)
    if (imports.length > 0) {
      parts.push(imports.join('\n'))
      parts.push('')
    }
  }

  // Top-level assignments may measure text, so fonts register before anything else runs
  const fonts = ctx.fontImports.filter(font => font.resolvedPath)
  if (fonts.length > 0) {
    for (const font of fonts) parts.push(`j$.useFont(require('${font.resolvedPath}'))`)
    parts.push('')
  }

  // Track imported symbols to avoid duplicates
  // Only track symbols from non-optimized includes (optimized ones are in useImports)
  const importedSymbols = new Set<string>()
  const useImportPaths = new Set(ctx.useImports.map(imp => imp.resolvedPath))
  for (const includeImport of ctx.includeImports) {
    if (!useImportPaths.has(includeImport.resolvedPath)) {
      for (const sym of includeImport.symbols) {
        importedSymbols.add(sym)
      }
    }
  }

  // Use imports (require statements for .scad files)
  // We always use lazy namespace access (const _ns = require(...); var f = (...a) => _ns.$scad?.f?.(...a))
  // instead of destructuring (var { f } = require(...)).
  //
  // Reason: mutual-dependency cycles (A uses B, B uses A) cause destructuring to capture
  // `undefined` when the cycle placeholder is returned — but by the time functions are
  // actually *called* (at render time, after all modules load), the namespace object has
  // been populated via Object.assign. Lazy access through the namespace therefore always
  // sees the real exports regardless of module evaluation order or shared-cache reuse.
  const nsByPath = new Map<string, string>()
  const includeNamespaces = new Set<string>()
  if (ctx.useImports.length > 0) {
    let nsIdx = 0
    for (const imp of ctx.useImports) {
      // Use resolvedPath to generate correct require() paths
      // resolvedPath is an absolute path starting with "/" (e.g., "/examples/openscad/bosl2/lib/std.scad")
      // The require system handles absolute paths by resolving them from the root URL
      // Fallback to filename if resolvedPath is empty (when no fileResolver)
      const scadPath = imp.resolvedPath || imp.filename
      // getParameterDefinitions is file-local (each file with parameters emits
      // its own `const`): forwarding a use-import's copy as `var` collides
      // with it, throwing SyntaxError at load.
      const newSymbols = imp.symbols.filter(s => s !== 'getParameterDefinitions' && !importedSymbols.has(s))
      for (const s of newSymbols) importedSymbols.add(s)
      if (newSymbols.length > 0) {
        const nsVar = `_ns${nsIdx++}`
        nsByPath.set(scadPath, nsVar)
        parts.push(`const ${nsVar} = require('${scadPath}')`)
        for (const sym of newSymbols) {
          parts.push(`var ${sym} = (...a) => ${nsVar}.$scad?.${sym}?.(...a)`)
        }
      } else if (imp.symbols.length === 0) {
        parts.push(`var ${getModuleName(imp.filename)} = require('${scadPath}')`)
      }
      // An optimized include is the same object in both lists; a `use` is not and is not re-exported.
      const ns = nsByPath.get(scadPath)
      if (ns && ctx.includeImports.includes(imp)) includeNamespaces.add(ns)
    }
    parts.push('')
  }

  // ALL FUNCTION DEFINITIONS FIRST (bundled from includes + local)
  const allFunctions = [...bundled.functions, ...transpiled.localFunctions]
  if (allFunctions.length > 0) {
    parts.push(allFunctions.join('\n\n'))
    parts.push('')
  }

  // An include is textual, so a name this file assigns that an included file
  // also assigns is one variable reassigned in one scope: OpenSCAD evaluates the
  // LAST value (this file's) at the FIRST position (the included file's). Put
  // this file's assignment in place of the included one and drop it below.
  const localConstantByName = new Map<string, string>()
  transpiled.localConstantNames.forEach((name, i) => localConstantByName.set(name, transpiled.localConstants[i]))
  const overridden = new Set<string>()
  const libraryConstants = bundled.constants.map((code, i) => {
    const name = bundled.constantNameList[i]
    const local = name ? localConstantByName.get(name) : undefined
    if (local === undefined) return code
    overridden.add(name)
    return local
  })
  // An assignment above an include runs before the included assignments
  // (BOSL2's std.scad sets _BOSL2_STD, then includes files that test it).
  const aboveInclude = hoistAboveIncludes(
    transpiled.localConstantNames,
    transpiled.constantsBeforeInclude.slice(0, bundled.includeConstantStarts.length),
    new Set(bundled.constantNameList))
  const localConstants = transpiled.localConstants.filter((_, i) =>
    !overridden.has(transpiled.localConstantNames[i]) && aboveInclude[i] === undefined)
  const orderedConstants = bundled.includeConstantStarts.flatMap((start, k) => [
    ...transpiled.localConstants.filter((_, i) => aboveInclude[i] === k),
    ...libraryConstants.slice(start, bundled.includeConstantStarts[k + 1] ?? libraryConstants.length),
  ])

  // LIBRARY CONSTANTS (bundled from includes) - BEFORE MODULES
  if (orderedConstants.length > 0) {
    parts.push(orderedConstants.join('\n'))
    parts.push('')
  }

  // ALL MODULE DEFINITIONS (bundled from includes + local)
  const allModules = [...bundled.modules, ...transpiled.localModules]
  if (allModules.length > 0) {
    parts.push(allModules.join('\n\n'))
    parts.push('')
  }

  // LOCAL CONSTANT ASSIGNMENTS
  if (localConstants.length > 0) {
    parts.push(localConstants.join('\n'))
    parts.push('')
  }

  // Main function with file-scope geometry:
  // bundled.geometryStatements = top-level geometry from directly included files
  // transpiled.geometryParts = top-level geometry defined in this file itself
  const allGeometry = [...bundled.geometryStatements, ...transpiled.geometryParts]
  // Always route through safeUnion, including for a single statement: it is
  // what strips j$.NO_CHILD, which main() must never hand back to a caller.
  // withOverlays appends the % and # ghosts, if any, as previewOnly entries.
  const mainBody = allGeometry.length > 0
    ? `j$.withOverlays(j$.safeUnion([\n${allGeometry.map(p => `    ${p}`).join(',\n')}\n  ]))`
    : undefined
  const customizerExports: string[] = []
  if (transpiled.customizerPrologue.length > 0) {
    // Customizer: re-run top-level assignments with overrides so derived
    // variables are recomputed from the parameter values
    const defs = toJscadParameterDefinitions(transpiled.customizer!)
    parts.push(`const getParameterDefinitions = () => (${JSON.stringify(defs, null, 2)})`)
    parts.push('')
    // The re-run must not repeat echo() side effects: those already printed
    // once at module load. Mute around the assignments only; geometry below
    // still echoes. try/finally so a throwing assignment cannot leave the
    // worker muted for later runs.
    const helpers = CUSTOMIZER_HELPERS.map(l => `  ${l}`).join('\n')
    const reassign = transpiled.customizerPrologue.map(l => `    ${l}`).join('\n')
    parts.push(`const main = (_$params = {}) => {\n${helpers}\n  j$.echoMuted = true\n  try {\n${reassign}\n  } finally {\n    j$.echoMuted = false\n  }\n  return ${mainBody ?? 'undefined'}\n}`)
    parts.push('')
    customizerExports.push('getParameterDefinitions')
  } else if (mainBody) {
    parts.push(`const main = () => {\n  return ${mainBody}\n}`)
    parts.push('')
  } else {
    parts.push(`const main = () => undefined`)
    parts.push('')
  }

  // Exports - use SymbolTable as source of truth
  // Export only local symbols (defined in this file), not imported (from USE) or included (bundled from INCLUDE)
  const moduleExportNames = ctx.symbols.getByKind('module')
    .filter(name => ctx.symbols.isFromSource(name, 'local'))
    .map(name => `${name}_$m`)
  const functionExportNames = ctx.symbols.getByKind('function')
    .filter(name => ctx.symbols.isFromSource(name, 'local', 'function'))
    .flatMap(name => {
      // Check if this function has parameters by looking it up in declarations
      const decl = ctx.declarations.get(name + '_$f')
      const hasParams = decl && decl.params && decl.params.length > 0

      // Only export _$f$obj variant if function has parameters
      return hasParams ? [`${name}_$f`, `${name}_$f$obj`] : [`${name}_$f`]
    })
  // Filter out optimized includes (which were moved to useImports and will be imported via require())
  // useImportPaths is already declared above
  // Re-export symbols from ALL includes (both bundled and optimized)
  // Optimized includes use require() but still need their symbols re-exported
  // getParameterDefinitions is file-local (emitted only for a file with its own
  // parameters): re-exporting an include's copy references a binding this
  // module never defines, throwing ReferenceError at load.
  const includeReExports = ctx.includeImports
    .flatMap(imp => imp.symbols)
    .filter(s => s !== 'getParameterDefinitions')
  const scadExports = [...new Set([...moduleExportNames, ...functionExportNames, ...ctx.variableNames, ...includeReExports])]
  const jsExports = [...customizerExports, 'main']
  const allExports = [...new Set([...scadExports, ...jsExports])]
  // Use Object.assign to mutate the pre-registered exports object in-place.
  // This ensures cyclic requires (where the caller got an empty {} placeholder)
  // will see the real exports once the module finishes loading.
  const scadObject = scadExports.length ? `{ ${scadExports.join(', ')} }` : '{}'
  parts.push(`Object.assign(exports, { $scad: ${scadObject}, ${jsExports.join(', ')} })`)
  parts.push(exportCleanLine(ctx, scadExports, [...includeNamespaces]))

  // Function preambles compare parameters against this; `var` because modules may share a global scope.
  const code = parts.join('\n')
  const sentinel = /\b_\$U\b/.test(code) ? 'var _$U = j$.EXPLICIT_UNDEF\n' : ''
  return { code: sentinel + code, allExports }
}
