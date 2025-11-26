import { describe, it, expect, beforeEach } from 'vitest'
import { createParamsController } from './ParamsController.js'
import { createParamsProxy, createProxyState, buildParamTree, extractDefaults, getLinkedParamPaths } from '@jscadui/params-core'

describe('getLinkedParamPaths', () => {
  it('should link params at exact hierarchy level', () => {
    // This matches the hierarchical-car structure exactly
    const types = new Map([
      ['front', 'Axle'],
      ['front.left', 'Wheel'],
      ['front.right', 'Wheel'],
      ['rear', 'Axle'],
      ['rear.left', 'Wheel'],
      ['rear.right', 'Wheel'],
    ])

    const classes = new Map([
      ['front.left', 'front-wheels'],
      ['front.right', 'front-wheels'],
      ['rear.left', 'rear-wheels'],
      ['rear.right', 'rear-wheels'],
    ])

    // Test: changing front.left.tireColor should link to front.right.tireColor
    const linked = getLinkedParamPaths(types, classes, 'front.left.tireColor')
    expect(linked.sort()).toEqual(['front.left.tireColor', 'front.right.tireColor'])

    // Test: changing rear.left.tireColor should link to rear.right.tireColor
    const linkedRear = getLinkedParamPaths(types, classes, 'rear.left.tireColor')
    expect(linkedRear.sort()).toEqual(['rear.left.tireColor', 'rear.right.tireColor'])

    // Test: front and rear should NOT be linked (different classes)
    const frontOnly = getLinkedParamPaths(types, classes, 'front.left.hubColor')
    expect(frontOnly).not.toContain('rear.left.hubColor')
    expect(frontOnly).not.toContain('rear.right.hubColor')
  })

  it('should handle params with Object types/classes (from worker serialization)', () => {
    // Worker sends Objects, which get converted to Maps
    const typesObj = {
      'front': 'Axle',
      'front.left': 'Wheel',
      'front.right': 'Wheel',
    }

    const classesObj = {
      'front.left': 'front-wheels',
      'front.right': 'front-wheels',
    }

    // Convert like getMaps does
    const types = new Map(Object.entries(typesObj))
    const classes = new Map(Object.entries(classesObj))

    const linked = getLinkedParamPaths(types, classes, 'front.left.tireColor')
    expect(linked.sort()).toEqual(['front.left.tireColor', 'front.right.tireColor'])
  })
})

describe('ParamsController', () => {
  describe('basic setParam', () => {
    it('should update params and track user interaction', () => {
      const ctrl = createParamsController()

      // Simulate initial script load result
      ctrl.initFromResult({
        proxyState: {
          types: {},
          classes: {},
          discovered: [
            { path: 'radius', name: 'radius', parent: '', default: 5, type: 'number' }
          ]
        },
        params: { radius: 5 }
      })

      // User changes radius
      const linkedPaths = ctrl.setParam('radius', 10)

      expect(linkedPaths).toEqual(['radius'])
      expect(ctrl.params.radius).toBe(10)
      expect(ctrl.userInteracted.has('radius')).toBe(true)
    })
  })

  describe('class linking', () => {
    let ctrl

    beforeEach(() => {
      ctrl = createParamsController()

      // Simulate a car model with linked wheels
      ctrl.initFromResult({
        proxyState: {
          types: {
            'front.left': 'Wheel',
            'front.right': 'Wheel',
            'rear.left': 'Wheel',
            'rear.right': 'Wheel',
          },
          classes: {
            'front.left': 'front-wheels',
            'front.right': 'front-wheels',
            'rear.left': 'rear-wheels',
            'rear.right': 'rear-wheels',
          },
          discovered: [
            { path: 'front.left.tireColor', name: 'tireColor', parent: 'front.left', default: '#333333', type: 'color' },
            { path: 'front.right.tireColor', name: 'tireColor', parent: 'front.right', default: '#333333', type: 'color' },
            { path: 'rear.left.tireColor', name: 'tireColor', parent: 'rear.left', default: '#333333', type: 'color' },
            { path: 'rear.right.tireColor', name: 'tireColor', parent: 'rear.right', default: '#333333', type: 'color' },
          ]
        },
        params: {
          'front.left.tireColor': '#333333',
          'front.right.tireColor': '#333333',
          'rear.left.tireColor': '#333333',
          'rear.right.tireColor': '#333333',
        }
      })
    })

    it('should propagate changes to linked parts in same class', () => {
      // User changes front left tire color
      const linkedPaths = ctrl.setParam('front.left.tireColor', '#ff0000')

      // Should update both front wheels (same class)
      expect(linkedPaths.sort()).toEqual(['front.left.tireColor', 'front.right.tireColor'])
      expect(ctrl.params['front.left.tireColor']).toBe('#ff0000')
      expect(ctrl.params['front.right.tireColor']).toBe('#ff0000')

      // Rear wheels should NOT be updated (different class)
      expect(ctrl.params['rear.left.tireColor']).toBe('#333333')
      expect(ctrl.params['rear.right.tireColor']).toBe('#333333')
    })

    it('should mark all linked paths as user interacted', () => {
      ctrl.setParam('front.left.tireColor', '#ff0000')

      expect(ctrl.userInteracted.has('front.left.tireColor')).toBe(true)
      expect(ctrl.userInteracted.has('front.right.tireColor')).toBe(true)
    })

    it('should return correct worker params after setParam', () => {
      ctrl.setParam('front.left.tireColor', '#ff0000')

      const workerParams = ctrl.getWorkerParams()

      expect(workerParams.params['front.left.tireColor']).toBe('#ff0000')
      expect(workerParams.params['front.right.tireColor']).toBe('#ff0000')
      expect(workerParams.userInteractedPaths).toContain('front.left.tireColor')
      expect(workerParams.userInteractedPaths).toContain('front.right.tireColor')
    })
  })

  describe('end-to-end: UI change -> proxy -> model value', () => {
    it('should flow user changes through to model execution', () => {
      const ctrl = createParamsController()

      // Step 1: Initial script run discovers params
      const state1 = createProxyState()
      const proxy1 = createParamsProxy(state1)

      // Simulate model code - just access child proxies directly, don't assign {}
      const wheel = (params) => {
        params._type = 'Wheel'
        params.tireColor = { type: 'color', default: '#333333' }
        return { color: params.tireColor }  // Return what the model "sees"
      }

      const main = (params) => {
        // Just access child proxies - they auto-create
        params.front.left._class = 'front-wheels'
        params.front.right._class = 'front-wheels'

        return {
          leftWheel: wheel(params.front.left),
          rightWheel: wheel(params.front.right),
        }
      }

      const result1 = main(proxy1)

      // Verify initial state
      expect(result1.leftWheel.color).toBe('#333333')
      expect(result1.rightWheel.color).toBe('#333333')

      // Step 2: Initialize controller from discovery result
      const discovered = state1.discovered
      const defaults = extractDefaults(discovered)

      ctrl.initFromResult({
        proxyState: {
          types: Object.fromEntries(state1.types),
          classes: Object.fromEntries(state1.classes),
          discovered,
        },
        params: defaults
      })

      // Step 3: User changes tire color via UI
      ctrl.setParam('front.left.tireColor', '#ff0000')

      // Verify controller state
      expect(ctrl.params['front.left.tireColor']).toBe('#ff0000')
      expect(ctrl.params['front.right.tireColor']).toBe('#ff0000')  // Linked!

      // Step 4: Run model again with user values
      const workerParams = ctrl.getWorkerParams()
      const state2 = createProxyState(workerParams.params, new Set(workerParams.userInteractedPaths))
      const proxy2 = createParamsProxy(state2)

      const result2 = main(proxy2)

      // THIS IS THE KEY TEST: Model should see the user's color
      expect(result2.leftWheel.color).toBe('#ff0000')
      expect(result2.rightWheel.color).toBe('#ff0000')
    })

    it('should handle nested wheel params like hierarchical-car', () => {
      const ctrl = createParamsController()

      // Step 1: Initial script run
      const state1 = createProxyState()
      const proxy1 = createParamsProxy(state1)

      // More realistic model structure (like hierarchical-car)
      const wheel = (params) => {
        params._type = 'Wheel'
        params.tireColor = { type: 'color', default: '#333333', caption: 'Tire Color' }
        params.spokeStyle = { type: 'choice', default: 'solid', values: ['solid', 'spoked'] }

        // Model uses the values
        const usedTireColor = params.tireColor
        const usedSpokeStyle = params.spokeStyle

        return { tireColor: usedTireColor, spokeStyle: usedSpokeStyle }
      }

      const axle = (params) => {
        params._type = 'Axle'
        params.width = { type: 'slider', default: 12 }

        // Access child proxies
        const leftResult = wheel(params.left)
        const rightResult = wheel(params.right)

        return { left: leftResult, right: rightResult }
      }

      const main = (params) => {
        params._type = 'Car'

        // Set up class linking BEFORE accessing wheel params
        params.front.left._class = 'front-wheels'
        params.front.right._class = 'front-wheels'

        const frontAxle = axle(params.front)

        return { front: frontAxle }
      }

      const result1 = main(proxy1)

      // Verify initial
      expect(result1.front.left.tireColor).toBe('#333333')
      expect(result1.front.left.spokeStyle).toBe('solid')

      // Step 2: Init controller
      const discovered = state1.discovered
      const defaults = extractDefaults(discovered)

      ctrl.initFromResult({
        proxyState: {
          types: Object.fromEntries(state1.types),
          classes: Object.fromEntries(state1.classes),
          discovered,
        },
        params: defaults
      })

      // Verify types and classes were captured
      expect(ctrl.proxyState.types['front.left']).toBe('Wheel')
      expect(ctrl.proxyState.classes['front.left']).toBe('front-wheels')
      expect(ctrl.proxyState.classes['front.right']).toBe('front-wheels')

      // Step 3: User changes tire color
      const linkedPaths = ctrl.setParam('front.left.tireColor', '#ff0000')

      // Should link both front wheels
      expect(linkedPaths.sort()).toEqual(['front.left.tireColor', 'front.right.tireColor'])

      // Step 4: Re-run model
      const workerParams = ctrl.getWorkerParams()
      const state2 = createProxyState(workerParams.params, new Set(workerParams.userInteractedPaths))
      const proxy2 = createParamsProxy(state2)

      const result2 = main(proxy2)

      // Verify model receives new values
      expect(result2.front.left.tireColor).toBe('#ff0000')
      expect(result2.front.right.tireColor).toBe('#ff0000')
    })

    it('should handle exact hierarchical-car structure', () => {
      const ctrl = createParamsController()

      // Step 1: Initial run - exact structure from hierarchical-car
      const state1 = createProxyState()
      const proxy1 = createParamsProxy(state1)

      // Matches hierarchical-car.js exactly
      const wheel = (params) => {
        params._type = 'Wheel'
        params.tireColor = { type: 'color', default: '#333333', caption: 'Tire Color' }

        const tireColorValue = params.tireColor
        return { color: tireColorValue }
      }

      const axle = (params) => {
        params._type = 'Axle'
        params.width = { type: 'slider', default: 12 }

        const halfWidth = params.width / 2
        params.left._offset = -halfWidth  // Setting hidden param on child
        params.right._offset = halfWidth

        const leftWheel = wheel(params.left)
        const rightWheel = wheel(params.right)

        return { left: leftWheel, right: rightWheel }
      }

      const main = (params) => {
        params._type = 'Car'
        params.wheelbase = { type: 'slider', default: 14 }

        // Class linking
        params.front.left._class = 'front-wheels'
        params.front.right._class = 'front-wheels'
        params.rear.left._class = 'rear-wheels'
        params.rear.right._class = 'rear-wheels'

        const frontAxle = axle(params.front)
        const rearAxle = axle(params.rear)

        return { front: frontAxle, rear: rearAxle }
      }

      const result1 = main(proxy1)

      // Verify initial
      expect(result1.front.left.color).toBe('#333333')
      expect(result1.front.right.color).toBe('#333333')
      expect(result1.rear.left.color).toBe('#333333')
      expect(result1.rear.right.color).toBe('#333333')

      // Step 2: Init controller
      const discovered = state1.discovered
      const defaults = extractDefaults(discovered)

      ctrl.initFromResult({
        proxyState: {
          types: Object.fromEntries(state1.types),
          classes: Object.fromEntries(state1.classes),
          discovered,
        },
        params: defaults
      })

      // Verify structure was captured correctly
      expect(ctrl.proxyState.types['front.left']).toBe('Wheel')
      expect(ctrl.proxyState.classes['front.left']).toBe('front-wheels')
      expect(ctrl.proxyState.classes['front.right']).toBe('front-wheels')
      expect(ctrl.proxyState.classes['rear.left']).toBe('rear-wheels')
      expect(ctrl.proxyState.classes['rear.right']).toBe('rear-wheels')

      // Verify defaults include tireColor
      expect(ctrl.params['front.left.tireColor']).toBe('#333333')

      // Step 3: User changes front left tire color
      const linkedPaths = ctrl.setParam('front.left.tireColor', '#ff0000')

      // Should link front wheels but NOT rear wheels
      expect(linkedPaths.sort()).toEqual(['front.left.tireColor', 'front.right.tireColor'])
      expect(ctrl.params['front.left.tireColor']).toBe('#ff0000')
      expect(ctrl.params['front.right.tireColor']).toBe('#ff0000')
      expect(ctrl.params['rear.left.tireColor']).toBe('#333333')  // Unchanged
      expect(ctrl.params['rear.right.tireColor']).toBe('#333333')  // Unchanged

      // Step 4: Re-run model
      const workerParams = ctrl.getWorkerParams()
      const state2 = createProxyState(workerParams.params, new Set(workerParams.userInteractedPaths))
      const proxy2 = createParamsProxy(state2)

      const result2 = main(proxy2)

      // CRITICAL: Model should see user's red color for front wheels only
      expect(result2.front.left.color).toBe('#ff0000')
      expect(result2.front.right.color).toBe('#ff0000')
      expect(result2.rear.left.color).toBe('#333333')
      expect(result2.rear.right.color).toBe('#333333')
    })

    it('should handle spokeStyle choice changes', () => {
      const ctrl = createParamsController()

      // Step 1: Initial run
      const state1 = createProxyState()
      const proxy1 = createParamsProxy(state1)

      const wheel = (params) => {
        params._type = 'Wheel'
        params.spokeStyle = { type: 'choice', default: 'solid', values: ['solid', 'spoked', 'sport'] }

        // Conditional logic based on spokeStyle (like real model)
        if (params.spokeStyle === 'solid') {
          return { hubType: 'cylinder' }
        } else {
          return { hubType: 'spoked', spokeCount: 5 }
        }
      }

      const main = (params) => {
        // Just access child proxy directly - don't assign {}
        return wheel(params.front.left)
      }

      const result1 = main(proxy1)
      expect(result1.hubType).toBe('cylinder')  // Default is 'solid'

      // Step 2: Init controller
      ctrl.initFromResult({
        proxyState: {
          types: Object.fromEntries(state1.types),
          classes: Object.fromEntries(state1.classes),
          discovered: state1.discovered,
        },
        params: extractDefaults(state1.discovered)
      })

      // Step 3: User changes spoke style
      ctrl.setParam('front.left.spokeStyle', 'spoked')

      // Step 4: Re-run
      const workerParams = ctrl.getWorkerParams()
      const state2 = createProxyState(workerParams.params, new Set(workerParams.userInteractedPaths))
      const proxy2 = createParamsProxy(state2)

      const result2 = main(proxy2)

      // Model should now take the 'else' branch
      expect(result2.hubType).toBe('spoked')
    })
  })
})
