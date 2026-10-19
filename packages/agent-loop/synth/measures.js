// Guarded readers over the browser's measure({}) and check({}) results, so a
// scenario's checks return booleans on any shape.
export const dims = (m) => {
  const d = m?.dimensions
  return Array.isArray(d) && d.length === 3 ? d.map(Number) : [0, 0, 0]
}

export const sortedDims = (m) => dims(m).sort((a, b) => a - b)

export const volume = (m) => (Number.isFinite(m?.volume) ? m.volume : 0)

// Share of the bounding box the solid fills; 0 when either is missing.
export const fill = (m) => {
  const [a, b, c] = dims(m)
  const box = a * b * c
  return box > 0 ? volume(m) / box : 0
}

export const between = (x, lo, hi) => x >= lo && x <= hi

export const watertight = (solid) => solid?.watertight === true
