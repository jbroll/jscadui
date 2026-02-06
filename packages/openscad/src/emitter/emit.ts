/**
 * JSCAD Code Emitter
 *
 * Converts geometry IR to JSCAD JavaScript code.
 */

import type { IRNode, IRPrimitive, IRTransform, IRBoolean, IRHull, IRMinkowski, IRColor } from '../ir/types.js'
import { degToRad } from '../utils/angles.js'

export interface EmitOptions {
  // Pretty-print output
  format?: boolean
  // Indent string
  indent?: string
  // Include header with imports
  includeHeader?: boolean
}

const defaultOptions: Required<EmitOptions> = {
  format: true,
  indent: '  ',
  includeHeader: true,
}

/**
 * Emit IR as JSCAD code
 */
export function emit(ir: IRNode, options: EmitOptions = {}): string {
  const opts = { ...defaultOptions, ...options }
  const ctx = new EmitContext(opts)

  // Emit the geometry
  const body = emitNode(ir, ctx, 0)

  if (!opts.includeHeader) {
    return body
  }

  // Build the full module
  const imports = buildImports(ir)
  const header = imports.length > 0 ? imports.join('\n') + '\n\n' : ''

  return `${header}const main = () => {
  return ${body}
}

module.exports = { main }
`
}

/**
 * Emit context for tracking state during emission
 */
class EmitContext {
  constructor(public options: Required<EmitOptions>) {}

  indent(level: number): string {
    if (!this.options.format) return ''
    return this.options.indent.repeat(level)
  }

  newline(): string {
    return this.options.format ? '\n' : ''
  }
}

/**
 * Emit a single IR node
 */
function emitNode(node: IRNode, ctx: EmitContext, level: number): string {
  switch (node.type) {
    case 'primitive':
      return emitPrimitive(node, ctx)
    case 'transform':
      return emitTransform(node, ctx, level)
    case 'boolean':
      return emitBoolean(node, ctx, level)
    case 'hull':
      return emitHull(node, ctx, level)
    case 'minkowski':
      return emitMinkowski(node, ctx, level)
    case 'extrusion':
      return emitExtrusion(node as any, ctx, level)
    case 'color':
      return emitColor(node, ctx, level)
    case 'group':
      return emitGroup(node.children, ctx, level)
    case 'empty':
      return 'undefined'
    default:
      return `/* unsupported: ${(node as any).type} */`
  }
}

/**
 * Emit a primitive
 */
function emitPrimitive(node: IRPrimitive, _ctx: EmitContext): string {
  const { primitive, params } = node

  switch (primitive) {
    case 'cube': {
      const size = params.size as number[]
      const center = params.center as boolean

      // Use cube() for uniform size, cuboid() otherwise
      if (size[0] === size[1] && size[1] === size[2]) {
        if (center) {
          return `cube({ size: ${size[0]} })`
        } else {
          // JSCAD cube is centered by default, need to translate
          return `translate([${size[0] / 2}, ${size[1] / 2}, ${size[2] / 2}], cube({ size: ${size[0]} }))`
        }
      } else {
        if (center) {
          return `cuboid({ size: [${size.join(', ')}] })`
        } else {
          return `translate([${size[0] / 2}, ${size[1] / 2}, ${size[2] / 2}], cuboid({ size: [${size.join(', ')}] }))`
        }
      }
    }

    case 'sphere': {
      const radius = params.radius as number
      const segments = params.segments as number
      return `sphere({ radius: ${radius}, segments: ${segments} })`
    }

    case 'cylinder': {
      const height = params.height as number
      const r1 = params.radius1 as number
      const r2 = params.radius2 as number
      const center = params.center as boolean
      const segments = params.segments as number

      let result: string
      if (r1 === r2) {
        result = `cylinder({ height: ${height}, radius: ${r1}, segments: ${segments} })`
      } else {
        result = `cylinderElliptic({ height: ${height}, startRadius: [${r1}, ${r1}], endRadius: [${r2}, ${r2}], segments: ${segments} })`
      }

      if (!center) {
        // JSCAD cylinder is centered, need to translate
        result = `translate([0, 0, ${height / 2}], ${result})`
      }
      return result
    }

    case 'square': {
      const size = params.size as number[]
      const center = params.center as boolean
      if (center) {
        return `rectangle({ size: [${size.join(', ')}] })`
      } else {
        return `translate([${size[0] / 2}, ${size[1] / 2}], rectangle({ size: [${size.join(', ')}] }))`
      }
    }

    case 'circle': {
      const radius = params.radius as number
      const segments = params.segments as number
      return `circle({ radius: ${radius}, segments: ${segments} })`
    }

    case 'polygon': {
      const points = params.points as number[][]
      return `polygon({ points: [${points.map(p => `[${p.join(', ')}]`).join(', ')}] })`
    }

    default:
      return `/* unknown primitive: ${primitive} */`
  }
}

/**
 * Emit a transform
 */
function emitTransform(node: IRTransform, ctx: EmitContext, level: number): string {
  const { transform, params, children } = node
  const child = children.length === 1 ? emitNode(children[0], ctx, level) : emitGroup(children, ctx, level)

  switch (transform) {
    case 'translate': {
      const v = params.v as number[]
      return `translate([${v.join(', ')}], ${child})`
    }

    case 'rotate': {
      // Handle Euler angles
      if (params.angles) {
        const angles = params.angles as number[]
        let result = child

        // Apply rotations in Z, Y, X order (reverse of OpenSCAD)
        if (angles[2] !== 0) {
          result = `rotateZ(${formatAngle(angles[2])}, ${result})`
        }
        if (angles[1] !== 0) {
          result = `rotateY(${formatAngle(angles[1])}, ${result})`
        }
        if (angles[0] !== 0) {
          result = `rotateX(${formatAngle(angles[0])}, ${result})`
        }
        return result
      }

      // Handle axis-angle rotation
      if (params.a !== undefined && params.v !== undefined) {
        const a = params.a as number
        const v = params.v as number[]
        // Use mat4 for arbitrary axis rotation
        return `transform(mat4.fromRotation(mat4.create(), ${formatAngle(a)}, [${v.join(', ')}]), ${child})`
      }

      return child
    }

    case 'scale': {
      const v = params.v as number[]
      return `scale([${v.join(', ')}], ${child})`
    }

    case 'mirror': {
      const v = params.v as number[]
      return `mirror({ normal: [${v.join(', ')}] }, ${child})`
    }

    default:
      return `/* unknown transform: ${transform} */ ${child}`
  }
}

/**
 * Emit a boolean operation
 */
function emitBoolean(node: IRBoolean, ctx: EmitContext, level: number): string {
  const { operation, children } = node

  if (children.length === 0) {
    return 'undefined'
  }

  const childStrs = children.map(c => emitNode(c, ctx, level + 1))

  if (ctx.options.format && childStrs.length > 1) {
    const indent = ctx.indent(level + 1)
    const childrenFormatted = childStrs.map(c => `${indent}${c}`).join(',\n')
    switch (operation) {
      case 'union':
        return `union(\n${childrenFormatted}\n${ctx.indent(level)})`
      case 'difference':
        return `subtract(\n${childrenFormatted}\n${ctx.indent(level)})`
      case 'intersection':
        return `intersect(\n${childrenFormatted}\n${ctx.indent(level)})`
    }
  }

  const childrenStr = childStrs.join(', ')
  switch (operation) {
    case 'union':
      return `union(${childrenStr})`
    case 'difference':
      return `subtract(${childrenStr})`
    case 'intersection':
      return `intersect(${childrenStr})`
  }
}

/**
 * Emit a hull operation
 */
function emitHull(node: IRHull, ctx: EmitContext, level: number): string {
  const childStrs = node.children.map(c => emitNode(c, ctx, level + 1))
  return `hull(${childStrs.join(', ')})`
}

/**
 * Emit a minkowski operation
 */
function emitMinkowski(node: IRMinkowski, ctx: EmitContext, level: number): string {
  // JSCAD doesn't have native minkowski, use expand as approximation for simple cases
  // For now, emit a comment with the operation
  const childStrs = node.children.map(c => emitNode(c, ctx, level + 1))
  return `/* minkowski not directly supported */ union(${childStrs.join(', ')})`
}

/**
 * Emit an extrusion operation
 */
function emitExtrusion(node: { operation: string; params: Record<string, any>; children: IRNode[] }, ctx: EmitContext, level: number): string {
  const { operation, params, children } = node
  const child = children.length === 1
    ? emitNode(children[0], ctx, level)
    : emitGroup(children, ctx, level)

  if (operation === 'linear_extrude') {
    const height = params.height as number
    const twist = params.twist as number
    const slices = params.slices as number
    const scale = params.scale

    const options: string[] = [`height: ${height}`]
    if (twist !== 0) {
      options.push(`twistAngle: ${formatAngle(twist)}`)
      options.push(`twistSteps: ${Math.ceil(slices)}`)
    }
    if (scale !== 1 && scale !== undefined) {
      // JSCAD doesn't have direct scale support in extrudeLinear
      // For now, just emit height
    }

    return `extrudeLinear({ ${options.join(', ')} }, ${child})`
  }

  if (operation === 'rotate_extrude') {
    const angle = params.angle as number
    const segments = params.segments as number

    if (angle === 360) {
      return `extrudeRotate({ segments: ${segments} }, ${child})`
    }
    return `extrudeRotate({ angle: ${formatAngle(angle)}, segments: ${segments} }, ${child})`
  }

  return `/* unknown extrusion: ${operation} */ ${child}`
}

/**
 * Emit a color node
 */
function emitColor(node: IRColor, ctx: EmitContext, level: number): string {
  const [r, g, b, a] = node.color
  const child = node.children.length === 1
    ? emitNode(node.children[0], ctx, level)
    : emitGroup(node.children, ctx, level)

  if (a === 1) {
    return `colorize([${r}, ${g}, ${b}], ${child})`
  }
  return `colorize([${r}, ${g}, ${b}, ${a}], ${child})`
}

/**
 * Emit a group of nodes as union
 */
function emitGroup(children: IRNode[], ctx: EmitContext, level: number): string {
  const filtered = children.filter(c => c.type !== 'empty')

  if (filtered.length === 0) {
    return 'undefined'
  }
  if (filtered.length === 1) {
    return emitNode(filtered[0], ctx, level)
  }

  const childStrs = filtered.map(c => emitNode(c, ctx, level + 1))

  if (ctx.options.format) {
    const indent = ctx.indent(level + 1)
    const childrenFormatted = childStrs.map(c => `${indent}${c}`).join(',\n')
    return `union(\n${childrenFormatted}\n${ctx.indent(level)})`
  }

  return `union(${childStrs.join(', ')})`
}

/**
 * Format an angle (degrees to radians)
 */
function formatAngle(degrees: number): string {
  // Use common fractions of PI for cleaner output
  if (degrees === 90) return 'Math.PI / 2'
  if (degrees === -90) return '-Math.PI / 2'
  if (degrees === 180) return 'Math.PI'
  if (degrees === -180) return '-Math.PI'
  if (degrees === 45) return 'Math.PI / 4'
  if (degrees === -45) return '-Math.PI / 4'
  if (degrees === 0) return '0'

  // Otherwise compute the radians
  const rad = degToRad(degrees)
  return rad.toFixed(6).replace(/\.?0+$/, '')
}

/**
 * Build import statements based on what's used in the IR
 */
function buildImports(ir: IRNode): string[] {
  const used = {
    primitives: new Set<string>(),
    transforms: new Set<string>(),
    booleans: new Set<string>(),
    extrusions: new Set<string>(),
    colors: false,
    hulls: false,
    maths: false,
  }

  collectImports(ir, used)

  const imports: string[] = []

  if (used.primitives.size > 0) {
    imports.push(`const { ${Array.from(used.primitives).join(', ')} } = require('@jscad/modeling').primitives`)
  }
  if (used.transforms.size > 0) {
    imports.push(`const { ${Array.from(used.transforms).join(', ')} } = require('@jscad/modeling').transforms`)
  }
  if (used.booleans.size > 0) {
    imports.push(`const { ${Array.from(used.booleans).join(', ')} } = require('@jscad/modeling').booleans`)
  }
  if (used.extrusions.size > 0) {
    imports.push(`const { ${Array.from(used.extrusions).join(', ')} } = require('@jscad/modeling').extrusions`)
  }
  if (used.colors) {
    imports.push(`const { colorize } = require('@jscad/modeling').colors`)
  }
  if (used.hulls) {
    imports.push(`const { hull } = require('@jscad/modeling').hulls`)
  }
  if (used.maths) {
    imports.push(`const { mat4 } = require('@jscad/modeling').maths`)
  }

  return imports
}

/**
 * Recursively collect what imports are needed
 */
function collectImports(node: IRNode, used: {
  primitives: Set<string>
  transforms: Set<string>
  booleans: Set<string>
  extrusions: Set<string>
  colors: boolean
  hulls: boolean
  maths: boolean
}): void {
  switch (node.type) {
    case 'primitive': {
      const prim = node as IRPrimitive
      switch (prim.primitive) {
        case 'cube': {
          const size = prim.params.size as number[]
          if (size[0] === size[1] && size[1] === size[2]) {
            used.primitives.add('cube')
          } else {
            used.primitives.add('cuboid')
          }
          // If not centered, need translate
          if (!prim.params.center) {
            used.transforms.add('translate')
          }
          break
        }
        case 'sphere':
          used.primitives.add('sphere')
          break
        case 'cylinder':
          if (prim.params.radius1 === prim.params.radius2) {
            used.primitives.add('cylinder')
          } else {
            used.primitives.add('cylinderElliptic')
          }
          if (!prim.params.center) {
            used.transforms.add('translate')
          }
          break
        case 'square':
          used.primitives.add('rectangle')
          if (!prim.params.center) {
            used.transforms.add('translate')
          }
          break
        case 'circle':
          used.primitives.add('circle')
          break
        case 'polygon':
          used.primitives.add('polygon')
          break
      }
      break
    }

    case 'transform': {
      const t = node as IRTransform
      switch (t.transform) {
        case 'translate':
          used.transforms.add('translate')
          break
        case 'rotate':
          if (t.params.angles) {
            const angles = t.params.angles as number[]
            if (angles[0] !== 0) used.transforms.add('rotateX')
            if (angles[1] !== 0) used.transforms.add('rotateY')
            if (angles[2] !== 0) used.transforms.add('rotateZ')
          }
          if (t.params.a !== undefined && t.params.v !== undefined) {
            used.transforms.add('transform')
            used.maths = true
          }
          break
        case 'scale':
          used.transforms.add('scale')
          break
        case 'mirror':
          used.transforms.add('mirror')
          break
      }
      for (const child of t.children) {
        collectImports(child, used)
      }
      break
    }

    case 'boolean': {
      const b = node as IRBoolean
      switch (b.operation) {
        case 'union':
          used.booleans.add('union')
          break
        case 'difference':
          used.booleans.add('subtract')
          break
        case 'intersection':
          used.booleans.add('intersect')
          break
      }
      for (const child of b.children) {
        collectImports(child, used)
      }
      break
    }

    case 'hull':
      used.hulls = true
      for (const child of (node as IRHull).children) {
        collectImports(child, used)
      }
      break

    case 'minkowski':
      used.booleans.add('union')
      for (const child of (node as IRMinkowski).children) {
        collectImports(child, used)
      }
      break

    case 'extrusion': {
      const ext = node as any
      if (ext.operation === 'linear_extrude') {
        used.extrusions.add('extrudeLinear')
      } else if (ext.operation === 'rotate_extrude') {
        used.extrusions.add('extrudeRotate')
      }
      for (const child of ext.children) {
        collectImports(child, used)
      }
      break
    }

    case 'color':
      used.colors = true
      for (const child of (node as IRColor).children) {
        collectImports(child, used)
      }
      break

    case 'group':
      if (node.children.length > 1) {
        used.booleans.add('union')
      }
      for (const child of node.children) {
        collectImports(child, used)
      }
      break
  }
}
