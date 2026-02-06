/**
 * OpenSCAD to JSCAD Intermediate Representation (IR) Types
 *
 * The IR is a simplified geometry tree that can be directly translated to JSCAD code.
 * It represents the evaluated result of OpenSCAD AST, with all expressions resolved
 * and modules expanded.
 */

// Source location for error reporting
export interface SourceLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

// Base node interface
export interface IRNodeBase {
  loc?: SourceLocation
}

// Range value (e.g., [0:10] or [0:2:10])
export interface IRRange {
  type: 'range'
  start: number
  end: number
  step?: number
}

// All possible IR values
export type IRValue = number | boolean | string | IRValue[] | IRRange | undefined

// Primitive geometry node
export interface IRPrimitive extends IRNodeBase {
  type: 'primitive'
  primitive: 'cube' | 'sphere' | 'cylinder' | 'polyhedron' | 'square' | 'circle' | 'polygon'
  params: Record<string, IRValue>
}

// Transform node
export interface IRTransform extends IRNodeBase {
  type: 'transform'
  transform: 'translate' | 'rotate' | 'scale' | 'mirror' | 'multmatrix'
  params: Record<string, IRValue>
  children: IRNode[]
}

// Boolean operation node
export interface IRBoolean extends IRNodeBase {
  type: 'boolean'
  operation: 'union' | 'difference' | 'intersection'
  children: IRNode[]
}

// Hull operation node
export interface IRHull extends IRNodeBase {
  type: 'hull'
  children: IRNode[]
}

// Minkowski operation node
export interface IRMinkowski extends IRNodeBase {
  type: 'minkowski'
  children: IRNode[]
}

// Extrusion node (Phase 2)
export interface IRExtrusion extends IRNodeBase {
  type: 'extrusion'
  operation: 'linear_extrude' | 'rotate_extrude'
  params: Record<string, IRValue>
  children: IRNode[]
}

// Group node (implicit union of siblings)
export interface IRGroup extends IRNodeBase {
  type: 'group'
  children: IRNode[]
}

// Color modifier node
export interface IRColor extends IRNodeBase {
  type: 'color'
  color: [number, number, number, number] // RGBA 0-1
  children: IRNode[]
}

// Empty node (result of conditional with no geometry)
export interface IREmpty extends IRNodeBase {
  type: 'empty'
}

// Union type of all IR nodes
export type IRNode =
  | IRPrimitive
  | IRTransform
  | IRBoolean
  | IRHull
  | IRMinkowski
  | IRExtrusion
  | IRGroup
  | IRColor
  | IREmpty

// Parameter definition for modules/functions
export interface IRParamDef {
  name: string
  default?: IRValue
}

// Module definition (stored in scope, not emitted directly)
export interface IRModuleDef {
  name: string
  params: IRParamDef[]
  body: IRNode[]
  hasChildren: boolean // true if module uses children()
}

// Function definition (stored in scope)
export interface IRFunctionDef {
  name: string
  params: IRParamDef[]
  expr: unknown // Expression AST - evaluated on call
}

// Type guards for IR nodes
export function isPrimitive(node: IRNode): node is IRPrimitive {
  return node.type === 'primitive'
}

export function isTransform(node: IRNode): node is IRTransform {
  return node.type === 'transform'
}

export function isBoolean(node: IRNode): node is IRBoolean {
  return node.type === 'boolean'
}

export function isGroup(node: IRNode): node is IRGroup {
  return node.type === 'group'
}

export function isEmpty(node: IRNode): node is IREmpty {
  return node.type === 'empty'
}

export function isHull(node: IRNode): node is IRHull {
  return node.type === 'hull'
}

export function isMinkowski(node: IRNode): node is IRMinkowski {
  return node.type === 'minkowski'
}

// Helper to check if node produces geometry
export function hasGeometry(node: IRNode): boolean {
  if (isEmpty(node)) return false
  if (isGroup(node)) return node.children.some(hasGeometry)
  return true
}

// Helper to flatten nested groups
export function flattenGroups(node: IRNode): IRNode {
  if (!isGroup(node)) return node

  const flatChildren: IRNode[] = []
  for (const child of node.children) {
    const flattened = flattenGroups(child)
    if (isGroup(flattened)) {
      flatChildren.push(...flattened.children)
    } else if (!isEmpty(flattened)) {
      flatChildren.push(flattened)
    }
  }

  if (flatChildren.length === 0) {
    return { type: 'empty' }
  }
  if (flatChildren.length === 1) {
    return flatChildren[0]
  }
  return { type: 'group', children: flatChildren }
}
