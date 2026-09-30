import { describe, expect, it } from 'vitest'
import { endedWithoutReply, firstAttemptFailures, geometryError, gradedModel, gradeFixture, transcriptMetrics } from './grade.js'

const fixture = {
  name: 'cube-hole',
  requires: ['measure', 'write'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: (m) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 5800 },
    { name: 'extents', pass: m !== null },
  ],
}

const toolMsg = (id, name, input = {}) => ({ role: 'assistant', content: null, toolCalls: [{ id, name, input }] })
const resultMsg = (id, content) => ({ role: 'tool', toolCallId: id, content })

const built = (extra = {}) => JSON.stringify({ ok: true, entry: 'main.js', warnings: [], console: [], params: [], ...extra })
const brokenBuild = JSON.stringify({ ok: false, entry: 'main.js', error: { message: 'boom', file: 'main.js', line: 1, column: 1 }, warnings: [], console: [], params: [] })

describe('grader on project-tool transcripts', () => {
  it('scores a write that is measured afterwards at full marks', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'write', { path: 'main.js', content: 'x' }),
      resultMsg('t1', built()),
      toolMsg('t2', 'measure', {}),
      resultMsg('t2', JSON.stringify({ ok: true, volume: 6400 })),
    ]
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.dimensions).toEqual({ discipline: 2, recovery: 2, geometry: 2, conservation: 2 })
    expect(report.firstAttemptFailures).toBe(0)
  })

  it('gives no discipline to writes never verified, and credits a measuring run as a trial', () => {
    const writes = [toolMsg('t1', 'write', { path: 'main.js', content: 'x' }), resultMsg('t1', built())]
    expect(gradeFixture(fixture, writes, { volume: 6400 }).dimensions.discipline).toBe(0)
    const measuring = "const s = jf.cube({ size: 10 })\nconsole.log(s.measureDimensions())"
    const withRun = [toolMsg('r1', 'run', { source: measuring }), resultMsg('r1', JSON.stringify({ ok: true, console: ['[10,10,10]'] })), ...writes]
    expect(gradeFixture(fixture, withRun, { volume: 6400 }).dimensions.discipline).toBe(2)
    const unmeasured = [toolMsg('r1', 'run', { source: 'console.log(1)' }), resultMsg('r1', JSON.stringify({ ok: true, console: ['1'] })), ...writes]
    expect(gradeFixture(fixture, unmeasured, { volume: 6400 }).dimensions.discipline).toBe(1)
    expect(gradeFixture({ ...fixture, verifyBeforeWrite: false }, unmeasured, { volume: 6400 }).dimensions.discipline).toBe(2)
  })

  it('credits a write or edit whose build report came back with geometry and no error, as a measure call', () => {
    const geometry = { parts: 1, boundingBox: [[0, 0, 0], [10, 10, 10]], dimensions: [10, 10, 10], volume: 1000, watertight: true }
    const saves = (name, content) => [{ role: 'user', content: 'make it' }, toolMsg('t1', name, { path: 'main.js', content: 'x' }), resultMsg('t1', content)]
    expect(gradeFixture(fixture, saves('write', built({ geometry })), { volume: 6400 }).dimensions.discipline).toBe(2)
    expect(gradeFixture(fixture, saves('edit', built({ geometry })), { volume: 6400 }).dimensions.discipline).toBe(2)
    expect(gradeFixture(fixture, saves('write', built()), { volume: 6400 }).dimensions.discipline).toBe(0)
    expect(gradeFixture(fixture, saves('write', brokenBuild), { volume: 6400 }).dimensions.discipline).toBe(0)
    const unmeasuredRun = [toolMsg('r1', 'run', { source: 'console.log(1)' }), resultMsg('r1', JSON.stringify({ ok: true, console: ['1'] }))]
    expect(gradeFixture(fixture, [...unmeasuredRun, ...saves('write', built({ geometry }))], { volume: 6400 }).dimensions.discipline).toBe(2)
    expect(gradeFixture(fixture, [...unmeasuredRun, ...saves('write', brokenBuild)], { volume: 6400 }).dimensions.discipline).toBe(1)
  })

  it('counts failed builds and failed calls against conservation, never a successful write or edit', () => {
    const run = (goodWrites, badWrites, measures) => {
      const transcript = [{ role: 'user', content: 'make it' }]
      for (let i = 0; i < goodWrites; i += 1) {
        const name = i % 2 ? 'edit' : 'write'
        transcript.push(toolMsg(`w${i}`, name, {}), resultMsg(`w${i}`, built()))
      }
      for (let i = 0; i < badWrites; i += 1) transcript.push(toolMsg(`b${i}`, 'write', {}), resultMsg(`b${i}`, brokenBuild))
      for (let i = 0; i < measures; i += 1) transcript.push(toolMsg(`m${i}`, 'measure', {}), resultMsg(`m${i}`, JSON.stringify({ ok: true })))
      return gradeFixture(fixture, transcript, { volume: 6400 }).dimensions.conservation
    }
    expect(run(40, 0, 2)).toBe(2)
    expect(run(40, 10, 2)).toBe(2)
    expect(run(0, 11, 2)).toBe(1)
    expect(run(5, 20, 5)).toBe(0)
  })

  it('counts failures before the first successful build', () => {
    const transcript = [
      toolMsg('t1', 'edit', {}), resultMsg('t1', JSON.stringify({ ok: false, error: { name: 'EditError', message: 'oldString is not in main.js' } })),
      toolMsg('t2', 'write', {}), resultMsg('t2', brokenBuild),
      toolMsg('t3', 'list', {}), resultMsg('t3', JSON.stringify({ ok: true, files: [] })),
      toolMsg('t4', 'write', {}), resultMsg('t4', built()),
      toolMsg('t5', 'measure', {}), resultMsg('t5', JSON.stringify({ ok: false })),
    ]
    expect(firstAttemptFailures(transcript)).toBe(2)
  })

  it('satisfies a required write with an edit', () => {
    const transcript = [toolMsg('t1', 'edit', { path: 'main.js', oldString: 'old', newString: 'new' }), resultMsg('t1', built())]
    const report = gradeFixture({ ...fixture, files: { 'main.js': 'old main' } }, transcript, { volume: 6400 })
    expect(report).not.toHaveProperty('saved')
    expect(report.dimensions.geometry).toBe(2)
  })
})

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

  it('credits an eval that measures in the model code and logs it, as a measure call', () => {
    const measuring = "const shape = jf.cube({ size: 10 })\nconsole.log('dims', shape.measureDimensions(), 'vol', shape.measureVolume())\nmodule.exports = { main: () => shape }"
    const run = (source, content) => [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source }),
      resultMsg('t1', JSON.stringify(content)),
      toolMsg('t2', 'writeModel', { source }),
      resultMsg('t2', JSON.stringify({ ok: true, entry: 'main.js' })),
    ]
    const logged = { ok: true, entities: 1, console: ['dims [10,10,10] vol 1000'] }
    expect(gradeFixture(fixture, run(measuring, logged), { volume: 6400 }).dimensions.discipline).toBe(2)
    expect(gradeFixture(fixture, run(measuring, { ok: true, entities: 1 }), { volume: 6400 }).dimensions.discipline).toBe(1)
    expect(gradeFixture(fixture, run("console.log('hi')\nmodule.exports = { main: () => 1 }", logged), { volume: 6400 }).dimensions.discipline).toBe(1)
  })

  it('credits measuring after the save, with or without an eval, for any fixture', () => {
    const writeThen = (name) => [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'writeModel', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entry: 'main.js' })),
      toolMsg('t2', name, {}),
      resultMsg('t2', JSON.stringify({ ok: true, volume: 6400 })),
    ]
    for (const f of [fixture, { ...fixture, verifyBeforeWrite: false }]) {
      expect(gradeFixture(f, writeThen('measure'), { volume: 6400 }).dimensions.discipline).toBe(2)
      expect(gradeFixture(f, writeThen('check'), { volume: 6400 }).dimensions.discipline).toBe(2)
      expect(gradeFixture(f, writeThen('params'), { volume: 6400 }).dimensions.discipline).toBe(0)
    }
  })

  it('scores no recovery penalty for a failure in the last round of a run the turn cap ended', () => {
    const transcript = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'writeModel', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: true, entry: 'main.js' })),
      toolMsg('t2', 'eval', { source: 'y' }),
      resultMsg('t2', JSON.stringify({ ok: false, error: { message: 'boom' } })),
    ]
    expect(gradeFixture(fixture, transcript, { volume: 6400 }, {}, { maxTurns: 2 }).dimensions.recovery).toBe(2)
    expect(gradeFixture(fixture, transcript, { volume: 6400 }, {}, { maxTurns: 3 }).dimensions.recovery).toBe(0)
    expect(gradeFixture(fixture, transcript, { volume: 6400 }).dimensions.recovery).toBe(0)
    const earlier = [
      { role: 'user', content: 'make it' },
      toolMsg('t1', 'eval', { source: 'x' }),
      resultMsg('t1', JSON.stringify({ ok: false, error: { message: 'boom' } })),
      ...transcript.slice(3),
    ]
    expect(gradeFixture(fixture, earlier, { volume: 6400 }, {}, { maxTurns: 2 }).dimensions.recovery).toBe(0)
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

  it('never costs conservation for saving: legacy writeModel calls are not counted', () => {
    const run = (evals, writes) => {
      const transcript = [{ role: 'user', content: 'make it' }]
      for (let i = 0; i < evals; i += 1) transcript.push(toolMsg(`e${i}`, 'eval', { source: 'x' }), resultMsg(`e${i}`, JSON.stringify({ ok: true })))
      for (let i = 0; i < writes; i += 1) transcript.push(toolMsg(`w${i}`, 'writeModel', { source: 'x' }), resultMsg(`w${i}`, JSON.stringify({ ok: true })))
      return gradeFixture(fixture, transcript, { volume: 6400 }).dimensions.conservation
    }
    expect(run(2, 6)).toBe(2)
    expect(run(12, 20)).toBe(2)
    expect(run(13, 0)).toBe(1)
    expect(run(24, 30)).toBe(1)
    expect(run(25, 0)).toBe(0)
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
  const requiresWrite = { requires: ['write'] }
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

  it('replays writes and edits over the fixture files, skipping an edit the backend refused', () => {
    const withFiles = { ...requiresWrite, files: { 'main.js': 'size = 10' } }
    const transcript = [
      toolMsg('t1', 'write', { path: './helper.js', content: 'h1' }),
      toolMsg('t2', 'edit', { path: 'main.js', oldString: 'size = 10', newString: 'size = 20' }),
      toolMsg('t3', 'edit', { path: 'main.js', oldString: 'size = 99', newString: 'size = 30' }),
      toolMsg('t4', 'edit', { path: 'helper.js', oldString: 'h1', newString: 'h2' }),
    ]
    expect(gradedModel(withFiles, transcript)).toEqual({ files: { 'main.js': 'size = 20', 'helper.js': 'h2' }, entry: 'main.js' })
    expect(withFiles.files).toEqual({ 'main.js': 'size = 10' })
  })

  it('resolves the entry Node style, and has none when no entry file exists', () => {
    const pkg = [toolMsg('t1', 'write', { path: 'box.js', content: 'b' }), toolMsg('t2', 'write', { path: 'package.json', content: '{"main":"box.js"}' })]
    expect(gradedModel(requiresWrite, pkg).entry).toBe('box.js')
    expect(gradedModel(requiresWrite, [toolMsg('t1', 'write', { path: 'part.js', content: 'p' })])).toEqual({ files: { 'part.js': 'p' }, entry: null })
  })

  it('is null when every write was refused and a write is required', () => {
    expect(gradedModel(requiresWrite, [toolMsg('t1', 'write', { path: '../x.js', content: 'x' })])).toBeNull()
  })

  it('grades the fixture files as they are when a write is not required and none was made', () => {
    expect(gradedModel({ ...evalOnly, files: { 'main.js': 'm' } }, [toolMsg('t1', 'measure', {})])).toEqual({ files: { 'main.js': 'm' }, entry: 'main.js' })
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
