import { describe, it, expect } from 'vitest'
import { CodeGenState } from '../../src/transpiler/managers/CodeGenState.js'

describe('CodeGenState', () => {
  describe('initialization', () => {
    it('should initialize with empty sets and false flags', () => {
      const state = new CodeGenState()

      expect(state.usedPrimitives.size).toBe(0)
      expect(state.usedTransforms.size).toBe(0)
      expect(state.usedBooleans.size).toBe(0)
      expect(state.usedExtrusions.size).toBe(0)
      expect(state.usedHelpers.size).toBe(0)
      expect(state.usedColors).toBe(false)
      expect(state.usedHulls).toBe(false)
      expect(state.usedMaths).toBe(false)
      expect(state.usedMinMax).toBe(false)
    })
  })

  describe('tracking usage', () => {
    it('should track primitives', () => {
      const state = new CodeGenState()
      state.usedPrimitives.add('cube')
      state.usedPrimitives.add('sphere')

      expect(state.usedPrimitives.has('cube')).toBe(true)
      expect(state.usedPrimitives.has('sphere')).toBe(true)
      expect(state.usedPrimitives.size).toBe(2)
    })

    it('should track transforms', () => {
      const state = new CodeGenState()
      state.usedTransforms.add('translate')
      state.usedTransforms.add('rotate')

      expect(state.usedTransforms.has('translate')).toBe(true)
      expect(state.usedTransforms.has('rotate')).toBe(true)
      expect(state.usedTransforms.size).toBe(2)
    })

    it('should track booleans', () => {
      const state = new CodeGenState()
      state.usedBooleans.add('union')
      state.usedBooleans.add('difference')

      expect(state.usedBooleans.has('union')).toBe(true)
      expect(state.usedBooleans.has('difference')).toBe(true)
      expect(state.usedBooleans.size).toBe(2)
    })

    it('should track extrusions', () => {
      const state = new CodeGenState()
      state.usedExtrusions.add('linear_extrude')

      expect(state.usedExtrusions.has('linear_extrude')).toBe(true)
      expect(state.usedExtrusions.size).toBe(1)
    })

    it('should track helpers', () => {
      const state = new CodeGenState()
      state.usedHelpers.add('echo')

      expect(state.usedHelpers.has('echo')).toBe(true)
      expect(state.usedHelpers.size).toBe(1)
    })

    it('should track boolean flags', () => {
      const state = new CodeGenState()

      state.usedColors = true
      state.usedHulls = true
      state.usedMaths = true
      state.usedMinMax = true

      expect(state.usedColors).toBe(true)
      expect(state.usedHulls).toBe(true)
      expect(state.usedMaths).toBe(true)
      expect(state.usedMinMax).toBe(true)
    })
  })

  describe('clone()', () => {
    it('should create a deep copy of all sets', () => {
      const state = new CodeGenState()
      state.usedPrimitives.add('cube')
      state.usedTransforms.add('translate')
      state.usedBooleans.add('union')
      state.usedExtrusions.add('linear_extrude')
      state.usedHelpers.add('echo')

      const clone = state.clone()

      // Verify clone has same contents
      expect(clone.usedPrimitives.has('cube')).toBe(true)
      expect(clone.usedTransforms.has('translate')).toBe(true)
      expect(clone.usedBooleans.has('union')).toBe(true)
      expect(clone.usedExtrusions.has('linear_extrude')).toBe(true)
      expect(clone.usedHelpers.has('echo')).toBe(true)

      // Verify sets are independent
      state.usedPrimitives.add('sphere')
      expect(state.usedPrimitives.has('sphere')).toBe(true)
      expect(clone.usedPrimitives.has('sphere')).toBe(false)
    })

    it('should copy boolean flags', () => {
      const state = new CodeGenState()
      state.usedColors = true
      state.usedHulls = true
      state.usedMaths = true
      state.usedMinMax = true

      const clone = state.clone()

      expect(clone.usedColors).toBe(true)
      expect(clone.usedHulls).toBe(true)
      expect(clone.usedMaths).toBe(true)
      expect(clone.usedMinMax).toBe(true)

      // Verify independence
      state.usedColors = false
      expect(clone.usedColors).toBe(true)
    })

    it('should handle empty state', () => {
      const state = new CodeGenState()
      const clone = state.clone()

      expect(clone.usedPrimitives.size).toBe(0)
      expect(clone.usedTransforms.size).toBe(0)
      expect(clone.usedBooleans.size).toBe(0)
      expect(clone.usedExtrusions.size).toBe(0)
      expect(clone.usedHelpers.size).toBe(0)
      expect(clone.usedColors).toBe(false)
      expect(clone.usedHulls).toBe(false)
      expect(clone.usedMaths).toBe(false)
      expect(clone.usedMinMax).toBe(false)
    })
  })

  describe('mergeFrom()', () => {
    it('should merge all sets', () => {
      const state1 = new CodeGenState()
      state1.usedPrimitives.add('cube')
      state1.usedTransforms.add('translate')

      const state2 = new CodeGenState()
      state2.usedPrimitives.add('sphere')
      state2.usedBooleans.add('union')

      state1.mergeFrom(state2)

      expect(state1.usedPrimitives.has('cube')).toBe(true)
      expect(state1.usedPrimitives.has('sphere')).toBe(true)
      expect(state1.usedTransforms.has('translate')).toBe(true)
      expect(state1.usedBooleans.has('union')).toBe(true)
    })

    it('should OR boolean flags', () => {
      const state1 = new CodeGenState()
      state1.usedColors = true
      state1.usedHulls = false

      const state2 = new CodeGenState()
      state2.usedColors = false
      state2.usedHulls = true
      state2.usedMaths = true

      state1.mergeFrom(state2)

      expect(state1.usedColors).toBe(true)  // true || false = true
      expect(state1.usedHulls).toBe(true)   // false || true = true
      expect(state1.usedMaths).toBe(true)   // false || true = true
      expect(state1.usedMinMax).toBe(false) // false || false = false
    })

    it('should handle duplicate entries', () => {
      const state1 = new CodeGenState()
      state1.usedPrimitives.add('cube')

      const state2 = new CodeGenState()
      state2.usedPrimitives.add('cube')
      state2.usedPrimitives.add('sphere')

      state1.mergeFrom(state2)

      expect(state1.usedPrimitives.size).toBe(2)
      expect(state1.usedPrimitives.has('cube')).toBe(true)
      expect(state1.usedPrimitives.has('sphere')).toBe(true)
    })

    it('should not modify source state', () => {
      const state1 = new CodeGenState()
      state1.usedPrimitives.add('cube')

      const state2 = new CodeGenState()
      state2.usedPrimitives.add('sphere')

      state1.mergeFrom(state2)

      expect(state2.usedPrimitives.size).toBe(1)
      expect(state2.usedPrimitives.has('sphere')).toBe(true)
      expect(state2.usedPrimitives.has('cube')).toBe(false)
    })

    it('should handle merging empty state', () => {
      const state1 = new CodeGenState()
      state1.usedPrimitives.add('cube')
      state1.usedColors = true

      const state2 = new CodeGenState()

      state1.mergeFrom(state2)

      expect(state1.usedPrimitives.has('cube')).toBe(true)
      expect(state1.usedColors).toBe(true)
    })
  })

  describe('real-world usage patterns', () => {
    it('should support nested transpilation workflow', () => {
      // Parent context
      const parent = new CodeGenState()
      parent.usedPrimitives.add('cube')
      parent.usedColors = true

      // Clone for child context
      const child = parent.clone()
      child.usedPrimitives.add('sphere')
      child.usedTransforms.add('translate')
      child.usedHulls = true

      // Merge child back into parent
      parent.mergeFrom(child)

      expect(parent.usedPrimitives.has('cube')).toBe(true)
      expect(parent.usedPrimitives.has('sphere')).toBe(true)
      expect(parent.usedTransforms.has('translate')).toBe(true)
      expect(parent.usedColors).toBe(true)
      expect(parent.usedHulls).toBe(true)
    })
  })
})
