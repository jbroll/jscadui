// Inch units: 2 inches is 50.8mm, and the 1/2 inch hole removes its own volume.
const SIDE = 50.8
const HOLE = Math.PI * (25.4 / 4) ** 2 * SIDE

export const fixture = {
  name: 'inch-cube',
  prompt: 'a 2 inch cube with a 1/2 inch hole through it',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [SIDE, SIDE, SIDE] },
  checks: (m, { solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const removed = SIDE ** 3 - (m?.volume ?? 0)
    return [
      { name: '50.8mm in every axis', pass: dims.every((d) => Math.abs(d - SIDE) <= 0.5) },
      { name: 'a 1/2 inch hole removed', pass: Math.abs(removed - HOLE) <= HOLE * 0.15 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
