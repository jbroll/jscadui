"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../../../lib/grid-utils.js')

const items = [
  "./Coin_01.scad",
  "./Coin_02.scad",
  "./Cone_01.scad",
  "./Crystal.scad",
  "./Cup_01.scad",
  "./Display_Seven_Segments.scad",
  "./Door_01.scad",
  "./Electric_Wire_Plug.scad",
  "./Eyebolt.scad",
  "./Fence_01.scad",
  "./Fence_02.scad",
  "./Fireplace_01.scad",
  "./Flag_France.scad",
  "./Flag_Italy.scad",
  "./Flange_01.scad",
  "./Flange_02.scad",
  "./Flange_03.scad",
  "./Floor_01.scad",
  "./Gear_01.scad",
  "./Gear_02.scad",
  "./Grid_01.scad",
  "./Hexagon_socket_screw_keys.scad",
  "./Hole_Plate.scad",
  "./Ingot_01.scad",
  "./Key.scad",
  "./Key_Old_01.scad",
  "./Key_Simple.scad",
  "./Ladder_01.scad",
  "./Ladder_02.scad",
  "./Lamp_01.scad",
  "./Led_01.scad"
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
