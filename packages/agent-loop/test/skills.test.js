import { describe, expect, it } from 'vitest'
import { lookupSkill, SKILL_BUDGET, skillIndex, skillTool } from '../src/skills.js'
describe('lookupSkill', () => {
  it('returns procedure text for known id and lists ids', () => {
    expect(lookupSkill({ 'plan-then-build': 'one file per part' }, 'plan-then-build')).toBe('one file per part')
  })

  it('answers a miss with toolError JSON listing the ids', () => {
    const res = JSON.parse(lookupSkill({ 'plan-then-build': 'one file per part' }, 'nope'))
    expect(res).toEqual({ ok: false, error: { name: 'NotFoundError', message: 'no skill nope; available: plan-then-build' } })
  })

  it('caps a body at SKILL_BUDGET', () => {
    expect(SKILL_BUDGET).toBe(2000)
    const text = lookupSkill({ big: 'x'.repeat(SKILL_BUDGET + 100) }, 'big')
    expect(text.length).toBeLessThanOrEqual(SKILL_BUDGET)
    expect(text.endsWith('\n[truncated: skill body exceeds budget]')).toBe(true)
  })

  it('serves the skill tool from a name or its args', () => {
    const index = { 'plan-then-build': 'one file per part' }
    expect(skillTool(index, 'plan-then-build')).toBe('one file per part')
    expect(skillTool(index, { name: 'plan-then-build' })).toBe('one file per part')
    expect(JSON.parse(skillTool(index, 'nope'))).toMatchObject({ ok: false, error: { name: 'NotFoundError' } })
  })
})

describe('skillIndex', () => {
  it('lists each id with its frontmatter description', () => {
    const index = {
      'plan-then-build': '---\ndescription: plan first, then build\n---\nbody',
      nodesc: 'just a body',
    }
    expect(skillIndex(index)).toEqual([
      { id: 'plan-then-build', description: 'plan first, then build' },
      { id: 'nodesc', description: '' },
    ])
  })
})
