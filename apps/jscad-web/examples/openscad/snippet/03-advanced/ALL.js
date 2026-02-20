"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../../../lib/grid-utils.js')

const items = [
  "./Letter_A.scad",
  "./Lever_Handle.scad",
  "./Mallet.scad",
  "./Mech_Piece_01.scad",
  "./Mech_Piece_02.scad",
  "./Mech_Piece_03.scad",
  "./Mech_Piece_04.scad",
  "./Notebook.scad",
  "./Nut_LQ.scad",
  "./Pendulum.scad",
  "./Pipe_00.scad",
  "./Pipe_45.scad",
  "./Pipe_90.scad",
  "./Resistor.scad",
  "./Ring.scad",
  "./Rod_01.scad",
  "./Roll_Holder.scad",
  "./Sauce_Bottle.scad",
  "./Screw.scad",
  "./Shaft_01.scad",
  "./Shaft_02_With_Keyway.scad",
  "./Sign_01.scad",
  "./Sign_02.scad",
  "./Sign_03.scad",
  "./Soda_Cup_01.scad",
  "./Sofa.scad",
  "./Stairs_01.scad",
  "./Stairs_02.scad",
  "./Stairs_03.scad",
  "./Street_01.scad",
  "./Street_02.scad"
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
