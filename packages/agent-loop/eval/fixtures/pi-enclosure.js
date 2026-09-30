import { footprint, holeLoops, outerLoops } from '../probe.js'
import { apart } from './sliding-lid-box.js'

// A real board the model must know: a Raspberry Pi 4 is 85 x 56 mm with M2.5
// holes on a 58 x 49 mm rectangle 3.5 mm in from one short edge, and its USB
// and Ethernet ports on the far short edge, 23.5 mm past the holes.
const AXES = ['x', 'y', 'z']
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]
const ALONG = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)
const NEAR_ENDS = [0.003, 0.006, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06, 0.08].flatMap((f) => [f, 1 - f])
// Pairwise distances between the four holes, sorted.
const PATTERN = [49, 49, 58, 58, Math.hypot(49, 58), Math.hypot(49, 58)]
const BOARD = { long: 85, short: 56, inset: 3.5 }

const centreOf = (loop, i) => PLANE[i].map((k) => (loop.boundingBox[0][k] + loop.boundingBox[1][k]) / 2)
const spanOf = (loop, i) => PLANE[i].map((k) => [loop.boundingBox[0][k], loop.boundingBox[1][k]])

const quads = (list) => {
  const out = []
  for (let a = 0; a < list.length; a++)
    for (let b = a + 1; b < list.length; b++)
      for (let c = b + 1; c < list.length; c++) for (let d = c + 1; d < list.length; d++) out.push([list[a], list[b], list[c], list[d]])
  return out
}

// Four post-sized islands in one cut whose centres make the hole rectangle.
const postsIn = (section, i) => {
  const posts = outerLoops(section)
    .filter((l) => {
      const [a, b] = footprint(l, AXES[i])
      return a >= 2.5 && b <= 14 && b <= 1.3 * a
    })
    .slice(0, 16)
    .map((l) => centreOf(l, i))
  return (
    quads(posts).find((four) => {
      const d = four.flatMap((p, n) => four.slice(n + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))).sort((x, y) => x - y)
      return d.every((x, n) => Math.abs(x - PATTERN[n]) <= (n < 4 ? 1 : 1.5))
    }) ?? null
  )
}

const findPosts = (sections) => {
  for (const [i, axis] of AXES.entries()) {
    for (const section of sections.filter((s) => s.axis === axis)) {
      const posts = postsIn(section, i)
      if (posts) return { i, section, posts }
    }
  }
  return null
}

const range = (posts, n) => [Math.min(...posts.map((p) => p[n])), Math.max(...posts.map((p) => p[n]))]
const within = (inner, outer) => inner[0] >= outer[0] - 0.3 && inner[1] <= outer[1] + 0.3

// The board on the posts, ports toward the + or - end of its long direction,
// and the cavity it has to sit in: the smallest hole around the posts.
const layoutOf = ({ i, section, posts }) => {
  const spreads = [0, 1].map((n) => range(posts, n)[1] - range(posts, n)[0])
  const long = [0, 1].find((n) => Math.abs(spreads[n] - 58) <= 1.5 && Math.abs(spreads[1 - n] - 49) <= 1.5)
  if (long === undefined) return null
  const [s, t] = [range(posts, long), range(posts, 1 - long)]
  const hole = holeLoops(section)
    .map((h) => spanOf(h, i))
    .filter((span) => posts.every((p) => [0, 1].every((n) => p[n] > span[n][0] && p[n] < span[n][1])))
    .sort((a, b) => (a[0][1] - a[0][0]) * (a[1][1] - a[1][0]) - (b[0][1] - b[0][0]) * (b[1][1] - b[1][0]))[0]
  if (!hole) return null
  const across = [t[0] - BOARD.inset, t[1] + BOARD.inset]
  const beyond = BOARD.long - BOARD.inset - 58
  const ends = [
    { sign: 1, along: [s[0] - BOARD.inset, s[1] + beyond] },
    { sign: -1, along: [s[0] - beyond, s[1] + BOARD.inset] },
  ].filter((e) => within(e.along, hole[long]) && within(across, hole[1 - long]))
  return { i, long, cavity: hole, ends, axis: PLANE[i][long] }
}

// Material missing from a cut through the end wall past the cavity: the port openings.
const openingsAt = (box, layout, sign) => {
  const edge = layout.cavity[layout.long][sign > 0 ? 1 : 0]
  return box.sections
    .filter((s) => s.axis === AXES[layout.axis] && (sign > 0 ? s.offset > edge + 0.05 : s.offset < edge - 0.05))
    .some((s) => (s.groups ?? []).some((g) => g.hullArea - g.area >= 150))
}

export const fixture = {
  name: 'pi-enclosure',
  group: 'harder',
  prompt: 'an enclosure for a Raspberry Pi 4 with standoffs for its mounting holes, cutouts for the USB and ethernet ports, and a snap-fit lid',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 10,
  probe: {
    sections: AXES.map((axis) => ({ axis, at: ALONG })),
    bodies: { sections: AXES.map((axis) => ({ axis, at: NEAR_ENDS, groupGap: 200 })), overlaps: true },
  },
  checks: (m, { solid, probe } = {}) => {
    const found = findPosts(probe?.sections ?? [])
    const layout = found ? layoutOf(found) : null
    const bodies = probe?.bodies ?? []
    const holds = (b) => found && found.posts.every((p) => PLANE[found.i].every((k, n) => p[n] >= b.boundingBox[0][k] && p[n] <= b.boundingBox[1][k]))
    const box = bodies.filter(holds).sort((a, b) => b.volume - a.volume)[0]
    const cavity = layout ? [layout.cavity[layout.long], layout.cavity[1 - layout.long]].map(([lo, hi]) => hi - lo) : [0, 0]
    const roomy = cavity[0] >= BOARD.long + 0.5 && cavity[1] >= BOARD.short + 0.5 && cavity[0] <= BOARD.long + 40 && cavity[1] <= BOARD.short + 30
    const plan = box && found ? PLANE[found.i].map((k) => box.dimensions[k]).sort((a, b) => a - b) : null
    const lid = plan && bodies.find((b) => {
      if (b === box) return false
      const [, mid, big] = [...b.dimensions].sort((x, y) => x - y)
      return mid >= 0.8 * plan[0] && big >= 0.8 * plan[1] && mid <= plan[0] + 15 && big <= plan[1] + 15
    })
    return [
      { name: 'standoffs on the 58 x 49 hole pattern', pass: Boolean(found) },
      { name: 'the board fits inside with clearance', pass: Boolean(layout) && layout.ends.length > 0 && roomy },
      { name: 'USB and Ethernet openings in the port end', pass: Boolean(box && layout) && layout.ends.some((e) => openingsAt(box, layout, e.sign)) },
      { name: 'a separate lid', pass: Boolean(lid) },
      { name: 'parts do not overlap', pass: Boolean(probe) && apart(probe) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
