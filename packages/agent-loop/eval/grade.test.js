import { describe, expect, it } from 'vitest'
import { gradeFixture } from './grade.js'

const fixture = {
  name: 'cube-hole',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: (m) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 5800 },
    { name: 'extents', pass: m !== null },
  ],
}

const toolMsg = (id, name, input = {}) => ({ role: 'assistant', content: null, toolCalls: [{ id, name, input }] })
const resultMsg = (id, content) => ({ role: 'tool', toolCallId: id, content })

describe('grader', () => {
  it('scores a clean verified run at full marks', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entities: 1 })),
      toolMsg('t2', 'measure', {}),
      resultMsg('t2', JSON.stringify({ ok: true, volume: 6400 })),
      toolMsg('t3', 'writeModel', { source: 'x' }),
      resultMsg('t3', JSON.stringify({ ok: true, entry: 'main.js' })),
    ]
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.dimensions).toEqual({ discipline: 2, recovery: 1, geometry: 2, conservation: 2 })
    expect(report.total).toBe(7)
  })

  it('penalizes writeModel before any verification', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entities: 1 })),
      toolMsg('t2', 'writeModel', { source: 'x' }),
      resultMsg('t2', JSON.stringify({ ok: true, entry: 'main.js' })),
    ]
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.dimensions.discipline).toBe(1)
  })

  it('rewards recovery and punishes abandonment', () => {
    const recovered = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: false, error: { message: 'boom' } })),
      toolMsg('t2', 'eval', { source: 'y' }),
      resultMsg('t2', JSON.stringify({ ok: true, entities: 1 })),
    ]
    expect(gradeFixture(fixture, recovered, { volume: 6400 }).dimensions.recovery).toBe(2)
    const abandoned = recovered.slice(0, 3)
    expect(gradeFixture(fixture, abandoned, null).dimensions.recovery).toBe(0)
  })

  it('scores geometry on check pass rate', () => {
    const transcript = [{ role: 'user', content: 'make it' }]
    expect(gradeFixture(fixture, transcript, { volume: 100 }).dimensions.geometry).toBe(1)
    expect(gradeFixture(fixture, transcript, null).dimensions.geometry).toBe(0)
  })
})
