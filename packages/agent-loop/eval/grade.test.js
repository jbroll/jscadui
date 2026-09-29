import { describe, expect, it } from 'vitest'
import { endedWithoutReply, firstAttemptFailures, geometryError, gradedModel, gradeFixture, transcriptMetrics } from './grade.js'

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
    const transcript = [{ role: 'user', content: 'make it' }, toolMsg('t1', 'writeModel', { source: 'x' })]
    expect(gradeFixture(fixture, transcript, { volume: 100 }).dimensions.geometry).toBe(1)
    expect(gradeFixture(fixture, transcript, null).dimensions.geometry).toBe(0)
  })

  it('gives no geometry credit, and runs no checks, when a fixture that requires writeModel never got one', () => {
    const transcript = [toolMsg('t1', 'eval', { source: 'x' }), resultMsg('t1', JSON.stringify({ ok: true, entities: 1 }))]
    let ran = false
    const spy = { ...fixture, checks: () => ((ran = true), [{ name: 'any', pass: true }]) }
    const report = gradeFixture(spy, transcript, { volume: 6400 })
    expect(ran).toBe(false)
    expect(report.dimensions).toEqual({ discipline: 2, recovery: 2, geometry: 0, conservation: 2 })
    expect(report.total).toBe(6)
    expect(report.checkRate).toBe(0)
    expect(report.saved).toBe(false)
  })

  it('grades the last eval when the fixture does not require writeModel', () => {
    const noWrite = { ...fixture, requires: ['eval'] }
    const transcript = [toolMsg('t1', 'eval', { source: 'x' }), resultMsg('t1', JSON.stringify({ ok: true }))]
    const report = gradeFixture(noWrite, transcript, { volume: 6400 })
    expect(report.dimensions.geometry).toBe(2)
    expect(report).not.toHaveProperty('saved')
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
    const transcript = [toolMsg('t1', 'eval'), ok('t1'), toolMsg('t2', 'writeModel', { source: 'x' }), ok('t2')]
    expect(firstAttemptFailures(transcript)).toBe(0)
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.firstAttemptFailures).toBe(0)
    expect(report.checkRate).toBe(1)
  })

  it('passes the context to the checks', () => {
    const withParams = { ...fixture, requires: ['eval'], checks: (_m, { params = [] } = {}) => [{ name: 'slider', pass: params.length === 1 }] }
    expect(gradeFixture(withParams, [], null, { params: [{ type: 'slider' }] }).checkRate).toBe(1)
  })

  it('passes the last writeModel source to the checks, over an earlier eval', () => {
    const transcript = [
      toolMsg('t1', 'eval', { source: 'const a = 1' }),
      resultMsg('t1', JSON.stringify({ ok: true })),
      toolMsg('t2', 'writeModel', { source: 'const b = 2' }),
      resultMsg('t2', JSON.stringify({ ok: true })),
    ]
    const withSource = { ...fixture, checks: (_m, { source }) => [{ name: 'source', pass: source === 'const b = 2' }] }
    expect(gradeFixture(withSource, transcript, null).checkRate).toBe(1)
  })

  it('passes every project file to the checks as source', () => {
    const transcript = [
      toolMsg('t1', 'writeModel', { source: 'const main = 1' }),
      toolMsg('t2', 'writeModel', { source: 'const helper = 2', entry: 'helper.js' }),
    ]
    let seen
    const spy = { ...fixture, checks: (_m, { source }) => ((seen = source), []) }
    gradeFixture(spy, transcript, null)
    expect(seen).toContain('const main = 1')
    expect(seen).toContain('const helper = 2')
  })

  it('falls back to the last eval source when writeModel was never called', () => {
    const transcript = [toolMsg('t1', 'eval', { source: 'const a = 1' }), resultMsg('t1', JSON.stringify({ ok: true }))]
    const withSource = { ...fixture, requires: ['eval'], checks: (_m, { source }) => [{ name: 'source', pass: source === 'const a = 1' }] }
    expect(gradeFixture(withSource, transcript, null).checkRate).toBe(1)
  })
})

describe('gradedModel', () => {
  const requiresWrite = { requires: ['eval', 'writeModel'] }
  const evalOnly = { requires: ['eval'] }

  it('is the project after the last writeModel, whatever was evaled after it', () => {
    const transcript = [
      toolMsg('t1', 'eval', { source: 'a' }),
      toolMsg('t2', 'writeModel', { source: 'b', entry: 'part.js' }),
      toolMsg('t3', 'writeModel', { source: 'c' }),
      toolMsg('t4', 'eval', { source: 'probe' }),
    ]
    const project = { files: { 'part.js': 'b', 'main.js': 'c' }, entry: 'main.js' }
    expect(gradedModel(requiresWrite, transcript)).toEqual(project)
    expect(gradedModel(evalOnly, transcript)).toEqual(project)
  })

  it('evaluates through main.js when the last write is another file', () => {
    const transcript = [
      toolMsg('t1', 'writeModel', { source: 'main v1' }),
      toolMsg('t2', 'writeModel', { source: 'helper v1', entry: 'helper.js' }),
      toolMsg('t3', 'writeModel', { source: 'main v2', entry: 'main.js' }),
      toolMsg('t4', 'writeModel', { source: 'helper v2', entry: 'helper.js' }),
    ]
    expect(gradedModel(requiresWrite, transcript)).toEqual({ files: { 'main.js': 'main v2', 'helper.js': 'helper v2' }, entry: 'main.js' })
  })

  it('evaluates the last written file when the project has no main.js', () => {
    const transcript = [toolMsg('t1', 'writeModel', { source: 'a', entry: 'a.js' }), toolMsg('t2', 'writeModel', { source: 'b', entry: 'b.js' })]
    expect(gradedModel(requiresWrite, transcript)).toEqual({ files: { 'a.js': 'a', 'b.js': 'b' }, entry: 'b.js' })
  })

  it('starts from the fixture files', () => {
    const withFiles = { ...requiresWrite, files: { 'main.js': 'old main', 'helper.js': 'old helper' } }
    expect(gradedModel(withFiles, [toolMsg('t1', 'writeModel', { source: 'new helper', entry: 'helper.js' })])).toEqual({
      files: { 'main.js': 'old main', 'helper.js': 'new helper' },
      entry: 'main.js',
    })
  })

  it('is null without a writeModel when the fixture requires one', () => {
    expect(gradedModel(requiresWrite, [toolMsg('t1', 'eval', { source: 'a' })])).toBeNull()
  })

  it('falls back to the last eval over the fixture files when the fixture does not require writeModel', () => {
    const transcript = [toolMsg('t1', 'eval', { source: 'a' }), toolMsg('t2', 'eval', { source: 'b' })]
    expect(gradedModel({ ...evalOnly, files: { 'helper.js': 'h' } }, transcript)).toEqual({ files: { 'helper.js': 'h', 'main.js': 'b' }, entry: 'main.js' })
  })

  it('is null when neither was called', () => {
    expect(gradedModel(evalOnly, [toolMsg('t1', 'measure', {})])).toBeNull()
  })
})

describe('endedWithoutReply', () => {
  const user = { role: 'user', content: 'p' }
  const reply = { role: 'assistant', content: 'done', toolCalls: [] }

  it('is true when the provider never replied', () => {
    expect(endedWithoutReply([user], 8)).toBe(true)
  })

  it('is true when a reply stopped coming after a tool result, under the turn cap', () => {
    expect(endedWithoutReply([user, toolMsg('t1', 'eval'), resultMsg('t1', '{}')], 8)).toBe(true)
  })

  it('is false when the run ended on a reply', () => {
    expect(endedWithoutReply([user, toolMsg('t1', 'eval'), resultMsg('t1', '{}'), reply], 8)).toBe(false)
  })

  it('is false when the turn cap cut the run off', () => {
    const capped = [user]
    for (let i = 0; i < 2; i += 1) capped.push(toolMsg(`t${i}`, 'eval'), resultMsg(`t${i}`, '{}'))
    expect(endedWithoutReply(capped, 2)).toBe(false)
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
