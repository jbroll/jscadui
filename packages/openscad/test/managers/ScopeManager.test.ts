import { describe, it, expect } from 'vitest'
import { ScopeManager } from '../../src/transpiler/managers/ScopeManager.js'

describe('ScopeManager', () => {
  describe('initialization', () => {
    it('should initialize with empty scope stack', () => {
      const manager = new ScopeManager()

      expect(manager.scopeDepth).toBe(0)
      expect(manager.lookupBinding('x')).toBeUndefined()
      expect(manager.lookupFunctionBinding('foo')).toBeUndefined()
    })
  })

  describe('generateSuffix()', () => {
    it('should generate unique suffixes', () => {
      const manager = new ScopeManager()

      const suffix1 = manager.generateSuffix()
      const suffix2 = manager.generateSuffix()
      const suffix3 = manager.generateSuffix()

      expect(suffix1).toBe('$1')
      expect(suffix2).toBe('$2')
      expect(suffix3).toBe('$3')
    })

    it('should continue incrementing across multiple calls', () => {
      const manager = new ScopeManager()

      // Generate 10 suffixes
      const suffixes: string[] = []
      for (let i = 0; i < 10; i++) {
        suffixes.push(manager.generateSuffix())
      }

      expect(suffixes).toEqual(['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9', '$10'])
    })
  })

  describe('scope stack', () => {
    it('should push and pop scopes', () => {
      const manager = new ScopeManager()

      expect(manager.scopeDepth).toBe(0)

      const scope1 = new Map([['x', 'x$1']])
      manager.pushScope(scope1)
      expect(manager.scopeDepth).toBe(1)

      const scope2 = new Map([['y', 'y$2']])
      manager.pushScope(scope2)
      expect(manager.scopeDepth).toBe(2)

      manager.popScope()
      expect(manager.scopeDepth).toBe(1)

      manager.popScope()
      expect(manager.scopeDepth).toBe(0)
    })

    it('should lookup bindings in current scope', () => {
      const manager = new ScopeManager()
      const scope = new Map([
        ['x', 'x$1'],
        ['y', 'y$1'],
      ])

      manager.pushScope(scope)

      expect(manager.lookupBinding('x')).toBe('x$1')
      expect(manager.lookupBinding('y')).toBe('y$1')
      expect(manager.lookupBinding('z')).toBeUndefined()
    })

    it('should handle scope shadowing (inner scope takes precedence)', () => {
      const manager = new ScopeManager()

      const outerScope = new Map([
        ['x', 'x$1'],
        ['y', 'y$1'],
      ])
      manager.pushScope(outerScope)

      const innerScope = new Map([
        ['x', 'x$2'], // Shadow x
      ])
      manager.pushScope(innerScope)

      expect(manager.lookupBinding('x')).toBe('x$2') // Inner shadows outer
      expect(manager.lookupBinding('y')).toBe('y$1') // Falls through to outer
      expect(manager.lookupBinding('z')).toBeUndefined()
    })

    it('should restore outer scope after pop', () => {
      const manager = new ScopeManager()

      const outerScope = new Map([['x', 'x$1']])
      manager.pushScope(outerScope)

      const innerScope = new Map([['x', 'x$2']])
      manager.pushScope(innerScope)

      expect(manager.lookupBinding('x')).toBe('x$2')

      manager.popScope()

      expect(manager.lookupBinding('x')).toBe('x$1')
    })

    it('should handle multiple nested scopes', () => {
      const manager = new ScopeManager()

      manager.pushScope(new Map([['x', 'x$1']]))
      manager.pushScope(new Map([['y', 'y$2']]))
      manager.pushScope(new Map([['z', 'z$3']]))

      expect(manager.lookupBinding('x')).toBe('x$1')
      expect(manager.lookupBinding('y')).toBe('y$2')
      expect(manager.lookupBinding('z')).toBe('z$3')
      expect(manager.scopeDepth).toBe(3)

      manager.popScope()
      expect(manager.lookupBinding('z')).toBeUndefined()
      expect(manager.scopeDepth).toBe(2)
    })

    it('should return undefined for bindings after all scopes popped', () => {
      const manager = new ScopeManager()
      const scope = new Map([['x', 'x$1']])

      manager.pushScope(scope)
      expect(manager.lookupBinding('x')).toBe('x$1')

      manager.popScope()
      expect(manager.lookupBinding('x')).toBeUndefined()
    })
  })

  describe('function bindings', () => {
    it('should register and lookup function bindings', () => {
      const manager = new ScopeManager()

      manager.registerFunctionBinding('foo', 'foo$1')
      manager.registerFunctionBinding('bar', 'bar$2')

      expect(manager.lookupFunctionBinding('foo')).toBe('foo$1')
      expect(manager.lookupFunctionBinding('bar')).toBe('bar$2')
      expect(manager.lookupFunctionBinding('baz')).toBeUndefined()
    })

    it('should unregister function bindings', () => {
      const manager = new ScopeManager()

      manager.registerFunctionBinding('foo', 'foo$1')
      expect(manager.lookupFunctionBinding('foo')).toBe('foo$1')

      manager.unregisterFunctionBinding('foo')
      expect(manager.lookupFunctionBinding('foo')).toBeUndefined()
    })

    it('should handle overwriting function bindings', () => {
      const manager = new ScopeManager()

      manager.registerFunctionBinding('foo', 'foo$1')
      expect(manager.lookupFunctionBinding('foo')).toBe('foo$1')

      manager.registerFunctionBinding('foo', 'foo$2')
      expect(manager.lookupFunctionBinding('foo')).toBe('foo$2')
    })

    it('should be independent from scope bindings', () => {
      const manager = new ScopeManager()

      // Add scope binding for 'x'
      manager.pushScope(new Map([['x', 'x$1']]))

      // Add function binding for 'foo'
      manager.registerFunctionBinding('foo', 'foo$1')

      expect(manager.lookupBinding('x')).toBe('x$1')
      expect(manager.lookupFunctionBinding('foo')).toBe('foo$1')
      expect(manager.lookupBinding('foo')).toBeUndefined()
      expect(manager.lookupFunctionBinding('x')).toBeUndefined()
    })
  })

  describe('clone()', () => {
    it('should create a deep copy of scope stack', () => {
      const manager = new ScopeManager()
      manager.pushScope(new Map([['x', 'x$1']]))
      manager.pushScope(new Map([['y', 'y$2']]))

      const clone = manager.clone()

      expect(clone.scopeDepth).toBe(2)
      expect(clone.lookupBinding('x')).toBe('x$1')
      expect(clone.lookupBinding('y')).toBe('y$2')

      // Verify independence - modify original
      manager.pushScope(new Map([['z', 'z$3']]))
      expect(manager.scopeDepth).toBe(3)
      expect(clone.scopeDepth).toBe(2)
      expect(clone.lookupBinding('z')).toBeUndefined()
    })

    it('should copy function bindings', () => {
      const manager = new ScopeManager()
      manager.registerFunctionBinding('foo', 'foo$1')
      manager.registerFunctionBinding('bar', 'bar$2')

      const clone = manager.clone()

      expect(clone.lookupFunctionBinding('foo')).toBe('foo$1')
      expect(clone.lookupFunctionBinding('bar')).toBe('bar$2')

      // Verify independence
      manager.registerFunctionBinding('baz', 'baz$3')
      expect(manager.lookupFunctionBinding('baz')).toBe('baz$3')
      expect(clone.lookupFunctionBinding('baz')).toBeUndefined()
    })

    it('should copy suffix counter', () => {
      const manager = new ScopeManager()
      manager.generateSuffix() // $1
      manager.generateSuffix() // $2
      manager.generateSuffix() // $3

      const clone = manager.clone()

      // Clone should continue from same counter
      expect(clone.generateSuffix()).toBe('$4')
      expect(clone.generateSuffix()).toBe('$5')

      // Original should also continue
      expect(manager.generateSuffix()).toBe('$4')
    })

    it('should handle empty state', () => {
      const manager = new ScopeManager()
      const clone = manager.clone()

      expect(clone.scopeDepth).toBe(0)
      expect(clone.lookupBinding('x')).toBeUndefined()
      expect(clone.lookupFunctionBinding('foo')).toBeUndefined()
      expect(clone.generateSuffix()).toBe('$1')
    })

    it('should create truly independent copies', () => {
      const manager = new ScopeManager()
      manager.pushScope(new Map([['x', 'x$1']]))

      const clone = manager.clone()

      // Modify clone's scope
      clone.pushScope(new Map([['y', 'y$2']]))
      clone.popScope()
      clone.popScope()

      // Original should be unchanged
      expect(manager.scopeDepth).toBe(1)
      expect(manager.lookupBinding('x')).toBe('x$1')
    })
  })

  describe('real-world usage patterns', () => {
    it('should support let binding pattern', () => {
      const manager = new ScopeManager()

      // let (x = 5, y = 10) { ... }
      const suffix = manager.generateSuffix()
      const scope = new Map([
        ['x', `x${suffix}`],
        ['y', `y${suffix}`],
      ])

      manager.pushScope(scope)
      expect(manager.lookupBinding('x')).toBe('x$1')
      expect(manager.lookupBinding('y')).toBe('y$1')

      manager.popScope()
      expect(manager.lookupBinding('x')).toBeUndefined()
    })

    it('should support C-style for loop pattern', () => {
      const manager = new ScopeManager()

      // for (i = 0; i < 10; i = i + 1) { ... }
      const suffix = manager.generateSuffix()
      const scope = new Map([['i', `i${suffix}`]])

      manager.pushScope(scope)
      expect(manager.lookupBinding('i')).toBe('i$1')

      manager.popScope()
      expect(manager.lookupBinding('i')).toBeUndefined()
    })

    it('should support nested let bindings with shadowing', () => {
      const manager = new ScopeManager()

      // Outer: let (x = 5) { ... }
      const suffix1 = manager.generateSuffix()
      manager.pushScope(new Map([['x', `x${suffix1}`]]))
      expect(manager.lookupBinding('x')).toBe('x$1')

      // Inner: let (x = 10) { ... }
      const suffix2 = manager.generateSuffix()
      manager.pushScope(new Map([['x', `x${suffix2}`]]))
      expect(manager.lookupBinding('x')).toBe('x$2')

      manager.popScope()
      expect(manager.lookupBinding('x')).toBe('x$1')

      manager.popScope()
      expect(manager.lookupBinding('x')).toBeUndefined()
    })

    it('should support function binding lifecycle', () => {
      const manager = new ScopeManager()

      // Enter let block with function value
      manager.registerFunctionBinding('foo', 'foo$1')
      expect(manager.lookupFunctionBinding('foo')).toBe('foo$1')

      // Exit let block
      manager.unregisterFunctionBinding('foo')
      expect(manager.lookupFunctionBinding('foo')).toBeUndefined()
    })

    it('should support nested transpilation with clone', () => {
      const parent = new ScopeManager()
      parent.generateSuffix() // $1
      parent.pushScope(new Map([['x', 'x$1']]))
      parent.registerFunctionBinding('foo', 'foo$1')

      // Child context clones parent state
      const child = parent.clone()
      child.generateSuffix() // $2
      child.pushScope(new Map([['y', 'y$2']]))

      // Child has both parent and child state
      expect(child.lookupBinding('x')).toBe('x$1')
      expect(child.lookupBinding('y')).toBe('y$2')
      expect(child.lookupFunctionBinding('foo')).toBe('foo$1')

      // Parent is unaffected
      expect(parent.scopeDepth).toBe(1)
      expect(parent.lookupBinding('y')).toBeUndefined()
    })
  })
})
