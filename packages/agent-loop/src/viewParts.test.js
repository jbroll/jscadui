import { describe, expect, it } from 'vitest'
import { resolveLookAt } from './viewParts.js'

// The origins a build's auto-attached anchors would report, keyed by part path;
// the resolver only ever reads a name's frame origin from the map.
const frames = new Map([
  ['front.left', [7, -6, 0]],
  ['body', [0, 0, 4.5]],
])

// Two parts whose last segment is the same, so the short name `left` cannot pick.
const dupFrames = new Map([
  ['front.left', [7, -6, 0]],
  ['rear.left', [-7, -6, 0]],
])

describe('resolveLookAt', () => {
  it('resolves a dotted part path to its frame origin', () => {
    expect(resolveLookAt({ kind: 'lookAtPart', part: 'front.left' }, { anchorFrames: frames })).toEqual([7, -6, 0])
  })

  it('resolves a leaf name to the single part that ends with it', () => {
    expect(resolveLookAt({ kind: 'lookAtPart', part: 'body' }, { anchorFrames: frames })).toEqual([0, 0, 4.5])
  })

  it('lets an exact dotted path win over a shorter nested path', () => {
    const nested = new Map([
      ['front.left', [7, -6, 0]],
      ['car.front.left', [1, 2, 3]],
    ])
    expect(resolveLookAt({ kind: 'lookAtPart', part: 'front.left' }, { anchorFrames: nested })).toEqual([7, -6, 0])
  })

  it('throws PartNotFoundError for a name no part has', () => {
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'nope' }, { anchorFrames: frames })).toThrowError(/PartNotFound/)
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'nope' }, { anchorFrames: frames })).toThrowError(
      expect.objectContaining({ name: 'PartNotFoundError' }),
    )
  })

  it('throws AmbiguousPartError when a short name matches several parts', () => {
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'left' }, { anchorFrames: dupFrames })).toThrowError(/Ambiguous/)
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'left' }, { anchorFrames: dupFrames })).toThrowError(
      expect.objectContaining({ name: 'AmbiguousPartError' }),
    )
  })

  it('never substring-matches: a longer sibling segment is not a match', () => {
    const substringy = new Map([['front.leftover', [1, 2, 3]]])
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'left' }, { anchorFrames: substringy })).toThrowError(/PartNotFound/)
  })

  it('treats traversal and empty segments as not found', () => {
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: '../secret' }, { anchorFrames: frames })).toThrowError(/PartNotFound/)
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'front..left' }, { anchorFrames: frames })).toThrowError(/PartNotFound/)
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'front/left' }, { anchorFrames: frames })).toThrowError(/PartNotFound/)
  })

  it('reads no frames when the build attached none', () => {
    expect(() => resolveLookAt({ kind: 'lookAtPart', part: 'body' }, {})).toThrowError(/PartNotFound/)
  })

  it('passes a raw point through after checking it is three finite numbers', () => {
    expect(resolveLookAt({ kind: 'lookAt', point: [1, 2, 3] }, { anchorFrames: frames })).toEqual([1, 2, 3])
    expect(() => resolveLookAt({ kind: 'lookAt', point: [1, 2] }, {})).toThrowError(/three/)
    expect(() => resolveLookAt({ kind: 'lookAt', point: [1, 2, NaN] }, {})).toThrowError(/three/)
  })

  it('refuses a spec that is not a look-at aim', () => {
    expect(() => resolveLookAt({ kind: 'preset', preset: 'top' }, {})).toThrowError(/lookAt/)
  })
})
