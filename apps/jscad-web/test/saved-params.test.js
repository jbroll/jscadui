import { describe, expect, it } from 'vitest'
import { PARAMS_FILE, applicableSaved, readSaved, serializeSaved } from '../src/savedParams.js'

describe('readSaved', () => {
  it('is null when the project has no params.json', () => {
    expect(readSaved({ 'main.js': '' })).toBeNull()
  })

  it('reads the saved values', () => {
    expect(readSaved({ [PARAMS_FILE]: '{ "overlap": 36, "body.color": "#ff0000" }' })).toEqual({ values: { overlap: 36, 'body.color': '#ff0000' } })
  })

  it('reports malformed JSON instead of throwing', () => {
    expect(readSaved({ [PARAMS_FILE]: '{ overlap: 36' }).error).toMatch(/params\.json/)
  })

  it('reports JSON that is not an object of values', () => {
    expect(readSaved({ [PARAMS_FILE]: '[36]' }).error).toMatch(/params\.json/)
    expect(readSaved({ [PARAMS_FILE]: 'null' }).error).toMatch(/params\.json/)
  })
})

describe('applicableSaved', () => {
  it('keeps the saved values whose path the code still declares', () => {
    expect(applicableSaved({ overlap: 36, gone: 1 }, { overlap: 25.4, wall: 4 })).toEqual({ overlap: 36 })
  })
})

describe('serializeSaved', () => {
  it('writes the values readSaved reads back', () => {
    const values = { overlap: 36, hardware: '#8-32' }
    expect(readSaved({ [PARAMS_FILE]: serializeSaved(values) })).toEqual({ values })
  })
})
