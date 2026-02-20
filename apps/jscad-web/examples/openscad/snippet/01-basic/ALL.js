"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../../../lib/grid-utils.js')

const items = [
  "./Abacus.scad",
  "./Angle Shelf.scad",
  "./Arc_01.scad",
  "./Arc_02.scad",
  "./Arrow_01.scad",
  "./Banner_01.scad",
  "./Base_cabinet_01.scad",
  "./Base_cabinet_02.scad",
  "./Beam_Angular.scad",
  "./Beam_C.scad",
  "./Beam_H.scad",
  "./Beam_T.scad",
  "./Bed_01.scad",
  "./Bed_02.scad",
  "./Bench_01.scad",
  "./Bench_02.scad",
  "./Bookshelf_01.scad",
  "./Bookshelf_02.scad",
  "./Box_Wood_01.scad",
  "./Bricks.scad",
  "./Building_01.scad",
  "./Building_02.scad",
  "./Chair_01.scad",
  "./Chair_02.scad",
  "./Chair_03.scad",
  "./Chalkboard_01.scad",
  "./Chalkboard_02.scad",
  "./Circular_Blade.scad",
  "./Gear_02.scad",
  "./Mechanism_01.scad",
  "./Spawing_Cube.scad"
]
const spacing = 60
const cellSize = 51

const main = (params) => {
  const all = []
  const nameSeen = {}

  items.forEach((url, i) => {
    try {
      // Calculate grid position dynamically
      const [x, y] = gridPosition(i, items.length, spacing)

      // Derive unique part name from URL
      let name = urlToPartName(url)
      // Deduplicate: if the same name appears twice, append _2, _3, …
      if (nameSeen[name]) {
        nameSeen[name]++
        name = `${name}_${nameSeen[name]}`
      } else {
        nameSeen[name] = 1
      }

      // Give each sub-model its own params sub-object so inline param
      // definitions (params.foo = {type:'slider',...}) don't collide.
      params[name] = params[name] ?? {}
      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geoms = [].concat(fn(params[name]))
        // Nested ALL.js files are already laid out - just translate, don't rescale
        if (url.endsWith('/ALL.js')) {
          all.push(...geoms.map(g => translate([x, y, 0], g)))
        } else {
          all.push(...normalizeAndPlace(geoms, x, y, cellSize))
        }
      }
    } catch (err) {
      console.error('ALL: failed to load', url, err.message)
      throw new Error(`Failed to load ${url}: ${err.message}`)
    }
  })
  return all
}

module.exports = { main }
