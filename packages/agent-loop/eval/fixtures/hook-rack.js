import { outerLoops } from '../probe.js'

// Five hooks: a cut across them is five separate loops, not counting the back
// plate or rail, which runs most of the rack's length.
const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const AXES = ['x', 'y', 'z']

export const fixture = {
  name: 'hook-rack',
  prompt: 'a wall rack with 5 hooks in a row',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const [smallest, mid, largest] = [...dims].sort((a, b) => a - b)
    const long = AXES[dims.indexOf(largest)]
    const i = AXES.indexOf(long)
    const hooks = (s) => outerLoops(s).filter((l) => l.dimensions[i] < largest * 0.5).length
    const across = (probe?.sections ?? []).filter((s) => s.axis !== long)
    return [
      { name: 'rack-sized', pass: largest >= 100 && largest <= 600 && mid >= 10 && mid <= 200 && smallest >= 3 },
      { name: 'longer than tall or deep', pass: mid > 0 && largest >= mid * 1.2 },
      { name: 'five hooks', pass: across.some((s) => hooks(s) === 5) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
