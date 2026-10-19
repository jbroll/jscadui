import { describe, expect, it } from 'vitest'
import { countStumbles } from './stumbles.js'

const step = (name, ok) => ({ name, input: {}, result: '{}', ok })
const convo = (...turns) => ({ turns: turns.map((steps) => ({ steps })) })

describe('countStumbles', () => {
  it('counts failed tool calls across turns', () => {
    const c = convo([step('run', false), step('write', true)], [step('edit', false)])
    expect(countStumbles(c).failedCalls).toBe(2)
  })

  it('a turn with no successful write or edit is unbuilt', () => {
    expect(countStumbles(convo([step('run', true)])).unbuiltTurns).toBe(1)
  })

  it('a turn whose last write failed is unbuilt even after an earlier good write', () => {
    expect(countStumbles(convo([step('write', true), step('edit', false)])).unbuiltTurns).toBe(1)
  })

  it('a turn ending in a successful edit is built', () => {
    expect(countStumbles(convo([step('write', false), step('edit', true)])).unbuiltTurns).toBe(0)
  })
})
