"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const { gridPosition, normalizeAndPlace, urlToPartName } = require('/examples/lib/grid-utils.js')

const items = [
  "./01-two-cars.example.js",
  "./02-hierarchical-car.example.js",
  "./03-jscad.example.js",
  "./04-primitives.example.js",
  "./05-extrusions.example.js",
  "./06-hulls.example.js",
  "./07-gear.example.js",
  "./08-nuts-and-bolts.example.js",
  "./09-text.example.js",
  "./10-slicer.example.js",
  "./11-balloons.example.js",
  "./12-parameters.example.js",
  "./13-multipart.example.js",
  "./benchmarks/ALL.js"
]
const spacing = 60
const cellSize = 51

const main = (params) => {
  const all = []
  const nameSeen = {}

  items.forEach((url, i) => {
    try {
      const [x, y] = gridPosition(i, items.length, spacing)
      let name = urlToPartName(url)
      if (nameSeen[name]) {
        nameSeen[name]++
        name = `${name}_${nameSeen[name]}`
      } else {
        nameSeen[name] = 1
      }
      const mod = require(url)
      const fn = mod.main || mod
      const geoms = [].concat(fn(params[name])).flat()
      all.push(...normalizeAndPlace(geoms, x, y, cellSize))
    } catch (err) {
      console.warn('ALL: failed to load', url, err.message)
    }
  })
  return all
}

module.exports = { main }
