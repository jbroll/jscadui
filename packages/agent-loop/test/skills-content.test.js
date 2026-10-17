import { describe, expect, it } from 'vitest'
import { SKILLS } from '../prompt/index.js'

describe('starter skills', () => {
  it('exposes four skills under 250 words each', () => {
    for (const id of ['brainstorming', 'writing-plans', 'executing-plans', 'systematic-debugging']) {
      expect(SKILLS[id].split(/\s+/).length).toBeLessThan(250)
    }
  })
})
