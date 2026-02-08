/**
 * Built-in primitive, transform, and extrusion handling
 */

import type { TranspileContext } from './context.js'

// Built-in type checks
export function isBuiltinPrimitive(name: string): boolean {
  return ['cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'regular_polygon'].includes(name)
}

export function isBuiltinTransform(name: string): boolean {
  return ['translate', 'rotate', 'scale', 'mirror', 'multmatrix'].includes(name)
}

export function isBuiltinBoolean(name: string): boolean {
  return ['union', 'difference', 'intersection', 'minkowski'].includes(name)
}

export function isBuiltinExtrusion(name: string): boolean {
  return ['linear_extrude', 'rotate_extrude'].includes(name)
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

export function transpileBuiltinPrimitive(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  // Map positional args to named args using parameter definitions
  const paramNames = primitiveParams[name] || []
  const namedArgs = argsArray.map((arg, i) => {
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

  // For primitives that use segments, inject inherited special vars if not already set
  const usesSegments = ['sphere', 'cylinder', 'circle', 'regular_polygon'].includes(name)
  if (usesSegments) {
    const hasVar = (varName: string) => argsArray.some(a => a.name === varName)
    if (ctx.inheritedSpecialVars.$fn && !hasVar('$fn')) {
      namedArgs.push(`$fn: ${ctx.inheritedSpecialVars.$fn}`)
    }
    if (ctx.inheritedSpecialVars.$fa && !hasVar('$fa')) {
      namedArgs.push(`$fa: ${ctx.inheritedSpecialVars.$fa}`)
    }
    if (ctx.inheritedSpecialVars.$fs && !hasVar('$fs')) {
      namedArgs.push(`$fs: ${ctx.inheritedSpecialVars.$fs}`)
    }
  }

  const argsStr = namedArgs.join(', ')

  switch (name) {
    case 'cube':
      ctx.usedPrimitives.add('cube')
      ctx.usedPrimitives.add('cuboid')
      ctx.usedTransforms.add('translate')
      return `j$.cube({ ${argsStr} })`

    case 'sphere':
      ctx.usedPrimitives.add('sphere')
      ctx.usedPrimitives.add('polyhedron')  // _sphere uses polyhedron internally
      return `j$.sphere({ ${argsStr} })`

    case 'cylinder':
      ctx.usedPrimitives.add('cylinder')
      ctx.usedTransforms.add('translate')
      return `j$.cylinder({ ${argsStr} })`

    case 'square':
      ctx.usedPrimitives.add('rectangle')
      ctx.usedTransforms.add('translate')
      return `j$.square({ ${argsStr} })`

    case 'circle':
      ctx.usedPrimitives.add('circle')
      return `j$.circle({ ${argsStr} })`

    case 'polygon':
      ctx.usedPrimitives.add('polygon')
      return `j$.polygon({ ${argsStr} })`

    case 'regular_polygon':
      ctx.usedPrimitives.add('regular_polygon')
      ctx.usedPrimitives.add('circle')  // Uses circle internally
      return `j$.regular_polygon({ ${argsStr} })`

    case 'polyhedron':
      ctx.usedPrimitives.add('polyhedron')
      return `j$.polyhedron({ ${argsStr} })`

    default:
      return `/* unknown primitive: ${name} */`
  }
}

export function transpileBuiltinTransform(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  child: string | null,
  ctx: TranspileContext
): string {
  const childCode = child || 'undefined'

  // Filter out $-prefixed special variables (like $fn, $fa, $fs)
  // These are scoped variables in OpenSCAD, not transform arguments
  const filteredArgs = argsArray.filter(a => !a.name || !a.name.startsWith('$'))
  const args = transpileArgsToObject(filteredArgs)

  // Handle underscore-prefixed versions (BOSL2 builtins.scad wrappers)
  const baseName = name.startsWith('_') ? name.slice(1) : name

  // Helper to get the primary value from args (handles both named and positional)
  const getArgValue = (argName: string) => {
    const arg = filteredArgs.find(a => a.name === argName || !a.name)
    return arg?.value
  }

  switch (baseName) {
    case 'translate': {
      // translate(v) or translate([x,y,z])
      const v = getArgValue('v') || '[0, 0, 0]'
      return `j$.translate(${v}, ${childCode})`
    }

    case 'rotate':
      // If args contains named params (has ':'), wrap in {} for axis-angle rotation
      if (args.includes(':')) {
        return `j$.rotate({ ${args} }, ${childCode})`
      }
      return `j$.rotate(${args}, ${childCode})`

    case 'scale': {
      // scale(v) where v is scalar or vector
      const v = getArgValue('v') || '1'
      return `j$.scale(${v}, ${childCode})`
    }

    case 'mirror': {
      // mirror(v) where v is the normal vector
      const v = getArgValue('v') || '[1, 0, 0]'
      return `j$.mirror(${v}, ${childCode})`
    }

    case 'multmatrix': {
      // multmatrix(m) applies a 4x4 transformation matrix
      // The 'm' parameter is the matrix
      ctx.usedTransforms.add('transform')
      ctx.usedHelpers.add('multmatrix')
      const matrixArg = argsArray.find(a => a.name === 'm' || !a.name)?.value || '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]'
      return `j$.multmatrix(${matrixArg}, ${childCode})`
    }

    default:
      return `/* unknown transform: ${name} */`
  }
}

export function transpileBuiltinExtrusion(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  child: string | null,
  ctx: TranspileContext
): string {
  const childCode = child || 'undefined'

  // Map positional args to named args using parameter definitions
  const paramNames = extrusionParams[name] || []
  const namedArgs = argsArray.map((arg, i) => {
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
  const args = namedArgs.join(', ')

  switch (name) {
    case 'linear_extrude':
      ctx.usedExtrusions.add('extrudeLinear')
      ctx.usedTransforms.add('translate')  // _linearExtrude helper uses translate for center
      return `j$.linearExtrude({ ${args} }, ${childCode})`

    case 'rotate_extrude':
      ctx.usedExtrusions.add('extrudeRotate')
      return `j$.rotateExtrude({ ${args} }, ${childCode})`

    default:
      return `/* unknown extrusion: ${name} */`
  }
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
