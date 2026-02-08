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
      return `_cube({ ${argsStr} })`

    case 'sphere':
      ctx.usedPrimitives.add('sphere')
      ctx.usedPrimitives.add('polyhedron')  // _sphere uses polyhedron internally
      return `_sphere({ ${argsStr} })`

    case 'cylinder':
      ctx.usedPrimitives.add('cylinder')
      ctx.usedTransforms.add('translate')
      return `_cylinder({ ${argsStr} })`

    case 'square':
      ctx.usedPrimitives.add('rectangle')
      ctx.usedTransforms.add('translate')
      return `_square({ ${argsStr} })`

    case 'circle':
      ctx.usedPrimitives.add('circle')
      return `_circle({ ${argsStr} })`

    case 'polygon':
      ctx.usedPrimitives.add('polygon')
      return `polygon({ ${argsStr} })`

    case 'regular_polygon':
      ctx.usedPrimitives.add('regular_polygon')
      ctx.usedPrimitives.add('circle')  // Uses circle internally
      return `_regular_polygon({ ${argsStr} })`

    case 'polyhedron':
      ctx.usedPrimitives.add('polyhedron')
      return `_polyhedron({ ${argsStr} })`

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

  switch (name) {
    case 'translate':
      ctx.usedTransforms.add('translate')
      return `translate(${args}, ${childCode})`

    case 'rotate':
      ctx.usedTransforms.add('rotateX')
      ctx.usedTransforms.add('rotateY')
      ctx.usedTransforms.add('rotateZ')
      // If args contains named params (has ':'), wrap in {} for axis-angle rotation
      // Also need 'transform' for the matrix rotation
      if (args.includes(':')) {
        ctx.usedTransforms.add('transform')
        return `_rotate({ ${args} }, ${childCode})`
      }
      return `_rotate(${args}, ${childCode})`

    case 'scale':
      ctx.usedTransforms.add('scale')
      return `scale(${args}, ${childCode})`

    case 'mirror':
      ctx.usedTransforms.add('mirror')
      return `mirror({ normal: ${args} }, ${childCode})`

    case 'multmatrix': {
      // multmatrix(m) applies a 4x4 transformation matrix
      // The 'm' parameter is the matrix
      ctx.usedTransforms.add('transform')
      const matrixArg = argsArray.find(a => a.name === 'm' || !a.name)?.value || '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]'
      return `_multmatrix(${matrixArg}, ${childCode})`
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
      return `_linearExtrude({ ${args} }, ${childCode})`

    case 'rotate_extrude':
      ctx.usedExtrusions.add('extrudeRotate')
      return `_rotateExtrude({ ${args} }, ${childCode})`

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
