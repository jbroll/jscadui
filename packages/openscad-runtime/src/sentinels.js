/**
 * Sentinel for "no child produced by a conditional branch".
 * `if(cond) child` with cond=false and no else branch emits j$.NO_CHILD.
 * Distinct from undefined (which means "module/geometry produced nothing").
 * In intersection: NO_CHILD is absent (skipped); undefined makes intersection empty.
 */
export const NO_CHILD = Symbol('no_child')
