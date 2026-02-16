/**
 * Built-in primitive, transform, and extrusion handling
 */

import type { TranspileContext } from './context.js'
import { WarningCode } from './context.js'

/**
 * Strip underscore prefix from module names.
 * BOSL2 uses underscore-prefixed wrappers (e.g., _cube) that delegate to OpenSCAD builtins.
 */
function stripUnderscorePrefix(name: string): string {
  return name.startsWith('_') ? name.slice(1) : name
}

// Built-in type checks
// All functions also match underscore-prefixed versions (BOSL2 builtins.scad wrappers)
export function isBuiltinPrimitive(name: string): boolean {
  const baseName = stripUnderscorePrefix(name)
  return ['cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'regular_polygon'].includes(baseName)
}

export function isBuiltinTransform(name: string): boolean {
  const baseName = stripUnderscorePrefix(name)
  return ['translate', 'rotate', 'scale', 'mirror', 'multmatrix'].includes(baseName)
}

export function isBuiltinBoolean(name: string): boolean {
  const baseName = stripUnderscorePrefix(name)
  return ['union', 'difference', 'intersection', 'minkowski'].includes(baseName)
}

export function isBuiltinExtrusion(name: string): boolean {
  const baseName = stripUnderscorePrefix(name)
  return ['linear_extrude', 'rotate_extrude'].includes(baseName)
}

// Positional parameter names for built-in primitives
// Note: cylinder with 3 positional args is [h, r1, r2], not [h, r, r1]
const primitiveParams: Record<string, string[]> = {
  cube: ['size', 'center'],
  sphere: ['r', 'd'],
  cylinder: ['h', 'r1', 'r2'],  // when 3 positional: h, r1, r2
  square: ['size', 'center'],
  circle: ['r', 'd'],
  polygon: ['points', 'paths'],
  polyhedron: ['points', 'faces', 'convexity'],
  regular_polygon: ['order', 'r'],  // n-sided polygon with circumradius r
}

// Positional parameter names for extrusions
const extrusionParams: Record<string, string[]> = {
  linear_extrude: ['height', 'center', 'twist', 'slices'],
  rotate_extrude: ['angle', 'convexity'],
}

/**
 * Transpile arguments to object literal format: { name: value, ... }
 * For positional args with no names, just uses the values
 */
export function transpileArgsToObject(args: Array<{name: string | null, value: string}>): string {
  if (args.length === 0) return ''

  const parts = args.map(arg => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    return arg.value
  })

  return parts.join(', ')
}

/**
 * Map positional arguments to named parameters using parameter definitions
 * @param argsArray - Arguments from the call site
 * @param paramNames - Expected parameter names for this builtin
 * @returns Array of strings in format "name: value" or just "value"
 */
function mapPositionalArgsToNamed(
  argsArray: Array<{name: string | null, value: string}>,
  paramNames: string[]
): string[] {
  return argsArray.map((arg, i) => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    // Use positional param name if available
    const paramName = paramNames[i]
    if (paramName) {
      return `${paramName}: ${arg.value}`
    }
    return arg.value
  })
}

export function transpileBuiltinPrimitive(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  // Handle underscore-prefixed versions (BOSL2 builtins.scad wrappers)
  const baseName = stripUnderscorePrefix(name)
  // Map positional args to named args using parameter definitions
  const paramNames = primitiveParams[baseName] || []
  const namedArgs = mapPositionalArgsToNamed(argsArray, paramNames)

  // Note: special vars ($fn, $fa, $fs) are read from the runtime stack by primitives
  // No need to inject them here - the stack-based dynamic scoping handles propagation

  const argsStr = namedArgs.join(', ')

  switch (baseName) {
    case 'cube':
      ctx.codeGen.usedPrimitives.add('cube')
      ctx.codeGen.usedPrimitives.add('cuboid')
      ctx.codeGen.usedTransforms.add('translate')
      return `j$.cube({ ${argsStr} })`

    case 'sphere':
      ctx.codeGen.usedPrimitives.add('sphere')
      ctx.codeGen.usedPrimitives.add('polyhedron')  // _sphere uses polyhedron internally
      return `j$.sphere({ ${argsStr} })`

    case 'cylinder':
      ctx.codeGen.usedPrimitives.add('cylinder')
      ctx.codeGen.usedTransforms.add('translate')
      return `j$.cylinder({ ${argsStr} })`

    case 'square':
      ctx.codeGen.usedPrimitives.add('rectangle')
      ctx.codeGen.usedTransforms.add('translate')
      return `j$.square({ ${argsStr} })`

    case 'circle':
      ctx.codeGen.usedPrimitives.add('circle')
      return `j$.circle({ ${argsStr} })`

    case 'polygon':
      ctx.codeGen.usedPrimitives.add('polygon')
      return `j$.polygon({ ${argsStr} })`

    case 'regular_polygon':
      ctx.codeGen.usedPrimitives.add('regular_polygon')
      ctx.codeGen.usedPrimitives.add('circle')  // Uses circle internally
      return `j$.regular_polygon({ ${argsStr} })`

    case 'polyhedron':
      ctx.codeGen.usedPrimitives.add('polyhedron')
      return `j$.polyhedron({ ${argsStr} })`

    default:
      ctx.warnings.push({
        code: WarningCode.UNKNOWN_BUILTIN,
        message: `Unknown primitive: ${baseName}`,
        file: ctx.options.currentFile
      })
      return `/* unknown primitive: ${baseName} */`
  }
}

export function transpileBuiltinTransform(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  child: string | null,
  ctx: TranspileContext
): string {
  const childCode = child || 'undefined'

  // Extract special variables (like $fn, $fa, $fs) - these are scoped variables
  const specialVarArgs = argsArray.filter(a => a.name && a.name.startsWith('$'))
  const filteredArgs = argsArray.filter(a => !a.name || !a.name.startsWith('$'))
  const args = transpileArgsToObject(filteredArgs)

  // Handle underscore-prefixed versions (BOSL2 builtins.scad wrappers)
  const baseName = stripUnderscorePrefix(name)

  // Helper to get the primary value from args (handles both named and positional)
  const getArgValue = (argName: string) => {
    const arg = filteredArgs.find(a => a.name === argName || !a.name)
    return arg?.value
  }

  // Helper to wrap transform code with special var scope if needed
  const wrapWithSpecialVars = (transformCode: string): string => {
    if (specialVarArgs.length === 0) {
      return transformCode
    }
    // Wrap with j$.withScope for special variables
    const vars = specialVarArgs.map(a => `'${a.name}': ${a.value}`).join(', ')
    return `j$.withScope({ ${vars} }, () => ${transformCode})`
  }

  switch (baseName) {
    case 'translate': {
      // translate(v) or translate([x,y,z])
      const v = getArgValue('v') || '[0, 0, 0]'
      return wrapWithSpecialVars(`j$.translate(${v}, ${childCode})`)
    }

    case 'rotate':
      // If args contains named params (has ':'), wrap in {} for axis-angle rotation
      if (args.includes(':')) {
        return wrapWithSpecialVars(`j$.rotate({ ${args} }, ${childCode})`)
      }
      return wrapWithSpecialVars(`j$.rotate(${args}, ${childCode})`)

    case 'scale': {
      // scale(v) where v is scalar or vector
      const v = getArgValue('v') || '1'
      return wrapWithSpecialVars(`j$.scale(${v}, ${childCode})`)
    }

    case 'mirror': {
      // mirror(v) where v is the normal vector
      const v = getArgValue('v') || '[1, 0, 0]'
      return wrapWithSpecialVars(`j$.mirror(${v}, ${childCode})`)
    }

    case 'multmatrix': {
      // multmatrix(m) applies a 4x4 transformation matrix
      // The 'm' parameter is the matrix
      ctx.codeGen.usedTransforms.add('transform')
      ctx.codeGen.usedHelpers.add('multmatrix')
      const matrixArg = argsArray.find(a => a.name === 'm' || !a.name)?.value || '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]'
      return wrapWithSpecialVars(`j$.multmatrix(${matrixArg}, ${childCode})`)
    }

    default:
      ctx.warnings.push({
        code: WarningCode.UNKNOWN_BUILTIN,
        message: `Unknown transform: ${name}`,
        file: ctx.options.currentFile
      })
      return `/* unknown transform: ${name} */`
  }
}

export function transpileBuiltinExtrusion(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  child: string | null,
  ctx: TranspileContext
): string {
  // Handle underscore-prefixed versions (BOSL2 builtins.scad wrappers)
  const baseName = stripUnderscorePrefix(name)
  const childCode = child || 'undefined'

  // Map positional args to named args using parameter definitions
  const paramNames = extrusionParams[baseName] || []
  const namedArgs = mapPositionalArgsToNamed(argsArray, paramNames)
  const args = namedArgs.join(', ')

  switch (baseName) {
    case 'linear_extrude':
      ctx.codeGen.usedExtrusions.add('extrudeLinear')
      ctx.codeGen.usedTransforms.add('translate')  // _linearExtrude helper uses translate for center
      return `j$.linearExtrude({ ${args} }, ${childCode})`

    case 'rotate_extrude':
      ctx.codeGen.usedExtrusions.add('extrudeRotate')
      return `j$.rotateExtrude({ ${args} }, ${childCode})`

    default:
      ctx.warnings.push({
        code: WarningCode.UNKNOWN_BUILTIN,
        message: `Unknown extrusion: ${baseName}`,
        file: ctx.options.currentFile
      })
      return `/* unknown extrusion: ${baseName} */`
  }
}

/**
 * Determine whether to use builtin handling for a name.
 *
 * Handles the underscore-prefix override mechanism (BOSL2 feature):
 * - Names starting with _ (like _cube, _translate) ALWAYS use builtin
 * - Otherwise, use builtin only if there's no user-defined symbol
 *
 * @param name - The symbol name to check
 * @param kind - Whether this is a module or function context
 * @param ctx - The transpile context
 * @returns true if builtin handling should be used
 */
export function shouldUseBuiltin(
  name: string,
  kind: 'module' | 'function',
  ctx: TranspileContext
): boolean {
  // Underscore-prefixed names ALWAYS use builtin (BOSL2 override mechanism)
  if (name.startsWith('_')) {
    return true
  }

  // Check if user has defined this symbol
  const hasUserDefined = ctx.symbols.isKind(name, kind)

  // Use builtin only if user hasn't overridden it
  return !hasUserDefined
}

/**
 * Convert filename to valid JS identifier
 * e.g., "hardware.scad" -> "hardware"
 */
export function getModuleName(filename: string): string {
  return filename
    .replace(/\.scad$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
}
