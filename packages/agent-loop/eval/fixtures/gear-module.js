// Tip diameter is module*(teeth+2): 2*(20+2) = 44mm.
export const fixture = {
  name: 'gear-module',
  group: 'profiles',
  prompt: 'Model a spur gear with module 2, 20 teeth and 5mm thick, centered on the origin. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  target: { dimensions: [5, 44, 44] },
  checks: (m) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const box = m?.boundingBox ?? [[0, 0, 0], [0, 0, 0]]
    return [
      { name: '44mm tip diameter in X', pass: Math.abs(dims[0] - 44) < 1 },
      { name: '44mm tip diameter in Y', pass: Math.abs(dims[1] - 44) < 1 },
      { name: '5mm thick', pass: Math.abs(dims[2] - 5) < 0.1 },
      { name: 'centered in Z', pass: Math.abs(box[0][2] + box[1][2]) < 0.1 },
    ]
  },
}
