import { describe, expect, it } from 'vitest'
import { resolveLookAt } from '../src/aiViewParts.js'

// The centers the caller's measurement would return, keyed by part index; the
// resolver only ever hands the index back to measurePart and returns its answer.
const CENTERS = { 0: [7, 0, 2.5], 2: [-7, 0, 2.5], 4: [1, 2, 3] }
const measurePart = (index) => CENTERS[index]

// A car's parts: each index is where the part lands in the flattened geometry
// `main()` returns, each path its hierarchical param path.
const ctx = {
  partPaths: [
    { path: 'front.left', index: 0 },
    { path: 'body', index: 4 },
  ],
  measurePart,
}

// Two parts whose last segment is the same, so the short name `left` cannot pick.
const ctxDup = {
  partPaths: [
    { path: 'front.left', index: 0 },
    { path: 'rear.left', index: 2 },
  ],
  measurePart,
}

describe('resolveLookAt', () => {
  it('resolves a dotted part path to its centroid', async () => {
    expect(await resolveLookAt({ kind: 'lookAtPart', part: 'front.left' }, ctx)).toEqual([7, 0, 2.5])
  })

  it('resolves a leaf name to the single part that ends with it', async () => {
    expect(await resolveLookAt({ kind: 'lookAtPart', part: 'body' }, ctx)).toEqual([1, 2, 3])
  })

  it('lets an exact dotted path win over a shorter nested path', async () => {
    const nested = {
      partPaths: [
        { path: 'front.left', index: 0 },
        { path: 'car.front.left', index: 2 },
      ],
      measurePart,
    }
    expect(await resolveLookAt({ kind: 'lookAtPart', part: 'front.left' }, nested)).toEqual([7, 0, 2.5])
  })

  it('throws PartNotFoundError for a name no part has', async () => {
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'nope' }, ctx)).rejects.toThrowError(/PartNotFound/)
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'nope' }, ctx)).rejects.toMatchObject({ name: 'PartNotFoundError' })
  })

  it('throws AmbiguousPartError when a short name matches several parts', async () => {
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'left' }, ctxDup)).rejects.toThrowError(/Ambiguous/)
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'left' }, ctxDup)).rejects.toMatchObject({ name: 'AmbiguousPartError' })
  })

  it('never substring-matches: a longer sibling segment is not a match', async () => {
    const substringy = { partPaths: [{ path: 'front.leftover', index: 0 }], measurePart }
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'left' }, substringy)).rejects.toThrowError(/PartNotFound/)
  })

  it('treats traversal and empty segments as not found', async () => {
    await expect(resolveLookAt({ kind: 'lookAtPart', part: '../secret' }, ctx)).rejects.toThrowError(/PartNotFound/)
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'front..left' }, ctx)).rejects.toThrowError(/PartNotFound/)
    await expect(resolveLookAt({ kind: 'lookAtPart', part: 'front/left' }, ctx)).rejects.toThrowError(/PartNotFound/)
  })

  it('passes a raw point through after checking it is three finite numbers', async () => {
    expect(await resolveLookAt({ kind: 'lookAt', point: [1, 2, 3] }, ctx)).toEqual([1, 2, 3])
    await expect(resolveLookAt({ kind: 'lookAt', point: [1, 2] }, ctx)).rejects.toThrowError(/three/)
    await expect(resolveLookAt({ kind: 'lookAt', point: [1, 2, NaN] }, ctx)).rejects.toThrowError(/three/)
  })

  it('refuses a spec that is not a look-at aim', async () => {
    await expect(resolveLookAt({ kind: 'preset', preset: 'top' }, ctx)).rejects.toThrowError(/lookAt/)
  })
})
