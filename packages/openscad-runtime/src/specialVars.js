/**
 * Default values for the root scope frame.
 * Exported so index.js can use them when initialising _scopeStack.
 */
export const DEFAULT_SPECIAL_VARS = {
  '$fn': 0,   // 0 means use $fa/$fs
  '$fa': 12,  // degrees
  '$fs': 2,   // mm
  '$preview': false,  // F5 preview vs F6 render; the app sets it per run
  '$manifold': true,  // signal NopSCADlib to use manifold-safe values (e.g. big=1e3 not inf)
}
