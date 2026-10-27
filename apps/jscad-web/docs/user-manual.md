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

## API help

"API Help…" in the menu opens a panel that looks up a name the same way the
chat's `docs` tool does. Type a function, class or namespace name — `cube`,
`jf.polygon`, `FluentGeom2.extrudeLinear`, `primitives` — and it answers with
the entry's signature, options and example. It answers in the API style
chosen in the chat's settings: fluent (`@jbroll/jscad-fluent`) or modeling
(`@jscad/modeling`). It needs no account or chat turn. Escape or the × closes
the panel.

## Parts browser

"Browse Parts…" in the menu opens a panel of catalog hardware — nuts, screws,
washers, bearings, stepper motors — pulled from NopSCADlib and BOSL2. Each
card is a part family; its entries are different library implementations of
that part, preferred one first, each tagged with its license. Escape closes
the panel; with the demo browser or API help open too, it closes the panel
holding focus, or the one opened last.

Opening an entry shows its call signature, a size picker, any options with
what they do, measured dimensions where available, the license and an
example call. **Insert** writes the part into the open file at the cursor, for the size
chosen in the picker: a `.js` file gets a `require(...)` for the part's module
(adding missing names to an existing `require` of the same file rather than
duplicating it), plus a call such as `nut(M3_nut)`; a `.scad` file gets
`include <...>` lines for the library files it needs, plus `nut(M3_nut);`. A
part whose call needs more than a size gets fixed values after it, such as
the 10 mm length in `screw(M3_cap_screw, 10)`; change them by hand. The
call lands on the current line if it's blank, or on its own new line
otherwise. It never adds options — the example field shows how to pass them
by hand.

A `require` from Insert often names `_catalog/...`, as in
`require('_catalog/NopSCADlib/vitamins/nut.scad')`. That is a small file the
app build generates under `/libs/_catalog/` for a part whose module and size
list live in separate library files: it `include`s both, so one `require`
gets the module and its sizes. A `.scad` file gets the two `include` lines
instead.

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

## Images in the chat

Paste an image into the chat input, drop one on the chat panel, or pick files
with the paperclip button. Each shows as a thumbnail above the input; its ×
removes it. The images go with the next message, which may be images alone.

- Up to 4 images per message.
- Only a model that reads images can take them. With any other model the
  paperclip is disabled, and a paste or drop says the model does not read
  images. When a provider does not say which models read images, tick
  `Model reads images` in Chat settings.
- Images are scaled down to 1568 px on the long side and re-encoded (JPEG,
  or PNG for a small PNG) before they are sent.
- A message too large for the relay's 1 MB limit fails with an error and
  puts its images back above the input; send fewer.
- The model sees a message's images for that turn and the next two. After
  that, or once a newer message carries images, it gets only a note that an
  image was there.
- Your messages show their images as thumbnails; click one for full size.
- A conversation keeps the images of its newest 4 image messages; older
  ones show as an `image` marker.

## Undoing the assistant's changes

A turn that wrote files to a saved project gets an `Undo this turn's
changes` button under its reply. It restores the project to how it was
before the turn and adds a `restore` entry to the version history.

- Only the newest such turn can be undone; once a later turn writes, the
  earlier buttons are disabled.
- The button is disabled while a turn runs.
- If the editor has unsaved edits, you are asked once before they are
  discarded. Declining leaves the button in place.
- A used button reads `Undone`, also after a reload.
- Projects stored only on disk have no version history and get no button.
