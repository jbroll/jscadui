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
      // 100*cos(20deg) = 94mm of rise; where the plate pivots and sits on or beside the base
      // adds 0-7mm, so any height in 93-102 is a fair reading of the request.
      { name: 'height 93-102', pass: dims[2] > 93 && dims[2] < 102 },
      // the lean shows as depth: 70mm base plus 100*sin(20deg) = 34mm behind it. Upright is ~75.
      { name: 'leans back (depth 100-110)', pass: dims[1] > 100 && dims[1] < 110 },
    ]
  },
}
