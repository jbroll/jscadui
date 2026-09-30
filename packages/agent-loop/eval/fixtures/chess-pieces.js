import { connectedGroups } from '../complex.js'

export const fixture = {
  name: 'chess-pieces',
  group: 'complex',
  prompt: 'a chess pawn and a knight',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 2,
  followUps: [],
  gates: (m, { probe } = {}) => [{ name: 'exactly two groups', pass: connectedGroups(probe?.bodies ?? []) === 2 }],
}
