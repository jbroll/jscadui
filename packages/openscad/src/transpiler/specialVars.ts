/**
 * Special variables that use stack-based dynamic scoping
 *
 * In OpenSCAD, ALL $-prefixed variables use dynamic scoping - they're inherited
 * from parent to child automatically. This set contains the known special variables
 * used by OpenSCAD core and BOSL2.
 *
 * User-defined $-prefixed PARAMETERS (like $fn2 in `module foo($fn2=10)`) are
 * handled as local variables since they're explicitly declared as parameters.
 */

export const stackSpecialVars = new Set([
  // Core OpenSCAD special vars
  '$fn', '$fa', '$fs',
  '$t', '$preview',
  // Viewport variables
  '$vpr', '$vpt', '$vpd', '$vpf',

  // BOSL2 attachment system variables
  '$transform', '$parent_anchor', '$parent_spin', '$parent_orient',
  '$parent_geom', '$parent_size', '$parent_parts', '$attach_to',
  '$attach_anchor', '$attach_alignment', '$attach_inside', '$anchor_inside',
  '$tags', '$tag', '$save_tag', '$tag_prefix', '$overlap',
  '$color', '$save_color', '$anchor_override', '$anchor',
  '$edge_angle', '$edge_end', '$edge_length', '$tags_shown', '$tags_hidden',
  '$ghost_this', '$ghost', '$ghosting', '$highlight_this', '$highlight',

  // BOSL2 module-specific variables (dynamically scoped for children)
  '$slop',
  '$cubetruss_bracing', '$cubetruss_clip_thickness', '$cubetruss_size', '$cubetruss_strut_size',
  '$gear_steps',
  '$parent_gear_dir', '$parent_gear_helical', '$parent_gear_pa', '$parent_gear_pitch',
  '$parent_gear_teeth', '$parent_gear_thickness', '$parent_gear_travel', '$parent_gear_type',
  '$metaball_pathlist', '$metaball_vnf',
  '$sweep_closed', '$sweep_path', '$sweep_scales', '$sweep_shape', '$sweep_transforms', '$sweep_twist',
  '$screw_spec',
  '$profile_type',

  // BOSL2 iteration/distributor variables (passed to children via dynamic scoping)
  '$idx', '$pos', '$col', '$row', '$item', '$count', '$is_last',
  '$i', '$n', '$k', '$f', '$c', '$d', '$r', '$v', '$x',
  '$ang', '$axis', '$center', '$desc', '$dir', '$face', '$faceindex',
  '$next', '$normal', '$orig', '$phi', '$prev', '$primary', '$rad', '$theta', '$thing',
  '$align', '$align_msg'
])

/**
 * Check if a variable name is a known stack-based special variable
 */
export function isStackSpecialVar(name: string): boolean {
  return stackSpecialVars.has(name)
}
