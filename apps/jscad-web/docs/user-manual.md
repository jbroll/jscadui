# User manual

## Using OpenSCAD libraries

NopSCADlib and BOSL2 are deployed unpatched under `/libs/` and reachable from
any project file, `.scad` or `.js`.

### From a `.scad` file

```scad
include <NopSCADlib/vitamins/nuts.scad>
nut(M3_nut, nyloc = true);
```

`include <...>` and `use <...>` both resolve a bare `<Library>/...` path
against `/libs/<Library>/...` once the file's own directory and its library
root (`/examples/openscad/<library>`, for a bundled example) don't have it.
`include` brings in everything the included file declares, including whatever
it in turn `use`s or `include`s; `use` brings in only that file's own modules
and functions, not its variables, and (for a JS caller, see below) does not
re-export them further.

### From a `.js` file

```js
const { nut } = require('NopSCADlib/vitamins/nut.scad')
const { M3_nut } = require('NopSCADlib/vitamins/nuts.scad')

const main = () => nut(M3_nut, { nyloc: true })

module.exports = { main }
```

A bare `require('<Library>/...')` resolves the same way as a `.scad`
`include`/`use`, against `/libs/<Library>/...`.

A transpiled `.scad` file re-exports the names declared in a file it
`include`s, but not one it only `use`s. NopSCADlib's `nuts.scad` `use`s
`nut.scad` for the `nut` module (so SCAD code that `include`s `nuts.scad` can
still call `nut(...)` directly), but a JS `require('NopSCADlib/vitamins/nuts.scad')`
only gets what `nuts.scad` itself declares — `M3_nut` and the rest of its own
constants, not `nut`. Require `nut.scad` directly for `nut`, as above. When in
doubt, open the library file: what it `include`s, a `require` of it gets too;
what it only `use`s, it doesn't.

## Parts browser

"Browse Parts…" in the menu opens a panel of catalog hardware — nuts, screws,
washers, bearings, stepper mounts — pulled from NopSCADlib and BOSL2. Each
card is a part family; its entries are different library implementations of
that part, preferred one first, each tagged with its license.

Opening an entry shows its call signature, a size picker, any options with
what they do, measured dimensions where available, the license and an
example call. **Insert** writes the part into the open file at the cursor, for the size
chosen in the picker: a `.js` file gets a `require(...)` for the part's module
(adding missing names to an existing `require` of the same file rather than
duplicating it), plus a call such as `nut(M3_nut)`; a `.scad` file gets
`include <...>` lines for the library files it needs, plus `nut(M3_nut);`. The
call lands on the current line if it's blank, or on its own new line
otherwise. It never adds options — the example field shows how to pass them
by hand.

### Calling a transpiled module or function

A transpiled `.scad` file exposes a clean JS surface:

- A module `washer(type, h)` becomes a plain function `washer(...args)`.
  Positional arguments map to parameter names in declaration order. A
  trailing plain object holds named arguments — `nut(M3_nut, { nyloc: true })`
  — including any `$`-prefixed special variable, and its `children` key
  (one value or an array) passes geometry, the same as child statements would
  in `.scad`. It returns the module's geometry.
- A function `area(w, h)` becomes `area(w, h)`, or `area(w, { h })` with a
  trailing named object; `$` keys there set special variables for the call.
- A variable is its value. One that reads a `$` special variable is a getter,
  evaluated against the caller's current scope, so it sees your own `$fn` or
  similar.
- `exports.fn` and `exports.vars` hold every function and variable the file
  declares, regardless of a bare-name clash with a module. `exports.$meta` has
  one entry per module, function and variable: `{ name, kind, params?, lazy? }`.
- Reserved, never bound as a bare name: `main`, `getParameterDefinitions`,
  `fn`, `vars`, `$meta`, `$scad`.
- `exports.$scad` holds the raw transpiled names (`washer_$m`, `area_$f`,
  `area_$f$obj`, variables as values or `$`-reading thunks). Generated files
  call each other through it; JS callers want the names above.
