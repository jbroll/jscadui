import { test, expect } from 'vitest'
import * as api from '../src/index.js'

test('public surface exists', () => {
  for (const name of ['createModelTree', 'createEvaluator', 'createBuildContext', 'withBuildContext', 'bindEvaluator', 'eagerEvaluate', 'memoFromSpecials', 'splitParts']) {
    expect(typeof api[name], name).toBe('function')
  }
})
