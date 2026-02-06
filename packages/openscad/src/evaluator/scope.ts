/**
 * Scope management for variable and module resolution
 */

import type { IRValue, IRModuleDef, IRFunctionDef } from '../ir/types.js'

export interface Scope {
  parent: Scope | null
  variables: Map<string, IRValue>
  modules: Map<string, IRModuleDef>
  functions: Map<string, IRFunctionDef>
  specialVariables: Map<string, IRValue>
}

// Default special variable values
const defaultSpecialVars: [string, IRValue][] = [
  ['$fn', 32],
  ['$fa', 12],
  ['$fs', 2],
  ['$t', 0],
  ['$preview', true],
]

/**
 * Create a new root scope with default special variables
 */
export function createRootScope(): Scope {
  const scope: Scope = {
    parent: null,
    variables: new Map(),
    modules: new Map(),
    functions: new Map(),
    specialVariables: new Map(defaultSpecialVars),
  }
  return scope
}

/**
 * Create a child scope
 */
export function createChildScope(parent: Scope): Scope {
  return {
    parent,
    variables: new Map(),
    modules: new Map(),
    functions: new Map(),
    specialVariables: new Map(),
  }
}

/**
 * Look up a variable in scope chain
 */
export function lookupVariable(scope: Scope, name: string): IRValue | undefined {
  // Check special variables first (they start with $)
  if (name.startsWith('$')) {
    let current: Scope | null = scope
    while (current) {
      if (current.specialVariables.has(name)) {
        return current.specialVariables.get(name)
      }
      current = current.parent
    }
    return undefined
  }

  // Regular variables
  let current: Scope | null = scope
  while (current) {
    if (current.variables.has(name)) {
      return current.variables.get(name)
    }
    current = current.parent
  }
  return undefined
}

/**
 * Set a variable in the current scope
 */
export function setVariable(scope: Scope, name: string, value: IRValue): void {
  if (name.startsWith('$')) {
    scope.specialVariables.set(name, value)
  } else {
    scope.variables.set(name, value)
  }
}

/**
 * Look up a module in scope chain
 */
export function lookupModule(scope: Scope, name: string): IRModuleDef | undefined {
  let current: Scope | null = scope
  while (current) {
    if (current.modules.has(name)) {
      return current.modules.get(name)
    }
    current = current.parent
  }
  return undefined
}

/**
 * Define a module in the current scope
 */
export function defineModule(scope: Scope, name: string, def: IRModuleDef): void {
  scope.modules.set(name, def)
}

/**
 * Look up a function in scope chain
 */
export function lookupFunction(scope: Scope, name: string): IRFunctionDef | undefined {
  let current: Scope | null = scope
  while (current) {
    if (current.functions.has(name)) {
      return current.functions.get(name)
    }
    current = current.parent
  }
  return undefined
}

/**
 * Define a function in the current scope
 */
export function defineFunction(scope: Scope, name: string, def: IRFunctionDef): void {
  scope.functions.set(name, def)
}

/**
 * Get $fn value for current scope (used for curve resolution)
 * This is the simple version that returns the default when $fn is not set.
 */
export function getSegments(scope: Scope): number {
  const fn = lookupVariable(scope, '$fn')
  if (typeof fn === 'number' && fn > 0) {
    return Math.max(fn, 3)
  }
  // Default when $fn not specified - use 32 as fallback
  // (for cases where radius isn't known)
  return 32
}

/**
 * Calculate segments for a circle/sphere/cylinder based on OpenSCAD's formula.
 *
 * OpenSCAD uses: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
 * where $fa=12 (min angle) and $fs=2 (min segment size) are defaults.
 *
 * See: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Other_Language_Features
 */
export function getSegmentsForRadius(scope: Scope, radius: number): number {
  // If $fn is explicitly set, use it (minimum 3)
  const fn = lookupVariable(scope, '$fn')
  if (typeof fn === 'number' && fn > 0) {
    return Math.max(Math.round(fn), 3)
  }

  // Get $fa and $fs with OpenSCAD defaults
  const faVal = lookupVariable(scope, '$fa')
  const fsVal = lookupVariable(scope, '$fs')
  const fa = typeof faVal === 'number' && faVal > 0 ? faVal : 12  // default 12 degrees
  const fs = typeof fsVal === 'number' && fsVal > 0 ? fsVal : 2   // default 2mm

  // Very small radius - minimum 3 segments
  if (radius < 0.001) {
    return 3
  }

  // OpenSCAD formula: ceil(max(min(360/fa, 2*PI*r/fs), 5))
  const segmentsFromAngle = 360 / fa                    // max segments from angle
  const segmentsFromSize = (2 * Math.PI * radius) / fs  // segments from size
  const computed = Math.min(segmentsFromAngle, segmentsFromSize)

  return Math.ceil(Math.max(computed, 5))  // minimum 5 segments
}
