// Pegboard panel: a flat plate with a grid of holes, size and pitch unstated.
export const fixture = {
  name: 'pegboard',
  group: 'regression',
  prompt: 'A pegboard panel for my workbench wall',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid } = {}) => {
    const [thickness, mid, largest] = [...(m?.dimensions ?? [0, 0, 0])].sort((a, b) => a - b)
    const volume = m?.volume ?? 0
    const bboxVolume = thickness * mid * largest
    return [
      { name: 'flat panel', pass: mid > 0 && thickness < mid * 0.15 },
      { name: 'panel-sized', pass: mid >= 100 && mid <= 1000 && largest >= 100 && largest <= 1000 },
      // 5mm holes on a 1 inch pitch remove only about 3% of the plate.
      { name: 'has holes', pass: volume > 0 && volume < bboxVolume * 0.99 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
