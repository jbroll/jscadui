// The fluent bundle the worker loads through the '@jbroll/jscad-fluent'
// alias. Shared deps stay external so the worker's bundle aliases provide
// the single shared copies: @jscad/modeling (modeling bundle) and
// @jbroll/jscad-anchors (CDN build, engine-aware via
// @jscad/modeling-for-anchors). Keeps the bundle thin and lazily loaded.
//
// Fluent's ESM dist exposes only a default export, so a bare
// `export *` would re-export nothing; assign module.exports to preserve the
// `jf.cube(...)` namespace consumers expect from require().
import jf from '@jbroll/jscad-fluent'
module.exports = jf
