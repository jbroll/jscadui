import { holeLoops, outerLoops } from '../probe.js'

// A part that must fit a stated opening with a stated clearance, plus a
// handle on its front and an open top, graded in any orientation.
const AXES = ['x', 'y', 'z']
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]
const OPENING = [100, 80, 50]
const CUTS = [0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.35, 0.5, 0.65, 0.8, 0.88, 0.92, 0.95, 0.97, 0.98, 0.99]

const inPlane = (loop, i) => PLANE[i].map((k) => [loop.boundingBox[0][k], loop.boundingBox[1][k]])
const extent = (loops, i) => {
  if (!loops.length) return null
  const spans = loops.map((l) => inPlane(l, i))
  return [0, 1].map((n) => [Math.min(...spans.map((s) => s[n][0])), Math.max(...spans.map((s) => s[n][1]))])
}
const size = (box) => box.map(([lo, hi]) => hi - lo)
const contains = (outer, inner) => outer.every(([lo, hi], n) => lo <= inner[n][0] + 0.01 && hi >= inner[n][1] - 0.01)

const cutsOf = (body, i) => body.sections.filter((s) => s.axis === AXES[i]).sort((a, b) => a.at - b.at)
const middle = (body, i) => cutsOf(body, i).find((s) => s.at === 0.5)

// The axis the drawer slides along: its middle cut across it is the opening
// less 0.3-1.2 mm in both directions, with no more than the remaining opening
// size (plus a front and handle) along it.
const slideAxes = (body) =>
  [0, 1, 2].filter((i) => {
    const across = middle(body, i) && extent(outerLoops(middle(body, i)), i)
    if (!across) return false
    const fit = size(across).sort((a, b) => a - b)
    return OPENING.some((depth, d) => {
      const pair = OPENING.filter((_, n) => n !== d).sort((a, b) => a - b)
      return fit.every((f, n) => pair[n] - f >= 0.3 && pair[n] - f <= 1.2) && body.dimensions[i] <= depth + 40
    })
  })

// A handle stands out past one end of the slide axis as a cut much smaller
// than the drawer's cross-section, or is a hole or notch in the front wall.
const hasHandle = (body, i) => {
  const cuts = cutsOf(body, i)
  const body2d = size(extent(outerLoops(middle(body, i)), i))
  const full = body2d[0] * body2d[1]
  const ends = [cuts.filter((s) => s.at <= 0.12), cuts.filter((s) => s.at >= 0.88).reverse()]
  return ends.some((end) => {
    const pull = end.some((s) => {
      const e = extent(outerLoops(s), i)
      return e && size(e)[0] * size(e)[1] < 0.5 * full
    })
    // A cut past a thin wall is the drawer's U-shaped section, missing far more.
    const wall = end.slice(0, 3).some((s) => (s.groups ?? []).some((g) => g.hullArea - g.area >= 100 && g.hullArea - g.area <= 0.4 * full))
    return pull || wall
  })
}

// Hollow with the top open: across some other axis the middle cut has a hole,
// nothing on one side of it covers that hole, and something on the other does.
// A cover is material over the hole's whole span, so a wall ring broken by a
// finger notch is not one.
const openTopped = (body, slide) =>
  [0, 1, 2]
    .filter((i) => i !== slide)
    .some((i) => {
      const [hole] = holeLoops(middle(body, i))
      if (!hole) return false
      const opening = inPlane(hole, i)
      const [w, d] = size(opening)
      const covers = (s) =>
        s.loops.reduce((sum, l) => sum + l.area, 0) >= 0.8 * w * d && outerLoops(s).some((l) => contains(inPlane(l, i), opening))
      const [below, above] = [cutsOf(body, i).filter((s) => s.at < 0.5), cutsOf(body, i).filter((s) => s.at > 0.5)]
      return (below.some(covers) && !above.some(covers)) || (above.some(covers) && !below.some(covers))
    })

export const fixture = {
  name: 'drawer',
  group: 'harder',
  prompt: 'a drawer that slides into a 100 x 80 x 50 opening with 0.5mm clearance, with a handle',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: { sections: AXES.map((axis) => ({ axis, at: CUTS, groupGap: 5 })) } },
  checks: (m, { solid, probe } = {}) => {
    const graded = (probe?.bodies ?? []).map((body) => {
      const slides = slideAxes(body)
      return {
        fits: slides.length > 0,
        handle: slides.some((i) => hasHandle(body, i)),
        open: slides.some((i) => openTopped(body, i)),
      }
    })
    const drawer = graded.sort((a, b) => Object.values(b).filter(Boolean).length - Object.values(a).filter(Boolean).length)[0]
    return [
      { name: 'fits the opening with 0.5mm clearance', pass: Boolean(drawer?.fits) },
      { name: 'a handle on the front', pass: Boolean(drawer?.handle) },
      { name: 'hollow with an open top', pass: Boolean(drawer?.open) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
