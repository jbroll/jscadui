import { describe, expect, it } from 'vitest'
import { createEvalBackend } from '../backend.js'
import { harnessGates, renderFacts } from '../complex.js'
import { CABOOSE_MESSAGE, CASES, patched } from './cases.js'

const backend = createEvalBackend({ api: 'fluent' })
const grade = (c) => backend.gradeProject({ files: { 'main.js': c.source }, entry: 'main.js' }, { probe: { bodies: {} } })

// The trial's sizes and part counts, so a patch that drifts shows (optional reference: the trial's run_nearmiss.py, not in the repo).
const TRIAL = {
  caboose: { dimensions: [111, 41, 67], bodies: 62, connected: true },
  'delivery-truck': { dimensions: [116, 46, 50], bodies: 18, connected: true },
  'plain-box': { dimensions: [84, 41, 46], bodies: 12, connected: true },
  exploded: { dimensions: [111, 71, 117], bodies: 62, connected: false },
  'no-roof': { dimensions: [111, 41, 62], bodies: 58, connected: true },
}
// Approved answers (Task 11) are model-written code: only grader-validate builds them, in the sandbox.
const TRIAL_CASES = CASES.filter((c) => c.name in TRIAL)

describe('grader-validation cases', () => {
  it('scores four trial cases and records the known miss', () => {
    expect(TRIAL_CASES.map((c) => [c.name, c.expected])).toEqual([
      ['caboose', 'pass'],
      ['delivery-truck', 'fail'],
      ['plain-box', 'fail'],
      ['exploded', 'gate'],
      ['no-roof', 'known-miss'],
    ])
    for (const c of TRIAL_CASES) expect(c.messages).toEqual([CABOOSE_MESSAGE])
  })

  for (const c of TRIAL_CASES) {
    it(`${c.name} builds as the trial's model did`, async () => {
      const graded = await grade(c)
      const gates = harnessGates(graded)
      expect(gates[0].pass).toBe(true)
      expect(renderFacts(graded)).toEqual({ dimensions: TRIAL[c.name].dimensions, bodies: TRIAL[c.name].bodies })
      expect(gates[2].pass).toBe(TRIAL[c.name].connected)
    }, 30_000)
  }

  it('refuses a patch whose text is missing', () => {
    expect(() => patched('abc', [['xyz', 'q']])).toThrow(/no "xyz"/)
  })
})
