// Base plate, a back plate leaning 20 degrees off vertical hinged at the base's rear edge, and a front lip.
export const fixture = {
  name: 'phone-stand',
  prompt:
    'A phone stand: a 80 by 70 by 5mm base plate, a 80 by 100 by 5mm back plate leaning back 20 degrees from vertical, joined at the rear edge of the base, and a 80 by 10 by 10mm front lip on the base.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [80, 106.6, 99.8], volume: 76000 },
  checks: (m) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    return [
      { name: '80mm wide', pass: Math.abs(dims[0] - 80) < 0.5 },
      // three plates, overlap-tolerant since a union can lose a little material where they touch.
      { name: 'volume near 76000', pass: volume > 70000 && volume < 78500 },
      // 100mm back plate at 20 degrees off vertical, hinged 5mm up: 5 + 100*cos(20deg) = 99.9mm.
      { name: 'height near 99.9', pass: Math.abs(dims[2] - 99.8) < 3 },
    ]
  },
}
