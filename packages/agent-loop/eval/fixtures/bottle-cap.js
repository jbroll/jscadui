import { holeLoops, outerLoops, turnOf } from '../probe.js'

// A real-world size the model must know (a 28 mm PCO bottle neck: thread
// about 27.4 mm across its crests, 25 mm at its root) and a computed helix.
const AXES = ['x', 'y', 'z']
const ALONG = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)

// A cut through the thread: a hole whose outline reaches in and out by 0.4 mm or more.
const threaded = (s) => {
  const [hole] = holeLoops(s)
  return Boolean(hole) && hole.radius[1] - hole.radius[0] >= 0.4
}

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]

// The longest run of consecutive threaded cuts.
const threadRun = (cuts) => {
  let best = []
  let run = []
  for (const s of cuts) {
    run = threaded(s) ? [...run, s] : []
    if (run.length > best.length) best = run
  }
  return best
}

const round = (loop, i) => {
  const [a, b] = [0, 1, 2].filter((k) => k !== i).map((k) => loop.dimensions[k])
  return Math.min(a, b) >= 0.95 * Math.max(a, b)
}

export const fixture = {
  name: 'bottle-cap',
  group: 'harder',
  prompt: 'a cap that screws onto a 28mm soda bottle',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 10,
  probe: { sections: AXES.map((axis) => ({ axis, at: ALONG, outline: true })) },
  checks: (m, { solid, probe } = {}) => {
    const sections = probe?.sections ?? []
    const dims = m?.dimensions ?? [0, 0, 0]
    // The cap's axis: the one whose middle cut is a round ring.
    const i = [0, 1, 2].find((k) => {
      const mid = sections.find((s) => s.axis === AXES[k] && s.at === ALONG[25])
      const [outer] = outerLoops(mid)
      return outer && round(outer, k) && holeLoops(mid).length > 0
    })
    const cuts = i === undefined ? [] : sections.filter((s) => s.axis === AXES[i])
    const run = threadRun(cuts)
    const holes = run.map((s) => holeLoops(s)[0])
    const crest = holes.length ? 2 * median(holes.map((h) => h.radius[0])) : 0
    const root = holes.length ? 2 * median(holes.map((h) => h.radius[1])) : 0
    const turn = holes.length >= 4 ? turnOf(holes) : null
    const rise = run.length >= 2 ? run.at(-1).offset - run[0].offset : 0
    const steps = turn ? turn.degrees.slice(1).map((d, n) => d - turn.degrees[n]) : []
    const steady = steps.length > 0 && Math.max(steps.filter((d) => d > 0).length, steps.filter((d) => d < 0).length) >= 0.8 * steps.length
    const perMm = rise > 0 && turn ? Math.abs(turn.degrees.at(-1)) / rise : 0
    const [first, last] = [cuts[0], cuts.at(-1)]
    const closedEnd = (s) => Boolean(s) && outerLoops(s).length > 0 && holeLoops(s).length === 0
    const openEnd = (s) => Boolean(s) && holeLoops(s).length > 0
    const across = i === undefined ? 0 : Math.max(...[0, 1, 2].filter((k) => k !== i).map((k) => dims[k]))
    return [
      { name: 'cap-sized', pass: across >= 28.5 && across <= 45 && dims[i] >= 6 && dims[i] <= 35 },
      { name: 'closed top', pass: (closedEnd(first) && openEnd(last)) || (closedEnd(last) && openEnd(first)) },
      { name: 'thread fits a 28mm neck', pass: crest >= 24.8 && crest <= 27.2 && root >= 27.3 && root <= 30.5 },
      { name: 'helical thread', pass: Boolean(turn) && turn.magnitude >= 0.002 && steady && Math.abs(turn.degrees.at(-1)) >= 180 && perMm >= 45 && perMm <= 200 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
