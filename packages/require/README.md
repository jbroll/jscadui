# require

## Cycles

A module's `exports` object is cached before the module runs, so a require that
comes back around gets the partial exports and fills in as the first module
finishes — CommonJS semantics. The OpenSCAD transpiler depends on this: two
`.scad` files that `use` each other become modules that require each other at
the top level and read the namespace lazily.


## Library prefixes

`setLibraryPrefixes({ 'NopSCADlib/': 'https://app.example/libs/NopSCADlib/' })`
maps a bare specifier that starts with a prefix to that base URL, longest
prefix first, after exact and bundle aliases miss: `require('NopSCADlib/vitamins/nut.scad')`
loads `https://app.example/libs/NopSCADlib/vitamins/nut.scad`. The compute
frame sets it from the app's deployed library list
(`apps/jscad-web/src_frame/bundle.frame-worker.js`); the agent-loop eval
backend sets it from `apps/jscad-web/libs/` on disk. Like the bundle aliases,
the map is configuration: `clearTempCache` and `clearAllCaches` leave it in
place. Setting it clears the memoized resolutions made under the old map.

A module whose URL falls under a library base is cached apart from the
50-entry module LRU, in a cache with no size limit that `clearTempCache`
leaves alone; only `clearAllCaches` empties it. Library files change only on
a redeploy, so nothing goes stale between runs, and a NopSCADlib or BOSL2
`use` graph holds more files than the LRU does. Evicting a file still
mid-load would lose its partial exports, and the next require of it in the
cycle would throw a circular-dependency error.


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
