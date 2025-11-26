import { describe, it, expect, beforeEach } from 'vitest'
import {
  createParamsProxy,
  createProxyState,
  buildParamTree,
  toParamDefinitions,
  extractDefaults,
  getBreadcrumbs,
  getNodeByPath,
  getParamsAtPath,
  getChildParts,
} from './createParamsProxy.js'

describe('createParamsProxy', () => {
  let state
  let params

  beforeEach(() => {
    state = createProxyState()
    params = createParamsProxy(state)
  })

  describe('basic value assignment and retrieval', () => {
    it('should store and retrieve simple values', () => {
      params.radius = 5
      expect(params.radius).toBe(5)
    })

    it('should store and retrieve definition objects, returning default', () => {
      params.radius = { default: 5, min: 1, max: 10 }
      expect(params.radius).toBe(5)
    })

    it('should infer types from values', () => {
      params.count = 5
      params.size = 2.5
      params.enabled = true
      params.name = 'test'

      expect(state.discovered.find(d => d.name === 'count').type).toBe('int')
      expect(state.discovered.find(d => d.name === 'size').type).toBe('number')
      expect(state.discovered.find(d => d.name === 'enabled').type).toBe('checkbox')
      expect(state.discovered.find(d => d.name === 'name').type).toBe('text')
    })

    it('should use explicit type from definition', () => {
      params.value = { default: 5, type: 'slider', min: 0, max: 100 }
      expect(state.discovered.find(d => d.name === 'value').type).toBe('slider')
    })
  })

  describe('nested params (sub-parts)', () => {
    it('should auto-create child proxies on access', () => {
      expect(params.left._isParamsProxy).toBe(true)
      expect(params.left._path).toBe('left')
    })

    it('should handle deeply nested values', () => {
      params.front.left.wheel.radius = 5
      expect(params.front.left.wheel.radius).toBe(5)
      expect(params.front.left.wheel._path).toBe('front.left.wheel')
    })

    it('should track parent paths correctly', () => {
      params.front.left.radius = 5
      const discovered = state.discovered.find(d => d.path === 'front.left.radius')
      expect(discovered.parent).toBe('front.left')
      expect(discovered.name).toBe('radius')
    })
  })

  describe('hidden params', () => {
    it('should mark params starting with _ as hidden', () => {
      params._offset = 10
      params.radius = 5

      expect(state.discovered.find(d => d.name === '_offset').hidden).toBe(true)
      expect(state.discovered.find(d => d.name === 'radius').hidden).toBe(false)
    })

    it('should work with nested hidden params', () => {
      params.left._offset = -10
      expect(state.discovered.find(d => d.path === 'left._offset').hidden).toBe(true)
    })
  })

  describe('user interaction override', () => {
    it('should return UI value when user has interacted', () => {
      state.uiValues['radius'] = 10
      state.userInteracted.add('radius')

      params.radius = 5  // Code tries to set default
      expect(params.radius).toBe(10)  // UI value wins
    })

    it('should ignore code assignment when user has interacted', () => {
      state.uiValues['radius'] = 10
      state.userInteracted.add('radius')

      params.radius = 5
      params.radius = 7  // Try again
      expect(params.radius).toBe(10)  // Still UI value
    })

    it('should allow code assignment when user has not interacted', () => {
      state.uiValues['radius'] = 10  // Value exists but user didn't interact

      params.radius = 5
      expect(params.radius).toBe(5)  // Code value wins
    })

    it('should work with nested params', () => {
      state.uiValues['front.left.radius'] = 20
      state.userInteracted.add('front.left.radius')

      params.front.left.radius = 5
      expect(params.front.left.radius).toBe(20)
    })
  })

  describe('computed values flow', () => {
    it('should allow parent to set child values', () => {
      // Parent sets computed value
      params.length = 20
      params.left._offset = -params.length / 2

      expect(params.left._offset).toBe(-10)
    })

    it('should recompute when parent value changes', () => {
      // Simulate first run
      params.length = 20
      params.left._offset = -params.length / 2
      expect(params.left._offset).toBe(-10)

      // Simulate second run with new state (user changed length)
      const state2 = createProxyState({ length: 40 }, new Set(['length']))
      const params2 = createParamsProxy(state2)

      params2.length = 20  // Code default ignored
      expect(params2.length).toBe(40)  // UI value

      params2.left._offset = -params2.length / 2  // Recomputed!
      expect(params2.left._offset).toBe(-20)
    })

    it('should allow user to override computed value', () => {
      // Parent sets computed
      params.length = 20
      params.left._offset = -params.length / 2

      // Simulate user override
      const state2 = createProxyState(
        { length: 20, 'left._offset': -5 },
        new Set(['left._offset'])
      )
      const params2 = createParamsProxy(state2)

      params2.length = 20
      params2.left._offset = -params2.length / 2  // Code tries to compute

      expect(params2.left._offset).toBe(-5)  // User value wins
    })
  })

  describe('realistic usage scenario', () => {
    it('should work like a real JSCAD model', () => {
      // Simulating:
      // const wheel = (params) => { params.radius = 5; return cylinder(...) }
      // const axle = (params) => {
      //   params.length = 20
      //   params.left._offset = -params.length / 2
      //   return [wheel(params.left), wheel(params.right)]
      // }

      const wheel = (params) => {
        params.radius = { default: 5, min: 1, max: 50 }
        params.width = { default: 2, min: 0.5, max: 10 }
        // Simulated geometry
        return { type: 'cylinder', radius: params.radius, height: params.width }
      }

      const axle = (params) => {
        params.length = { default: 20, min: 5, max: 100 }

        // Computed values for children
        params.left._offset = -params.length / 2
        params.right._offset = params.length / 2

        const leftWheel = wheel(params.left)
        const rightWheel = wheel(params.right)

        return { type: 'group', children: [leftWheel, rightWheel] }
      }

      const main = (params) => {
        params.wheelbase = { default: 40, min: 20, max: 80 }

        const front = axle(params.front)
        const rear = axle(params.rear)

        return { type: 'car', front, rear }
      }

      // Execute
      const result = main(params)

      // Check discovered params (sort for consistent comparison)
      const paths = state.discovered.map(d => d.path).sort()
      expect(paths).toEqual([
        'front.left._offset',
        'front.left.radius',
        'front.left.width',
        'front.length',
        'front.right._offset',
        'front.right.radius',
        'front.right.width',
        'rear.left._offset',
        'rear.left.radius',
        'rear.left.width',
        'rear.length',
        'rear.right._offset',
        'rear.right.radius',
        'rear.right.width',
        'wheelbase',
      ])

      // Check values
      expect(params.wheelbase).toBe(40)
      expect(params.front.length).toBe(20)
      expect(params.front.left._offset).toBe(-10)
      expect(params.front.left.radius).toBe(5)
    })
  })
})

describe('buildParamTree', () => {
  it('should build a tree from flat discovered params', () => {
    const discovered = [
      { path: 'wheelbase', name: 'wheelbase', parent: '', default: 40, type: 'number', hidden: false },
      { path: 'front.length', name: 'length', parent: 'front', default: 20, type: 'number', hidden: false },
      { path: 'front.left.radius', name: 'radius', parent: 'front.left', default: 5, type: 'number', hidden: false },
      { path: 'front.right.radius', name: 'radius', parent: 'front.right', default: 5, type: 'number', hidden: false },
    ]

    const tree = buildParamTree(discovered)

    expect(tree.params.length).toBe(1)
    expect(tree.params[0].name).toBe('wheelbase')
    expect(tree.children.front.params.length).toBe(1)
    expect(tree.children.front.params[0].name).toBe('length')
    expect(tree.children.front.children.left.params[0].name).toBe('radius')
    expect(tree.children.front.children.right.params[0].name).toBe('radius')
  })
})

describe('toParamDefinitions', () => {
  it('should convert to params-form compatible format', () => {
    const discovered = [
      { path: 'wheelbase', name: 'wheelbase', parent: '', default: 40, type: 'number', hidden: false },
      { path: 'front.length', name: 'length', parent: 'front', default: 20, type: 'number', hidden: false, min: 5, max: 100 },
      { path: 'front._hidden', name: '_hidden', parent: 'front', default: 0, type: 'number', hidden: true },
    ]

    const defs = toParamDefinitions(discovered, false)

    // Should have: wheelbase, group:front, front.length (no hidden)
    expect(defs.length).toBe(3)
    expect(defs[0].name).toBe('wheelbase')
    expect(defs[1].type).toBe('group')
    expect(defs[2].name).toBe('front.length')
    expect(defs[2].min).toBe(5)
    expect(defs[2].max).toBe(100)
  })

  it('should include hidden params when requested', () => {
    const discovered = [
      { path: 'front._hidden', name: '_hidden', parent: 'front', default: 0, type: 'number', hidden: true },
    ]

    const defsWithHidden = toParamDefinitions(discovered, true)
    const defsWithoutHidden = toParamDefinitions(discovered, false)

    expect(defsWithHidden.length).toBe(2)  // group + param
    expect(defsWithoutHidden.length).toBe(1)  // just group
  })
})

describe('extractDefaults', () => {
  it('should extract flat defaults object', () => {
    const discovered = [
      { path: 'wheelbase', default: 40 },
      { path: 'front.length', default: 20 },
      { path: 'front.left.radius', default: 5 },
    ]

    const defaults = extractDefaults(discovered)

    expect(defaults).toEqual({
      'wheelbase': 40,
      'front.length': 20,
      'front.left.radius': 5,
    })
  })
})

describe('_type support', () => {
  let state
  let params

  beforeEach(() => {
    state = createProxyState()
    params = createParamsProxy(state)
  })

  it('should store types for parts', () => {
    params._type = 'Car'
    params.front._type = 'Axle'
    params.front.left._type = 'Wheel'

    expect(state.types.get('')).toBe('Car')
    expect(state.types.get('front')).toBe('Axle')
    expect(state.types.get('front.left')).toBe('Wheel')
  })

  it('should use types in buildParamTree', () => {
    params._type = 'Car'
    params.wheelbase = 40
    params.front._type = 'Axle'
    params.front.length = 20

    const tree = buildParamTree(state.discovered, state.types)

    expect(tree.type).toBe('Car')
    expect(tree.children.front.type).toBe('Axle')
  })

  it('should have undefined type when not set', () => {
    params.wheelbase = 40
    params.front.length = 20

    const tree = buildParamTree(state.discovered, state.types)

    expect(tree.type).toBeUndefined()
    expect(tree.children.front.type).toBeUndefined()
  })
})

describe('getBreadcrumbs', () => {
  it('should return breadcrumb segments', () => {
    const breadcrumbs = getBreadcrumbs('front.left.wheel')

    expect(breadcrumbs).toEqual([
      { path: '', name: 'root', type: undefined },
      { path: 'front', name: 'front', type: undefined },
      { path: 'front.left', name: 'left', type: undefined },
      { path: 'front.left.wheel', name: 'wheel', type: undefined },
    ])
  })

  it('should use types when provided', () => {
    const types = new Map([
      ['', 'Car'],
      ['front', 'Axle'],
      ['front.left', 'Wheel'],
    ])

    const breadcrumbs = getBreadcrumbs('front.left', types)

    expect(breadcrumbs).toEqual([
      { path: '', name: 'root', type: 'Car' },
      { path: 'front', name: 'front', type: 'Axle' },
      { path: 'front.left', name: 'left', type: 'Wheel' },
    ])
  })

  it('should return only root for empty path', () => {
    const breadcrumbs = getBreadcrumbs('')

    expect(breadcrumbs).toEqual([
      { path: '', name: 'root', type: undefined },
    ])
  })
})

describe('getNodeByPath', () => {
  it('should find node by path', () => {
    const tree = {
      path: '',
      name: 'root',
      children: {
        front: {
          path: 'front',
          name: 'front',
          children: {
            left: { path: 'front.left', name: 'left', children: {}, params: [] }
          },
          params: []
        }
      },
      params: []
    }

    expect(getNodeByPath(tree, '')).toBe(tree)
    expect(getNodeByPath(tree, 'front').name).toBe('front')
    expect(getNodeByPath(tree, 'front.left').name).toBe('left')
    expect(getNodeByPath(tree, 'nonexistent')).toBe(null)
  })
})

describe('getParamsAtPath', () => {
  it('should filter params by parent path', () => {
    const discovered = [
      { path: 'wheelbase', parent: '', hidden: false },
      { path: 'front.length', parent: 'front', hidden: false },
      { path: 'front._offset', parent: 'front', hidden: true },
      { path: 'front.left.radius', parent: 'front.left', hidden: false },
    ]

    const rootParams = getParamsAtPath(discovered, '')
    expect(rootParams.length).toBe(1)
    expect(rootParams[0].path).toBe('wheelbase')

    const frontParams = getParamsAtPath(discovered, 'front')
    expect(frontParams.length).toBe(1)  // Hidden excluded by default
    expect(frontParams[0].path).toBe('front.length')

    const frontParamsWithHidden = getParamsAtPath(discovered, 'front', true)
    expect(frontParamsWithHidden.length).toBe(2)
  })
})

describe('getChildParts', () => {
  it('should return child part names', () => {
    const tree = {
      path: '',
      children: {
        front: {
          path: 'front',
          children: {
            left: { path: 'front.left', children: {} },
            right: { path: 'front.right', children: {} }
          }
        },
        rear: { path: 'rear', children: {} }
      }
    }

    expect(getChildParts(tree, '')).toEqual(['front', 'rear'])
    expect(getChildParts(tree, 'front')).toEqual(['left', 'right'])
    expect(getChildParts(tree, 'front.left')).toEqual([])
  })
})

describe('_class support', () => {
  let state
  let params

  beforeEach(() => {
    state = createProxyState()
    params = createParamsProxy(state)
  })

  it('should store classes for parts', () => {
    params._type = 'Car'
    params.front._type = 'Axle'
    params.front.left._type = 'Wheel'
    params.front.left._class = 'all-wheels'
    params.front.right._type = 'Wheel'
    params.front.right._class = 'all-wheels'

    expect(state.classes.get('front.left')).toBe('all-wheels')
    expect(state.classes.get('front.right')).toBe('all-wheels')
  })

  it('should include partClass in buildParamTree', () => {
    params._type = 'Car'
    params.wheelbase = 40
    params.front._type = 'Axle'
    params.front._class = 'front-axle'
    params.front.length = 20
    params.front.left._type = 'Wheel'
    params.front.left._class = 'all-wheels'
    params.front.left.radius = 5

    const tree = buildParamTree(state.discovered, state.types, state.classes)

    expect(tree.type).toBe('Car')
    expect(tree.children.front.type).toBe('Axle')
    expect(tree.children.front.partClass).toBe('front-axle')
    expect(tree.children.front.children.left.type).toBe('Wheel')
    expect(tree.children.front.children.left.partClass).toBe('all-wheels')
  })
})

describe('getClassesForType', () => {
  it('should return all unique classes for a type', () => {
    const types = new Map([
      ['front.left', 'Wheel'],
      ['front.right', 'Wheel'],
      ['rear.left', 'Wheel'],
      ['rear.right', 'Wheel'],
      ['front', 'Axle'],
      ['rear', 'Axle'],
    ])
    const classes = new Map([
      ['front.left', 'all-wheels'],
      ['front.right', 'all-wheels'],
      ['rear.left', 'rear-wheels'],
      ['rear.right', 'rear-wheels'],
      ['front', 'front-axle'],
      ['rear', 'rear-axle'],
    ])

    const { getClassesForType } = require('./createParamsProxy.js')

    const wheelClasses = getClassesForType(types, classes, 'Wheel')
    expect(wheelClasses.sort()).toEqual(['all-wheels', 'rear-wheels'])

    const axleClasses = getClassesForType(types, classes, 'Axle')
    expect(axleClasses.sort()).toEqual(['front-axle', 'rear-axle'])
  })
})

describe('getLinkedParts', () => {
  it('should return all parts with same class and type', () => {
    const types = new Map([
      ['front.left', 'Wheel'],
      ['front.right', 'Wheel'],
      ['rear.left', 'Wheel'],
      ['rear.right', 'Wheel'],
    ])
    const classes = new Map([
      ['front.left', 'all-wheels'],
      ['front.right', 'all-wheels'],
      ['rear.left', 'all-wheels'],
      ['rear.right', 'all-wheels'],
    ])

    const { getLinkedParts } = require('./createParamsProxy.js')

    const linked = getLinkedParts(types, classes, 'front.left')
    expect(linked.sort()).toEqual(['front.left', 'front.right', 'rear.left', 'rear.right'])
  })

  it('should return only self if no class is set', () => {
    const types = new Map([['front.left', 'Wheel']])
    const classes = new Map()

    const { getLinkedParts } = require('./createParamsProxy.js')

    const linked = getLinkedParts(types, classes, 'front.left')
    expect(linked).toEqual(['front.left'])
  })

  it('should not link parts with different types even if same class', () => {
    const types = new Map([
      ['front.left', 'Wheel'],
      ['front', 'Axle'],
    ])
    const classes = new Map([
      ['front.left', 'shared-class'],
      ['front', 'shared-class'],
    ])

    const { getLinkedParts } = require('./createParamsProxy.js')

    const linkedFromWheel = getLinkedParts(types, classes, 'front.left')
    expect(linkedFromWheel).toEqual(['front.left'])

    const linkedFromAxle = getLinkedParts(types, classes, 'front')
    expect(linkedFromAxle).toEqual(['front'])
  })
})

describe('getLinkedParamPaths', () => {
  it('should return all linked param paths', () => {
    const types = new Map([
      ['front.left', 'Wheel'],
      ['front.right', 'Wheel'],
      ['rear.left', 'Wheel'],
      ['rear.right', 'Wheel'],
    ])
    const classes = new Map([
      ['front.left', 'all-wheels'],
      ['front.right', 'all-wheels'],
      ['rear.left', 'all-wheels'],
      ['rear.right', 'all-wheels'],
    ])

    const { getLinkedParamPaths } = require('./createParamsProxy.js')

    const linkedPaths = getLinkedParamPaths(types, classes, 'front.left.radius')
    expect(linkedPaths.sort()).toEqual([
      'front.left.radius',
      'front.right.radius',
      'rear.left.radius',
      'rear.right.radius',
    ])
  })

  it('should return only self for root-level params', () => {
    const types = new Map()
    const classes = new Map()

    const { getLinkedParamPaths } = require('./createParamsProxy.js')

    const linkedPaths = getLinkedParamPaths(types, classes, 'wheelbase')
    expect(linkedPaths).toEqual(['wheelbase'])
  })
})
