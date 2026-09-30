// The multi-turn case: the judge reads both messages, so a single-stage rocket with fins all round fails.
export const fixture = {
  name: 'rocket-revised',
  group: 'complex',
  prompt: 'a model rocket about 20cm tall',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [{ message: 'can you make it two stages, with fins only on the bottom one' }],
  gates: (m) => {
    const tallest = Math.max(0, ...(m?.dimensions ?? []))
    return [{ name: 'tallest size 180 to 220 mm', pass: tallest >= 180 && tallest <= 220 }]
  },
}
