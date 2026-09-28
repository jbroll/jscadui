// The option is roundRadius; a model that writes radius gets the 0.2 default.
export const fixture = {
  name: 'misspelled-option',
  prompt: 'A 30 by 20 by 10 box with 3mm rounded edges',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [10, 20, 30] },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '10 x 20 x 30', pass: Math.abs(a - 10) < 0.5 && Math.abs(b - 20) < 0.5 && Math.abs(c - 30) < 0.5 },
      // roundRadius 3 gives 5532-5570 mm³ across 16-64 segments; 2.5 and 3.5 fall outside.
      { name: '3mm edge radius', pass: volume > 5480 && volume < 5640 },
    ]
  },
}
