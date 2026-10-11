import { describe, it, expect } from 'vitest'
import { hasSaveHandle, missingSaveHandleMessage, saveRoute } from '../src/saveFile.js'

describe('saveRoute', () => {
  it('writes a dropped file through its handle', () => {
    expect(saveRoute({ inProject: true, hasHandle: true })).toBe('handle')
    expect(saveRoute({ inProject: false, hasHandle: true })).toBe('handle')
  })

  it('stores a project path through the open project, with no picker', () => {
    expect(saveRoute({ inProject: true, hasHandle: false })).toBe('project')
  })

  it('asks the picker only for a path that is neither a project file nor a handle', () => {
    expect(saveRoute({ inProject: false, hasHandle: false })).toBe('picker')
  })
})

describe('hasSaveHandle', () => {
  it('is true only when there is a handle', () => {
    expect(hasSaveHandle({ createWritable: () => {} })).toBe(true)
    expect(hasSaveHandle(undefined)).toBe(false)
    expect(hasSaveHandle(null)).toBe(false)
  })
})

describe('missingSaveHandleMessage', () => {
  it('names the path and the missing API', () => {
    expect(missingSaveHandleMessage('/part.js')).toContain('/part.js')
    expect(missingSaveHandleMessage('/part.js')).toMatch(/File System Access/)
  })
})
