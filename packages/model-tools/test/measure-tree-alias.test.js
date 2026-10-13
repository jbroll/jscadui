// In the frame worker '@jscad/modeling' resolves to the engine's tree bundle,
// whose `measurements` are async eager reads over deferred nodes. model-tools
// measures already-evaluated solids, so it must get synchronous numbers; an
// async measurement leaks a Promise into the measure result, which postMessage
// then refuses to clone (DataCloneError). This mirrors that alias.
import { expect, test, vi } from 'vitest'

vi.mock('@jscad/modeling', async () => {
  const modeling = (await vi.importActual('@jscad/modeling')).default
  const { createModelTree } = await import('@jscadui/model-tree')
  const tree = createModelTree(modeling)
  return { default: { ...modeling, measurements: tree.measurements, geometries: tree.geometries } }
})

const modeling = (await import('@jscad/modeling')).default
const { measure } = await import('../index.js')

const deepPromises = (value) => {
  if (value instanceof Promise) return true
  if (Array.isArray(value)) return value.some(deepPromises)
  if (value && typeof value === 'object') return Object.values(value).some(deepPromises)
  return false
}

test('measure over evaluated solids posts sync numbers, not Promises', () => {
  const m = measure(modeling.primitives.cuboid({ size: [10, 10, 10] }))
  expect(deepPromises(m)).toBe(false)
  expect(m.dimensions).toEqual([10, 10, 10])
  expect(m.volume).toBeCloseTo(1000, 3)
})
