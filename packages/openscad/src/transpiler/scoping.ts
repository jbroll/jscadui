/**
 * Scoping utilities for let bindings, for loops, and local variable tracking
 */
import type { TranspileContext } from './context.js'
import { pushScope, popScope } from './context.js'

/**
 * Generate a unique scope suffix for let bindings and C-style for loops.
 * Increments the counter for the next call.
 *
 * @param ctx - The transpile context
 * @returns A suffix like "$1", "$2", etc.
 */
export function generateScopeSuffix(ctx: TranspileContext): string {
  return ctx.scopes.generateSuffix()
}

/**
 * Execute a function with a scope, automatically handling push/pop.
 * This is a try/finally pattern to ensure scope cleanup even if an error occurs.
 *
 * @param ctx - The transpile context
 * @param scope - The scope Map to push
 * @param fn - Function to execute with the scope active
 * @returns The result of the function
 */
export function withScope<T>(
  ctx: TranspileContext,
  scope: Map<string, string>,
  fn: () => T
): T {
  pushScope(ctx, scope)
  try {
    return fn()
  } finally {
    popScope(ctx)
  }
}

/**
 * Track function bindings during scope execution and clean up afterwards.
 * This enables proper handling of let-bound functions that need to be called
 * without the _$f suffix.
 *
 * @param ctx - The transpile context
 * @param functionNames - Array of [originalName, suffixedName] pairs to track
 * @param fn - Function to execute with bindings tracked
 * @returns The result of the function
 */
export function withFunctionBindings<T>(
  ctx: TranspileContext,
  functionNames: Array<[string, string]>,
  fn: () => T
): T {
  // Register all function bindings
  for (const [origName, suffixedName] of functionNames) {
    ctx.scopes.registerFunctionBinding(origName, suffixedName)
  }

  try {
    return fn()
  } finally {
    // Clean up all function bindings
    for (const [origName] of functionNames) {
      ctx.scopes.unregisterFunctionBinding(origName)
    }
  }
}

/**
 * Combined scope and function binding tracking.
 * Handles the common pattern of let bindings with potential function values.
 *
 * @param ctx - The transpile context
 * @param scope - The scope Map to push
 * @param functionNames - Array of [originalName, suffixedName] pairs to track
 * @param fn - Function to execute with scope and bindings active
 * @returns The result of the function
 */
export function withScopeAndBindings<T>(
  ctx: TranspileContext,
  scope: Map<string, string>,
  functionNames: Array<[string, string]>,
  fn: () => T
): T {
  return withScope(ctx, scope, () =>
    withFunctionBindings(ctx, functionNames, fn)
  )
}
