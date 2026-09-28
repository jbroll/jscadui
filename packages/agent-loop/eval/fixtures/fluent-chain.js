// A dot right before subtract/union/intersect also matches jf.subtract(...), so
// this alone can't tell a method chain from a free call; noFreeCombine does.
const METHOD_COMBINE = /\.(subtract|union|intersect)\(/
const FREE_COMBINE = /\bjf\.(subtract|union|intersect)\(/

export const fixture = {
  name: 'fluent-chain',
  prompt:
    'A 30mm cube with a 10mm diameter hole through it along each axis, in jscad-fluent. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  target: { dimensions: [30, 30, 30] },
  checks: (m, { source = '' } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    return [
      { name: '30mm extents', pass: dims.every((d) => Math.abs(d - 30) < 0.5) },
      // 30mm cube minus three r=5 through-cylinders along X, Y, Z: 21377.4 mm³
      // at 32 segments, 21353.6 at 64; the band covers both ±3%.
      { name: 'volume near 21365', pass: volume > 20700 && volume < 22050 },
      { name: 'method combine', pass: METHOD_COMBINE.test(source) },
      { name: 'no free combine', pass: !FREE_COMBINE.test(source) },
      { name: 'fluent only', pass: !source.includes('@jscad/modeling') },
    ]
  },
}
