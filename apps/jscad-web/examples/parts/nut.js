// nuts.scad only `use`s nut.scad, so `nut` comes from nut.scad itself.
const { nut } = require('NopSCADlib/vitamins/nut.scad')
const { M3_nut } = require('NopSCADlib/vitamins/nuts.scad')

const main = () => nut(M3_nut, { nyloc: true })

module.exports = { main }
