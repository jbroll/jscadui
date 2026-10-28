import { describe, expect, it } from 'vitest'
import { SKILLS } from '../prompt/index.js'

describe('starter skills', () => {
  it('exposes starter skills under 250 words each', () => {
    for (const id of ['brainstorming', 'writing-plans', 'executing-plans', 'systematic-debugging', 'model-spec', 'fit-clearance', 'printability-design', 'box-lid', 'snap-fit', 'boss-insert-thread', 'gears-meshing', 'pip-hinge']) {
      expect(SKILLS[id].split(/\s+/).length).toBeLessThan(250)
    }
  })
})
