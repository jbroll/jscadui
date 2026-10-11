import { describe, it, expect } from 'vitest'
import { CodeGenState } from '../../src/transpiler/managers/CodeGenState.js'

describe('CodeGenState', () => {
  it('starts with no top-level geometry', () => {
    expect(new CodeGenState().hasTopLevelGeometry).toBe(false)
  })

  it('clone() copies the flag independently', () => {
    const state = new CodeGenState()
    state.hasTopLevelGeometry = true

    const clone = state.clone()
    expect(clone.hasTopLevelGeometry).toBe(true)

    state.hasTopLevelGeometry = false
    expect(clone.hasTopLevelGeometry).toBe(true)
  })

  it('mergeFrom() ORs the flag without touching the source', () => {
    const parent = new CodeGenState()
    const child = new CodeGenState()
    child.hasTopLevelGeometry = true

    parent.mergeFrom(child)

    expect(parent.hasTopLevelGeometry).toBe(true)
    expect(child.hasTopLevelGeometry).toBe(true)
  })
})
