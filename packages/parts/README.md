# @jscadui/parts

Vetted catalog of standard hardware (nuts, screws, washers, bearings,
steppers) drawn from the OpenSCAD libraries deployed under
`apps/jscad-web/libs/` (NopSCADlib, BOSL2). Each entry names a library call
and the standard dimensions it must build to; the parts browser and the chat
agent offer only admitted catalog entries, never raw library requires, so
every part a model uses has been checked against its real-world size.

For whoever adds or admits catalog entries. The app build and the agent's
docs read what this package generates.

## Example

`catalog/nopscadlib/nut.json` names NopSCADlib's `nut` module, its `nuts`
size list, and the M3 nut's bounding box from ISO 4032. Checking it
transpiles the module from `/libs/`, measures the M3 nut against that box, and
builds every size in `nuts` once:

```sh
$ node bin/check.js nopscadlib/nut
PASS nopscadlib/nut
```

A `/libs/` library changes only when its pin moves in
`scripts/deps/manifest.json`. Run `sci push jscadui/parts` before committing
a pin move: the `ci/parts` job checks the whole catalog on the CI host, so a
library bump that breaks a standard dimension shows there first.

Part of the monorepo: `npm run setup` at the root installs it.

## Docs

- [User manual](docs/user-manual.md): record format, commands, admission.
- [Monorepo architecture](../../docs/architecture.md#parts-catalog): how the
  catalog reaches the app and the agent.
