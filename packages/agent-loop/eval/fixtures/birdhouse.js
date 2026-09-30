// A removable roof is a body of its own; resting on the walls, it still touches them.
export const fixture = {
  name: 'birdhouse',
  group: 'complex',
  prompt: 'a birdhouse with a removable roof',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'at least two bodies', pass: (probe?.bodies?.length ?? 0) >= 2 }],
}
