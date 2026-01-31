/**
 * Tests for trusted sources module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadRules,
  saveRules,
  addRule,
  updateRule,
  deleteRule,
  isTrusted,
  parseUrl,
  addRuleForUrl,
  addRuleForDomain
} from './trustedSources.js'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString() },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} }
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('trustedSources', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('loadRules', () => {
    it('returns empty array when no rules exist', () => {
      expect(loadRules()).toEqual([])
    })

    it('returns saved rules', () => {
      const rules = [{ id: '1', domain: 'example.com', pathPattern: '.*' }]
      saveRules(rules)
      expect(loadRules()).toEqual(rules)
    })

    it('handles corrupted localStorage data', () => {
      localStorage.setItem('jscad-trusted-sources', 'invalid json')
      expect(loadRules()).toEqual([])
    })

    it('handles empty rules array', () => {
      localStorage.setItem('jscad-trusted-sources', '{"rules": []}')
      expect(loadRules()).toEqual([])
    })
  })

  describe('addRule', () => {
    it('adds a new rule with generated id', () => {
      const rule = addRule('example.com', '.*')
      expect(rule).toHaveProperty('id')
      expect(rule.domain).toBe('example.com')
      expect(rule.pathPattern).toBe('.*')
    })

    it('persists rule to storage', () => {
      addRule('example.com', '/models/.*')
      const rules = loadRules()
      expect(rules).toHaveLength(1)
      expect(rules[0].domain).toBe('example.com')
    })
  })

  describe('updateRule', () => {
    it('updates existing rule', () => {
      const rule = addRule('example.com', '.*')
      const updated = updateRule(rule.id, 'new.com', '/path/.*')
      expect(updated).toBe(true)
      const rules = loadRules()
      expect(rules[0].domain).toBe('new.com')
      expect(rules[0].pathPattern).toBe('/path/.*')
    })

    it('returns false for non-existent rule', () => {
      expect(updateRule('non-existent', 'domain', 'path')).toBe(false)
    })
  })

  describe('deleteRule', () => {
    it('deletes existing rule', () => {
      const rule = addRule('example.com', '.*')
      expect(deleteRule(rule.id)).toBe(true)
      expect(loadRules()).toHaveLength(0)
    })

    it('returns false for non-existent rule', () => {
      expect(deleteRule('non-existent')).toBe(false)
    })
  })

  describe('isTrusted', () => {
    it('returns false when no rules exist', () => {
      expect(isTrusted('https://example.com/script.js')).toBe(false)
    })

    it('matches exact domain', () => {
      addRule('example.com', '.*')
      expect(isTrusted('https://example.com/script.js')).toBe(true)
    })

    it('matches subdomain', () => {
      addRule('example.com', '.*')
      expect(isTrusted('https://sub.example.com/script.js')).toBe(true)
    })

    it('does not match different domain', () => {
      addRule('example.com', '.*')
      expect(isTrusted('https://malicious.com/script.js')).toBe(false)
    })

    it('matches path pattern', () => {
      addRule('example.com', '^/models/.*\\.js$')
      expect(isTrusted('https://example.com/models/gear.js')).toBe(true)
      expect(isTrusted('https://example.com/other/gear.js')).toBe(false)
    })

    it('handles invalid URL', () => {
      addRule('example.com', '.*')
      expect(isTrusted('not-a-url')).toBe(false)
    })

    it('handles invalid regex in rule', () => {
      addRule('example.com', '[invalid')
      // Should not throw, just skip the rule
      expect(isTrusted('https://example.com/script.js')).toBe(false)
    })
  })

  describe('parseUrl', () => {
    it('parses valid URL', () => {
      const result = parseUrl('https://example.com/models/gear.js')
      expect(result).toEqual({
        domain: 'example.com',
        path: '/models/gear.js'
      })
    })

    it('returns null for invalid URL', () => {
      expect(parseUrl('not-a-url')).toBe(null)
    })
  })

  describe('addRuleForUrl', () => {
    it('creates exact match rule', () => {
      const rule = addRuleForUrl('https://example.com/models/gear.js')
      expect(rule.domain).toBe('example.com')
      expect(rule.pathPattern).toBe('^/models/gear\\.js$')
    })

    it('escapes special regex characters', () => {
      const rule = addRuleForUrl('https://example.com/path/file.test.js')
      expect(rule.pathPattern).toBe('^/path/file\\.test\\.js$')
    })

    it('returns null for invalid URL', () => {
      expect(addRuleForUrl('not-a-url')).toBe(null)
    })
  })

  describe('addRuleForDomain', () => {
    it('creates domain-wide rule', () => {
      const rule = addRuleForDomain('https://example.com/any/path.js')
      expect(rule.domain).toBe('example.com')
      expect(rule.pathPattern).toBe('.*')
    })

    it('returns null for invalid URL', () => {
      expect(addRuleForDomain('not-a-url')).toBe(null)
    })
  })
})
