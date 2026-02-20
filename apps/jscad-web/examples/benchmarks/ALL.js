"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../lib/grid-utils.js')

const items = [
  "./01-menger.example.js",
  "./02-menger-intersect.example.js",
  "./03-swiss-cheese.example.js",
  "./04-thin-wall.example.js",
  "./05-sphere-cloud.example.js",
  "./06-sphere-union.example.js",
  "./07-chainmail.example.js",
  "./08-hull.example.js",
  "./09-hull-chain.example.js",
  "./10-mounting-plate.example.js",
  "./11-expand.example.js",
  "./12-vase.example.js",
  "./13-minkowski.example.js",
  "./14-minkowski-frame.example.js"
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
        all.push(...normalizeAndPlace(geoms, x, y, cellSize))
      }
    } catch (err) {
      console.error('ALL: failed to load', url, err.message)
      throw new Error(`Failed to load ${url}: ${err.message}`)
    }
  })
  return all
}

module.exports = { main }
