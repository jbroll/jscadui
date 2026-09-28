// 12-tooth gear: point-list profile group, so exact tooth geometry isn't checkable from bbox/volume.
export const fixture = {
  name: 'gear',
  group: 'profiles',
  prompt: 'A 12-tooth gear, about 40mm across',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m, { solid } = {}) => {
    const dims = [...(m?.dimensions ?? [0, 0, 0])].sort((a, b) => a - b)
    const [thickness, mid, largest] = dims
    return [
      { name: 'about 40mm across', pass: largest >= 36 && largest <= 44 && mid >= 36 && mid <= 44 },
      { name: 'thickness 2-20mm', pass: thickness >= 2 && thickness <= 20 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
