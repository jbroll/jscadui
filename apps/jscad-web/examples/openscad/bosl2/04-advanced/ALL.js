"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const jscad = require('@jscad/modeling')
const { translate } = jscad.transforms
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../../../lib/grid-utils.js')

const items = [
  "./arc-3d.scad",
  "./attach.scad",
  "./bezier-curve.scad",
  "./bezier-sweep.scad",
  "./chamfer-corner-mask.scad",
  "./chamfer-edge-mask.scad",
  "./dashed-stroke.scad",
  "./diff.scad",
  "./intersect.scad",
  "./linear-sweep.scad",
  "./mask2d-chamfer.scad",
  "./mask2d-roundover.scad",
  "./offset-stroke.scad",
  "./offset-sweep.scad",
  "./path-sweep.scad",
  "./position.scad",
  "./rotate-sweep.scad",
  "./rounded-prism.scad",
  "./rounding-corner-mask.scad",
  "./rounding-edge-mask.scad",
  "./skin.scad",
  "./spiral-sweep.scad",
  "./stroke.scad",
  "./vnf-polyhedron.scad",
  "./vnf-vertex-array.scad"
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
