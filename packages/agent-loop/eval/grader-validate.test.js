import { describe, expect, it } from 'vitest'
import { NO_GRADE } from './executor-protocol.js'
import { expectedMatch, formatValidation, validationRun } from './grader-validate.js'
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

describe('formatValidation', () => {
  it('prints one line per case, and the render directory until there is a description', async () => {
    const runs = [await validationRun(kase('caboose', 'pass'), graded(), render), await validationRun(kase('exploded', 'gate'), graded([unit, { boundingBox: [[9, 9, 9], [10, 10, 10]] }]), render)]
    const text = formatValidation(runs, { judged: false })
    expect(text).toContain('caboose  pass  -  -  -  -')
    expect(text).toContain('exploded  gate  connected  -  -  yes')
    expect(text).toContain('caboose: v.renders/caboose-1')
  })
})
