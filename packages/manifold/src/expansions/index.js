/**
 * Expansions module - expand and offset operations.
 *
 * This module provides the same interface as @jscad/modeling-for-manifold/expansions
 * by re-exporting from modifiers.
 */

// Re-export expand and offset from modifiers
export { expand, offset } from '../modifiers/index.js'

import { expand, offset } from '../modifiers/index.js'

export default {
  expand,
  offset
}
