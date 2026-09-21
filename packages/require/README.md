# require

## Cycles

A module's `exports` object is cached before the module runs, so a require that
comes back around gets the partial exports and fills in as the first module
finishes — CommonJS semantics. The OpenSCAD transpiler depends on this: two
`.scad` files that `use` each other become modules that require each other at
the top level and read the namespace lazily.


## import.meta.url

- [swc impl](https://github.com/swc-project/swc/pull/4670) - explore, seems nodejs specific `require("url").pathToFileURL(__filename).toString()`


## import.meta.resolve

MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta/resolve
