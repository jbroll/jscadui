/**
 * Built-in OpenSCAD modules (primitives, transforms, booleans)
 */

import type { IRNode, IRValue, IRPrimitive, IRTransform, IRBoolean, IRHull, IRMinkowski } from '../ir/types.js'
import type { Scope } from './scope.js'
import { getSegments } from './scope.js'

// Argument helper types
interface BuiltinArgs {
  positional: IRValue[]
  named: Record<string, IRValue>
}

type BuiltinHandler = (args: BuiltinArgs, children: IRNode[], scope: Scope) => IRNode | null

// Registry of built-in modules
const builtins = new Map<string, BuiltinHandler>()

/**
 * Check if a module name is a built-in
 */
export function isBuiltinModule(name: string): boolean {
  return builtins.has(name)
}

/**
 * Invoke a built-in module
 */
export function invokeBuiltin(
  name: string,
  args: BuiltinArgs,
  children: IRNode[],
  scope: Scope
): IRNode | null {
  const handler = builtins.get(name)
  if (!handler) return null
  return handler(args, children, scope)
}

// Helper to get a named or positional argument
function getArg(args: BuiltinArgs, name: string, position: number, defaultValue?: IRValue): IRValue {
  if (name in args.named) {
    return args.named[name]
  }
  if (position < args.positional.length) {
    return args.positional[position]
  }
  return defaultValue
}

function getNumberArg(args: BuiltinArgs, name: string, position: number, defaultValue: number): number {
  const val = getArg(args, name, position, defaultValue)
  return typeof val === 'number' ? val : defaultValue
}

function getVectorArg(args: BuiltinArgs, name: string, position: number, defaultValue: number[]): number[] {
  const val = getArg(args, name, position, defaultValue)
  if (Array.isArray(val)) {
    return val.map(v => typeof v === 'number' ? v : 0)
  }
  return defaultValue
}

function getBoolArg(args: BuiltinArgs, name: string, position: number, defaultValue: boolean): boolean {
  const val = getArg(args, name, position, defaultValue)
  return typeof val === 'boolean' ? val : defaultValue
}

// Wrap children in a group/union if needed
function wrapChildren(children: IRNode[]): IRNode {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length === 0) {
    return { type: 'empty' }
  }
  if (filtered.length === 1) {
    return filtered[0]
  }
  return { type: 'group', children: filtered }
}

// ============= PRIMITIVES =============

// cube([size]) or cube(size, center)
builtins.set('cube', (args) => {
  const sizeArg = getArg(args, 'size', 0, 1)
  const center = getBoolArg(args, 'center', 1, false)

  let size: number[]
  if (typeof sizeArg === 'number') {
    size = [sizeArg, sizeArg, sizeArg]
  } else if (Array.isArray(sizeArg)) {
    size = sizeArg.map(v => typeof v === 'number' ? v : 1)
    while (size.length < 3) size.push(1)
  } else {
    size = [1, 1, 1]
  }

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'cube',
    params: { size, center }
  }
  return node
})

// sphere(r) or sphere(r, $fn)
builtins.set('sphere', (args, _children, scope) => {
  const r = getNumberArg(args, 'r', 0, 1)
  const d = getArg(args, 'd', -1, undefined)
  const radius = d !== undefined && typeof d === 'number' ? d / 2 : r
  const segments = getNumberArg(args, '$fn', -1, getSegments(scope))

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'sphere',
    params: { radius, segments }
  }
  return node
})

// cylinder(h, r) or cylinder(h, r1, r2) or cylinder(h, d, d1, d2)
builtins.set('cylinder', (args, _children, scope) => {
  const h = getNumberArg(args, 'h', 0, 1)
  const r = getNumberArg(args, 'r', 1, 1)
  const r1 = getArg(args, 'r1', -1, undefined)
  const r2 = getArg(args, 'r2', -1, undefined)
  const d = getArg(args, 'd', -1, undefined)
  const d1 = getArg(args, 'd1', -1, undefined)
  const d2 = getArg(args, 'd2', -1, undefined)
  const center = getBoolArg(args, 'center', -1, false)
  const segments = getNumberArg(args, '$fn', -1, getSegments(scope))

  // Determine radii
  let radius1: number
  let radius2: number

  if (d1 !== undefined && typeof d1 === 'number') {
    radius1 = d1 / 2
  } else if (r1 !== undefined && typeof r1 === 'number') {
    radius1 = r1
  } else if (d !== undefined && typeof d === 'number') {
    radius1 = d / 2
  } else {
    radius1 = r
  }

  if (d2 !== undefined && typeof d2 === 'number') {
    radius2 = d2 / 2
  } else if (r2 !== undefined && typeof r2 === 'number') {
    radius2 = r2
  } else if (d !== undefined && typeof d === 'number') {
    radius2 = d / 2
  } else {
    radius2 = r
  }

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'cylinder',
    params: { height: h, radius1, radius2, center, segments }
  }
  return node
})

// ============= 2D PRIMITIVES =============

// square([x, y]) or square(size, center)
builtins.set('square', (args) => {
  const sizeArg = getArg(args, 'size', 0, 1)
  const center = getBoolArg(args, 'center', 1, false)

  let size: number[]
  if (typeof sizeArg === 'number') {
    size = [sizeArg, sizeArg]
  } else if (Array.isArray(sizeArg)) {
    size = sizeArg.map(v => typeof v === 'number' ? v : 1)
    while (size.length < 2) size.push(1)
  } else {
    size = [1, 1]
  }

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'square',
    params: { size, center }
  }
  return node
})

// circle(r) or circle(d)
builtins.set('circle', (args, _children, scope) => {
  const r = getNumberArg(args, 'r', 0, 1)
  const d = getArg(args, 'd', -1, undefined)
  const radius = d !== undefined && typeof d === 'number' ? d / 2 : r
  const segments = getNumberArg(args, '$fn', -1, getSegments(scope))

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'circle',
    params: { radius, segments }
  }
  return node
})

// polygon(points, paths)
builtins.set('polygon', (args) => {
  const points = getArg(args, 'points', 0, []) as number[][]
  const paths = getArg(args, 'paths', 1, undefined)

  const node: IRPrimitive = {
    type: 'primitive',
    primitive: 'polygon',
    params: { points, paths }
  }
  return node
})

// ============= TRANSFORMS =============

// translate([x, y, z])
builtins.set('translate', (args, children) => {
  const v = getVectorArg(args, 'v', 0, [0, 0, 0])
  while (v.length < 3) v.push(0)

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  const node: IRTransform = {
    type: 'transform',
    transform: 'translate',
    params: { v },
    children: [child]
  }
  return node
})

// rotate([x, y, z]) or rotate(a, v)
builtins.set('rotate', (args, children) => {
  const a = getArg(args, 'a', 0, [0, 0, 0])
  const v = getArg(args, 'v', 1, undefined)

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  let rotation: number[]
  if (v !== undefined && Array.isArray(v) && typeof a === 'number') {
    // Axis-angle rotation: rotate(a, [x,y,z])
    rotation = [a, ...(v as number[])]
    const node: IRTransform = {
      type: 'transform',
      transform: 'rotate',
      params: { a, v },
      children: [child]
    }
    return node
  } else if (Array.isArray(a)) {
    // Euler angles: rotate([x, y, z])
    rotation = a.map(x => typeof x === 'number' ? x : 0)
    while (rotation.length < 3) rotation.push(0)
  } else if (typeof a === 'number') {
    // Single angle around Z
    rotation = [0, 0, a]
  } else {
    rotation = [0, 0, 0]
  }

  const node: IRTransform = {
    type: 'transform',
    transform: 'rotate',
    params: { angles: rotation },
    children: [child]
  }
  return node
})

// scale([x, y, z])
builtins.set('scale', (args, children) => {
  const v = getArg(args, 'v', 0, [1, 1, 1])

  let scaleVec: number[]
  if (typeof v === 'number') {
    scaleVec = [v, v, v]
  } else if (Array.isArray(v)) {
    scaleVec = v.map(x => typeof x === 'number' ? x : 1)
    while (scaleVec.length < 3) scaleVec.push(1)
  } else {
    scaleVec = [1, 1, 1]
  }

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  const node: IRTransform = {
    type: 'transform',
    transform: 'scale',
    params: { v: scaleVec },
    children: [child]
  }
  return node
})

// mirror([x, y, z])
builtins.set('mirror', (args, children) => {
  const v = getVectorArg(args, 'v', 0, [1, 0, 0])
  while (v.length < 3) v.push(0)

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  const node: IRTransform = {
    type: 'transform',
    transform: 'mirror',
    params: { v },
    children: [child]
  }
  return node
})

// ============= BOOLEANS =============

// union()
builtins.set('union', (_args, children) => {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length === 0) return { type: 'empty' }
  if (filtered.length === 1) return filtered[0]

  const node: IRBoolean = {
    type: 'boolean',
    operation: 'union',
    children: filtered
  }
  return node
})

// difference()
builtins.set('difference', (_args, children) => {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length === 0) return { type: 'empty' }
  if (filtered.length === 1) return filtered[0]

  const node: IRBoolean = {
    type: 'boolean',
    operation: 'difference',
    children: filtered
  }
  return node
})

// intersection()
builtins.set('intersection', (_args, children) => {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length === 0) return { type: 'empty' }
  if (filtered.length === 1) return filtered[0]

  const node: IRBoolean = {
    type: 'boolean',
    operation: 'intersection',
    children: filtered
  }
  return node
})

// hull()
builtins.set('hull', (_args, children) => {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length === 0) return { type: 'empty' }
  if (filtered.length === 1) return filtered[0]

  const node: IRHull = {
    type: 'hull',
    children: filtered
  }
  return node
})

// minkowski()
builtins.set('minkowski', (_args, children) => {
  const filtered = children.filter(c => c.type !== 'empty')
  if (filtered.length < 2) return { type: 'empty' }

  const node: IRMinkowski = {
    type: 'minkowski',
    children: filtered
  }
  return node
})

// ============= EXTRUSIONS =============

// linear_extrude(height, center, convexity, twist, slices, scale)
builtins.set('linear_extrude', (args, children, _scope) => {
  const height = getNumberArg(args, 'height', 0, 1)
  const center = getBoolArg(args, 'center', -1, false)
  const twist = getNumberArg(args, 'twist', -1, 0)
  const slices = getNumberArg(args, 'slices', -1, twist !== 0 ? Math.max(2, Math.abs(twist) / 5) : 1)
  const scaleArg = getArg(args, 'scale', -1, 1)

  let scale: number | number[]
  if (typeof scaleArg === 'number') {
    scale = scaleArg
  } else if (Array.isArray(scaleArg)) {
    scale = scaleArg.map(v => typeof v === 'number' ? v : 1)
  } else {
    scale = 1
  }

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  return {
    type: 'extrusion',
    operation: 'linear_extrude',
    params: { height, center, twist, slices, scale },
    children: [child]
  } as any
})

// rotate_extrude(angle, convexity)
builtins.set('rotate_extrude', (args, children, scope) => {
  const angle = getNumberArg(args, 'angle', 0, 360)
  const segments = getNumberArg(args, '$fn', -1, getSegments(scope))

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  return {
    type: 'extrusion',
    operation: 'rotate_extrude',
    params: { angle, segments },
    children: [child]
  } as any
})

// ============= SPECIAL =============

// color([r, g, b]) or color([r, g, b, a]) or color("name")
builtins.set('color', (args, children) => {
  const c = getArg(args, 'c', 0, [1, 1, 1, 1])

  let color: [number, number, number, number]
  if (Array.isArray(c)) {
    const arr = c.map(v => typeof v === 'number' ? v : 1)
    color = [arr[0] ?? 1, arr[1] ?? 1, arr[2] ?? 1, arr[3] ?? 1]
  } else if (typeof c === 'string') {
    // Named colors - basic support
    color = namedColor(c)
  } else {
    color = [1, 1, 1, 1]
  }

  const child = wrapChildren(children)
  if (child.type === 'empty') return child

  return {
    type: 'color',
    color,
    children: [child]
  }
})

function namedColor(name: string): [number, number, number, number] {
  const colors: Record<string, [number, number, number, number]> = {
    red: [1, 0, 0, 1],
    green: [0, 1, 0, 1],
    blue: [0, 0, 1, 1],
    yellow: [1, 1, 0, 1],
    cyan: [0, 1, 1, 1],
    magenta: [1, 0, 1, 1],
    white: [1, 1, 1, 1],
    black: [0, 0, 0, 1],
    gray: [0.5, 0.5, 0.5, 1],
    grey: [0.5, 0.5, 0.5, 1],
    orange: [1, 0.5, 0, 1],
    purple: [0.5, 0, 0.5, 1],
  }
  return colors[name.toLowerCase()] ?? [1, 1, 1, 1]
}

// echo() - just passes through children
builtins.set('echo', (_args, children) => {
  return wrapChildren(children)
})

// render() - just passes through children
builtins.set('render', (_args, children) => {
  return wrapChildren(children)
})

// group() - just passes through children
builtins.set('group', (_args, children) => {
  return wrapChildren(children)
})

// assert() - debugging, just passes through children
builtins.set('assert', (_args, children) => {
  return wrapChildren(children)
})
