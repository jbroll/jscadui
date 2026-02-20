"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const { gridPosition, normalizeAndPlace, urlToPartName } = require('../lib/grid-utils.js')

const items = [
  "./menger.example.js",
  "./menger-intersect.example.js",
  "./swiss-cheese.example.js",
  "./thin-wall.example.js",
  "./sphere-cloud.example.js",
  "./sphere-union.example.js",
  "./chainmail.example.js",
  "./hull.example.js",
  "./hull-chain.example.js",
  "./mounting-plate.example.js",
  "./expand.example.js",
  "./vase.example.js",
  "./minkowski.example.js",
  "./minkowski-frame.example.js"
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
