// Project box for an Arduino Uno (68.6 x 53.4mm board) with corner screw posts.
export const fixture = {
  name: 'enclosure',
  prompt: 'A small project box for an Arduino Uno, with screw posts in the corners to mount the board',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid } = {}) => {
    const [height, mid, largest] = [...(m?.dimensions ?? [0, 0, 0])].sort((a, b) => a - b)
    const volume = m?.volume ?? 0
    const bboxVolume = height * mid * largest
    return [
      // 250 leaves room for a lid printed beside the base.
      { name: 'fits an Uno footprint', pass: largest >= 70 && largest <= 250 && mid >= 55 && mid <= 200 },
      { name: 'height 15-100mm', pass: height >= 15 && height <= 100 },
      { name: 'hollow enclosure, not a solid block', pass: volume > 0 && volume < bboxVolume * 0.5 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
