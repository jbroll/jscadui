// No gate for the tipping bed: the judge rules on the whole object.
export const fixture = {
  name: 'dump-truck',
  group: 'complex',
  prompt: 'a toy dump truck where the bed tips up',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: () => [],
}
