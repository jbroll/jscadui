# require

## Cycles

A module's `exports` object is cached before the module runs, so a require that
comes back around gets the partial exports and fills in as the first module
finishes — CommonJS semantics. The OpenSCAD transpiler depends on this: two
`.scad` files that `use` each other become modules that require each other at
the top level and read the namespace lazily.


## Wrapped modules for model code

`setUserModuleWrapper(fn)` registers `fn(name, exports)`, called when a
project file requires `@jscad/modeling`, `@jscad/modeling-for-anchors` or
`@jbroll/jscad-fluent`. A caller is a project file when its URL is under
`root` and is not a `.scad` file. It gets `fn`'s result, memoized per exports
object. The cache, library bundles that require modeling themselves,
transpiled OpenSCAD and base-less lookups get the real exports.
`setUserModuleWrapper(null)` turns it off. The compute frame registers the
unknown-option checks this way (`apps/jscad-web/src_frame/optionWarnings.js`).


## import.meta.url

- [swc impl](https://github.com/swc-project/swc/pull/4670) - explore, seems nodejs specific `require("url").pathToFileURL(__filename).toString()`


## import.meta.resolve

MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta/resolve
