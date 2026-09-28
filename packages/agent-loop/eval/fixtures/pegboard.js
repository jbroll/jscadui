// 100x60x4 plate, a 10x6 grid of 5mm holes on 10mm centers, 5mm in from the edges.
export const fixture = {
  name: 'pegboard',
  prompt: 'A 100 by 60 by 4mm plate with a grid of 5mm holes on 10mm centers, 5mm in from the edges.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [4, 60, 100], volume: 19318 },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '100 x 60 x 4 plate', pass: Math.abs(a - 4) < 0.5 && Math.abs(b - 60) < 0.5 && Math.abs(c - 100) < 0.5 },
      // plate minus a 10x6 grid of 60 holes, at 32-64 segments: 19295-19318 mm3;
      // a wrong (20mm-pitch, 15-hole) grid removes far less: ~22830.
      { name: 'volume implies 60 holes', pass: volume > 18700 && volume < 19900 },
    ]
  },
}
