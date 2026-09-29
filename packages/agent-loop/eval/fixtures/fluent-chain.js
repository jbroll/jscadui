// A dot right before subtract/union/intersect also matches jf.subtract(...), so
// this alone can't tell a method chain from a free call; noFreeCombine does.
const METHOD_COMBINE = /\.(subtract|union|intersect)\(/
const FREE_COMBINE = /\bjf\.(subtract|union|intersect)\(/

export const fixture = {
  name: 'fluent-chain',
  prompt: 'A 30mm cube with holes through it along all three axes',
  api: 'fluent',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  target: { dimensions: [30, 30, 30] },
  checks: (m, { source = '', solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    return [
      { name: '30mm extents', pass: dims.every((d) => Math.abs(d - 30) < 0.5) },
      { name: 'holes remove material but leave most of it', pass: volume < 27000 * 0.9 && volume > 27000 * 0.5 },
      { name: 'method combine', pass: METHOD_COMBINE.test(source) },
      { name: 'no free combine', pass: !FREE_COMBINE.test(source) },
      { name: 'fluent only', pass: !source.includes('@jscad/modeling') },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
