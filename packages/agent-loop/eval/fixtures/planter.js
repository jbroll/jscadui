export const fixture = {
  name: 'planter',
  group: 'complex',
  prompt: 'a small planter with a saucer for the water to drain into',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 2,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'at least two bodies', pass: (probe?.bodies?.length ?? 0) >= 2 }],
}
