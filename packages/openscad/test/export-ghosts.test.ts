import { describe, it, expect } from 'vitest'
import { exportedGeometry } from '../bin/run-jscad.js'

describe('exportedGeometry', () => {
  it('drops preview-only ghosts from a result list', () => {
    const solid = { id: 1 }
    expect(exportedGeometry([solid, { previewOnly: true }])).toEqual([solid])
  })

  it('is null when only ghosts remain', () => {
    expect(exportedGeometry([{ previewOnly: true }])).toBe(null)
  })

  it('passes a single geometry through', () => {
    const solid = { id: 1 }
    expect(exportedGeometry(solid)).toBe(solid)
  })
})
