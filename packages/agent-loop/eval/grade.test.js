import { describe, expect, it } from 'vitest'
import { firstAttemptFailures, geometryError, gradeFixture, transcriptMetrics } from './grade.js'

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
  it('scores a clean verified run at full marks, including recovery (nothing to recover from)', () => {
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
    expect(report.dimensions).toEqual({ discipline: 2, recovery: 2, geometry: 2, conservation: 2 })
    expect(report.total).toBe(8)
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

describe('firstAttemptFailures', () => {
  const fail = (id) => resultMsg(id, JSON.stringify({ ok: false, error: { message: 'boom' } }))
  const ok = (id) => resultMsg(id, JSON.stringify({ ok: true }))

  it('counts failed results before the first successful eval', () => {
    const transcript = [
      toolMsg('t1', 'eval'), fail('t1'),
      toolMsg('t2', 'params'), ok('t2'),
      toolMsg('t3', 'eval'), fail('t3'),
      toolMsg('t4', 'eval'), ok('t4'),
      toolMsg('t5', 'measure'), fail('t5'),
    ]
    expect(firstAttemptFailures(transcript)).toBe(2)
  })

  it('counts every failure when no eval succeeds', () => {
    expect(firstAttemptFailures([toolMsg('t1', 'eval'), fail('t1'), toolMsg('t2', 'writeModel'), fail('t2')])).toBe(2)
  })

  it('is zero for a clean run and lands on the report', () => {
    const transcript = [toolMsg('t1', 'eval'), ok('t1')]
    expect(firstAttemptFailures(transcript)).toBe(0)
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.firstAttemptFailures).toBe(0)
    expect(report.checkRate).toBe(1)
  })

  it('passes the context to the checks', () => {
    const withParams = { ...fixture, checks: (_m, { params = [] } = {}) => [{ name: 'slider', pass: params.length === 1 }] }
    expect(gradeFixture(withParams, [], null, { params: [{ type: 'slider' }] }).checkRate).toBe(1)
  })
})

describe('transcriptMetrics', () => {
  const fail = (id) => resultMsg(id, JSON.stringify({ ok: false, error: { message: 'boom' } }))
  const ok = (id) => resultMsg(id, JSON.stringify({ ok: true }))

  it('counts every tool call and every failed result, not just before the first success', () => {
    const transcript = [
      toolMsg('t1', 'eval'), fail('t1'),
      toolMsg('t2', 'eval'), ok('t2'),
      toolMsg('t3', 'measure'), fail('t3'),
      toolMsg('t4', 'writeModel'), ok('t4'),
    ]
    expect(transcriptMetrics(transcript)).toEqual({ toolCalls: 4, failedCalls: 2, warnings: 0, docsCalls: 0 })
  })

  it('is zero for an empty transcript', () => {
    expect(transcriptMetrics([])).toEqual({ toolCalls: 0, failedCalls: 0, warnings: 0, docsCalls: 0 })
  })

  it('sums returned warnings and counts docs calls', () => {
    const warned = (id, n) => resultMsg(id, JSON.stringify({ ok: true, warnings: Array.from({ length: n }, () => ({})) }))
    const transcript = [
      toolMsg('t1', 'docs'), resultMsg('t1', 'primitives.roundedCuboid (@jscad/modeling)'),
      toolMsg('t2', 'eval'), warned('t2', 2),
      toolMsg('t3', 'writeModel'), warned('t3', 1),
    ]
    expect(transcriptMetrics(transcript)).toEqual({ toolCalls: 3, failedCalls: 0, warnings: 3, docsCalls: 1 })
  })
})

describe('geometryError', () => {
  it('is null when the fixture has no target', () => {
    expect(geometryError(undefined, { volume: 100 })).toBeNull()
  })

  it('is null when no geometry was produced', () => {
    expect(geometryError({ volume: 100 }, null)).toBeNull()
  })

  it('is the relative volume error when the target has a volume', () => {
    expect(geometryError({ volume: 100 }, { volume: 110 })).toBeCloseTo(0.1)
  })

  it('is the max relative dimension error, comparing sorted ascending', () => {
    expect(geometryError({ dimensions: [10, 20, 30] }, { dimensions: [30, 11, 20] })).toBeCloseTo(0.1)
  })

  it('takes the max across volume and dimension errors', () => {
    expect(geometryError({ volume: 100, dimensions: [10, 20] }, { volume: 105, dimensions: [10, 24] })).toBeCloseTo(0.2)
  })
})
