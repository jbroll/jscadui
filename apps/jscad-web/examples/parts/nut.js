// nuts.scad only `use`s nut.scad (not `include`), so its clean export does
// not re-export `nut` (see "Clean exports" in packages/openscad/ARCHITECTURE.md);
// require it from nut.scad directly.
const { nut } = require('NopSCADlib/vitamins/nut.scad')
const { M3_nut } = require('NopSCADlib/vitamins/nuts.scad')

const main = () => nut(M3_nut, { nyloc: true })

module.exports = { main }
