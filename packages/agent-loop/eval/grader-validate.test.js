import { describe, expect, it } from 'vitest'
import { NO_GRADE } from './executor-protocol.js'
import { approvedCase, describeOrStop, expectedMatch, formatValidation, validationRun } from './grader-validate.js'
import { VIEWS } from './views.js'

const unit = { boundingBox: [[0, 0, 0], [1, 1, 1]] }
const graded = (bodies = [unit]) => ({
  measure: { dimensions: [111, 41, 67] },
  solid: { watertight: true },
  params: [],
  probe: { bodies },
  mesh: { parts: [{ color: null, positions: new Float32Array(9) }] },
})
const render = async (_parts, { fixture, run }) => VIEWS.map((v) => ({ name: v.name, path: `v.renders/${fixture}-${run}/${v.name}.png`, sha256: 'a'.repeat(64) }))
const kase = (name, expected) => ({ name, messages: ['we need a model of a toy caboose'], expected })

describe('validationRun', () => {
  it('holds gates, renders and a pending verdict', async () => {
    const run = await validationRun(kase('caboose', 'pass'), graded(), render)
    expect(run).toMatchObject({ fixture: 'caboose', run: 1, expected: 'pass', userMessages: ['we need a model of a toy caboose'], description: null, verdict: null, verdictPending: true })
    expect(run.gates.map((g) => g.pass)).toEqual([true, true, true])
    expect(run.render.facts).toEqual({ dimensions: [111, 41, 67], bodies: 1 })
    expect(run.render.views).toHaveLength(3)
  })

  it('records a case that did not build', async () => {
    const run = await validationRun(kase('broken', 'fail'), NO_GRADE(), render)
    expect(run.renderError).toBe('the case did not build')
    expect(run.verdictPending).toBeUndefined()
  })
})

describe('expectedMatch', () => {
  const connected = (pass) => [{ name: 'connected', pass }]
  it('reads pass and fail from the verdict, gate from connected, and scores no known miss', () => {
    expect(expectedMatch({ expected: 'pass', gates: connected(true), verdict: { success: true } })).toBe(true)
    expect(expectedMatch({ expected: 'pass', gates: connected(true), verdict: null })).toBe(false)
    expect(expectedMatch({ expected: 'fail', gates: connected(true), verdict: { success: false } })).toBe(true)
    expect(expectedMatch({ expected: 'fail', gates: connected(true), verdict: { success: true } })).toBe(false)
    expect(expectedMatch({ expected: 'gate', gates: connected(false), verdict: { success: true } })).toBe(true)
    expect(expectedMatch({ expected: 'gate', gates: connected(true), verdict: null })).toBe(false)
    expect(expectedMatch({ expected: 'known-miss', gates: connected(true), verdict: { success: true } })).toBeNull()
  })
})

describe('describeOrStop', () => {
  it('catches a thrown GPU shortfall or start failure, prints it and stops before judging', async () => {
    const errors = []
    const originalError = console.error
    const originalExitCode = process.exitCode
    console.error = (line) => errors.push(line)
    try {
      const stopped = await describeOrStop('path.json', {}, { runDescribe: async () => { throw new Error('8000 MiB free on the GPU; the describer needs 11800') } })
      expect(stopped).toBe(true)
      expect(errors).toEqual(['grader-validate: 8000 MiB free on the GPU; the describer needs 11800'])
      expect(process.exitCode).toBe(1)
    } finally {
      console.error = originalError
      process.exitCode = originalExitCode
    }
  })

  it('does not stop when the describer finished with nothing to report', async () => {
    const stopped = await describeOrStop('path.json', {}, { runDescribe: async () => ({ described: 0, failed: 0, blockedConnections: 0 }) })
    expect(stopped).toBe(false)
  })
})

describe('formatValidation', () => {
  it('prints one line per case, and the render directory until there is a description', async () => {
    const runs = [await validationRun(kase('caboose', 'pass'), graded(), render), await validationRun(kase('exploded', 'gate'), graded([unit, { boundingBox: [[9, 9, 9], [10, 10, 10]] }]), render)]
    const text = formatValidation(runs, { judged: false })
    expect(text).toContain('caboose  pass  -  -  -  -')
    expect(text).toContain('exploded  gate  connected  -  -  yes')
    expect(text).toContain('caboose: v.renders/caboose-1')
  })
})

describe('approvedCase', () => {
  const fixture = { name: 'rocket-revised', group: 'complex', prompt: 'a model rocket about 20cm tall', followUps: [{ message: 'two stages' }], requires: ['write'], pieces: 1, gates: () => [] }
  const transcript = [
    { role: 'user', content: 'a model rocket about 20cm tall' },
    { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: 'rocket' } }] },
    { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
  ]
  const file = { api: 'modeling', results: [{ fixture: 'rocket-revised', run: 2, userMessages: ['a model rocket about 20cm tall', 'two stages'], transcript }] }

  it('makes a validation case from a run the user approved', () => {
    expect(approvedCase(file, new Map([[fixture.name, fixture]]), 'rocket-revised', 2)).toEqual({
      name: 'rocket-revised-approved',
      messages: ['a model rocket about 20cm tall', 'two stages'],
      expected: 'pass',
      api: 'modeling',
      pieces: 1,
      files: { 'main.js': 'rocket' },
      entry: 'main.js',
    })
  })

  it('names a run that is not in the file', () => {
    expect(() => approvedCase(file, new Map([[fixture.name, fixture]]), 'rocket-revised', 3)).toThrow(/no run rocket-revised#3/)
  })
})
