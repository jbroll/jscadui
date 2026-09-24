import { describe, it, expect } from 'vitest'
import { gridItems, splitAggregateGrids } from '../e2e/grid-order.mjs'

const grid = (items) => `"use strict"\nconst items = ${JSON.stringify(items, null, 2)}\nconst spacing = 60\n`

describe('gridItems', () => {
  it('reads the items array of a generated ALL.js', () => {
    expect(gridItems(grid(['./a.scad', './sub/ALL.js']))).toEqual(['./a.scad', './sub/ALL.js'])
  })

  it('returns null for a file that is not a generated grid', () => {
    expect(gridItems('module.exports = {}')).toBeNull()
  })
})

describe('splitAggregateGrids', () => {
  const sources = {
    'ALL.js': grid(['./jscad/ALL.js', './openscad/ALL.js']),
    'openscad/text/ALL.js': grid(['./text-fonts.scad']),
    'openscad/mixed/ALL.js': grid(['./one.scad', './sub/ALL.js']),
    'openscad/bosl/ALL.js': grid(['./01-part1/ALL.js', './02-part2/ALL.js']),
  }
  const files = Object.keys(sources).map(rel => ({ rel, url: `/examples/${rel}` }))
  const { grids, aggregates } = splitAggregateGrids(files, rel => sources[rel])

  it('holds back a grid whose every item is another grid', () => {
    expect(aggregates.map(f => f.rel)).toEqual(['ALL.js', 'openscad/bosl/ALL.js'])
  })

  it('keeps a grid with any model of its own in the pool', () => {
    expect(grids.map(f => f.rel)).toEqual(['openscad/text/ALL.js', 'openscad/mixed/ALL.js'])
  })
})
