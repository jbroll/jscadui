import { test, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { createModelTree } from '../src/index.js'

// Model code consumes vectorText/vectorChar output as plain data (`.forEach`,
// index reads, `.segments`), exactly as it does on the eager engine. Wrapping
// them in a Promise breaks that; only genuinely async font IO stays deferred.
test('vectorText stays synchronous data, not a Promise of a node', () => {
  const t = createModelTree(modeling)
  const segments = t.text.vectorText({ x: 0, y: 0, input: 'AB' })
  expect(segments).not.toBeInstanceOf(Promise)
  expect(Array.isArray(segments)).toBe(true)
  expect(segments.every(Array.isArray)).toBe(true)
})

test('vectorChar stays synchronous data', () => {
  const t = createModelTree(modeling)
  const char = t.text.vectorChar({ x: 0, y: 0 }, 'A')
  expect(char).not.toBeInstanceOf(Promise)
  expect(Array.isArray(char.segments)).toBe(true)
})

test('an async text function still resolves to a literal node', async () => {
  const geom = { isA: () => true }
  const t = createModelTree({ text: { later: async () => geom } })
  const out = t.text.later()
  expect(typeof out.then).toBe('function')
  const node = await out
  expect(node).toMatchObject({ op: 'literal', isTreeNode: true, value: geom })
})
