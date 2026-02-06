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
 */
export function getSegments(scope: Scope): number {
  const fn = lookupVariable(scope, '$fn')
  if (typeof fn === 'number' && fn > 0) {
    return fn
  }
  return 32 // default
}
