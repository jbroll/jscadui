// 60x40x30 open-top shell (2mm walls/floor) plus four cornered, drilled screw posts.
export const fixture = {
  name: 'enclosure',
  prompt:
    'A 60 by 40 by 30mm project box, open at the top, with 2mm walls and floor, and four 6mm diameter, 8mm tall screw posts inside the corners, each with a 2.5mm hole.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [30, 40, 60], volume: 16295 },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '60 x 40 x 30 outer', pass: Math.abs(a - 30) < 0.5 && Math.abs(b - 40) < 0.5 && Math.abs(c - 60) < 0.5 },
      // shell + floor + 4 posts - 4 post holes, at 32-64 segments: 16295-16298 mm3.
      { name: 'volume near 16296', pass: volume > 15800 && volume < 16800 },
      { name: 'hollow, open top', pass: volume < 30000 },
    ]
  },
}
