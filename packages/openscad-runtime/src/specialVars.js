/**
 * Stack-based special variables for OpenSCAD dynamic scoping
 *
 * OpenSCAD special variables ($fn, $fa, $fs, etc.) use dynamic scoping:
 * - When a module sets $fn=32, all children inherit that value
 * - When the module returns, the parent's value is restored
 * - Direct assignments within a module affect all subsequent code in that scope
 *
 * Implementation:
 * - Stack of scope frames, each containing special var overrides
 * - pushScope() creates a new frame (inheriting parent values)
 * - popScope() removes the top frame (restores parent values)
 * - set$fn(val) updates the current frame
 * - $fn() reads from the top frame (or returns undefined)
 */

// OpenSCAD default values for resolution variables
const DEFAULT_SPECIAL_VARS = {
  '$fn': 0,   // 0 means use $fa/$fs
  '$fa': 12,  // degrees
  '$fs': 2    // mm
}

// The scope stack - each entry is an object with special var values
// Values are only stored if explicitly set (sparse storage)
const scopeStack = [{ ...DEFAULT_SPECIAL_VARS }]

/**
 * Push a new scope frame. Called at module entry.
 * @param {Object} initialVars - Optional initial values for this scope (from module call args)
 */
export function pushScope(initialVars = {}) {
  scopeStack.push({ ...initialVars })
}

/**
 * Pop the current scope frame. Called at module exit.
 */
export function popScope() {
  if (scopeStack.length > 1) {
    scopeStack.pop()
  }
}

/**
 * Get a special variable value, searching up the stack
 * @param {string} name - Variable name (e.g., '$fn')
 * @returns {*} The value, or undefined if not set
 */
function getVar(name) {
  // Search from top of stack down
  for (let i = scopeStack.length - 1; i >= 0; i--) {
    if (name in scopeStack[i]) {
      return scopeStack[i][name]
    }
  }
  return undefined
}

/**
 * Set a special variable in the current scope
 * @param {string} name - Variable name (e.g., '$fn')
 * @param {*} value - The value to set
 */
function setVar(name, value) {
  if (scopeStack.length > 0) {
    scopeStack[scopeStack.length - 1][name] = value
  }
}

// Resolution special vars - these affect geometry segment counts
export const $fn = () => getVar('$fn')
export const $fa = () => getVar('$fa')
export const $fs = () => getVar('$fs')

export const set$fn = (val) => setVar('$fn', val)
export const set$fa = (val) => setVar('$fa', val)
export const set$fs = (val) => setVar('$fs', val)

// Animation/preview special vars
export const $t = () => getVar('$t')
export const $preview = () => getVar('$preview')

export const set$t = (val) => setVar('$t', val)
export const set$preview = (val) => setVar('$preview', val)

// Viewport special vars
export const $vpr = () => getVar('$vpr')
export const $vpt = () => getVar('$vpt')
export const $vpd = () => getVar('$vpd')
export const $vpf = () => getVar('$vpf')

export const set$vpr = (val) => setVar('$vpr', val)
export const set$vpt = (val) => setVar('$vpt', val)
export const set$vpd = (val) => setVar('$vpd', val)
export const set$vpf = (val) => setVar('$vpf', val)

// BOSL2 attachment system special vars
export const $parent_anchor = () => getVar('$parent_anchor')
export const $parent_spin = () => getVar('$parent_spin')
export const $parent_orient = () => getVar('$parent_orient')
export const $parent_geom = () => getVar('$parent_geom')
export const $parent_size = () => getVar('$parent_size')
export const $transform = () => getVar('$transform')
export const $attach_to = () => getVar('$attach_to')
export const $attach_anchor = () => getVar('$attach_anchor')
export const $anchor = () => getVar('$anchor')
export const $anchor_inside = () => getVar('$anchor_inside')

export const set$parent_anchor = (val) => setVar('$parent_anchor', val)
export const set$parent_spin = (val) => setVar('$parent_spin', val)
export const set$parent_orient = (val) => setVar('$parent_orient', val)
export const set$parent_geom = (val) => setVar('$parent_geom', val)
export const set$parent_size = (val) => setVar('$parent_size', val)
export const set$transform = (val) => setVar('$transform', val)
export const set$attach_to = (val) => setVar('$attach_to', val)
export const set$attach_anchor = (val) => setVar('$attach_anchor', val)
export const set$anchor = (val) => setVar('$anchor', val)
export const set$anchor_inside = (val) => setVar('$anchor_inside', val)

// Generic getter/setter for any special var (used by transpiled code)
export const getSpecialVar = getVar
export const setSpecialVar = setVar

/**
 * Reset the scope stack (for testing or between runs)
 */
export function resetScope() {
  scopeStack.length = 1
  scopeStack[0] = { ...DEFAULT_SPECIAL_VARS }
}
