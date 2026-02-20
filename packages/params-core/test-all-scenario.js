/**
 * Test scenario: ALL.js loading both hierarchical and legacy models
 *
 * Goal: Verify that legacy models get isolated parameter state
 * and don't pollute each other when loaded from a hierarchical parent.
 */

import { createParamsProxy, createProxyState, wrapLegacyModule } from './src/createParamsProxy.js'

// Simulate a legacy model with getParameterDefinitions (nuts-and-bolts style)
const legacyModel1 = {
  getParameterDefinitions: () => [
    { name: 'segments', type: 'int', initial: 16, min: 3 },
    { name: 'threadSize', type: 'number', initial: 2, min: 0 },
    { name: 'radius', type: 'number', initial: 10 }
  ],
  main: (params) => {
    console.log('LegacyModel1 segments:', params.segments, 'threadSize:', params.threadSize, 'radius:', params.radius)
    if (!(params.threadSize > 0)) {
      throw new Error('threadSize must be greater than zero')
    }
    return { type: 'nuts', segments: params.segments, threadSize: params.threadSize, radius: params.radius }
  }
}

// Simulate another legacy model with different parameter constraints (balloons style)
const legacyModel2 = {
  getParameterDefinitions: () => [
    { name: 'segments', type: 'int', initial: 32, min: 4 },
    { name: 'height', type: 'number', initial: 20 }
  ],
  main: (params) => {
    if (params.segments < 4) {
      throw new Error('segments must be four or more')
    }
    console.log('LegacyModel2 segments:', params.segments, 'height:', params.height)
    return { type: 'balloon', segments: params.segments, height: params.height }
  }
}

// Simulate a hierarchical model (two-cars style)
const hierarchicalModel = {
  main: (params) => {
    console.log('HierarchicalModel accessing params.one and params.two')
    params.one._class = 'instance1'
    params.two._class = 'instance2'
    return { type: 'hierarchical', one: params.one, two: params.two }
  }
}

console.log('\n=== Test 1: Legacy models should get isolated state ===')
try {
  // Wrap legacy models (simulates what require.js does)
  const wrapped1 = wrapLegacyModule(legacyModel1)
  const wrapped2 = wrapLegacyModule(legacyModel2)

  // Create root proxy for ALL.js (hierarchical mode)
  const rootState = createProxyState({}, new Set(), { mode: 'hierarchical' })
  const rootParams = createParamsProxy(rootState)

  // ALL.js calls each model with params[name] (child proxy)
  console.log('\nCalling wrapped legacy model 1 with params.model1:')
  console.log('params.model1._isParamsProxy:', rootParams.model1._isParamsProxy)
  console.log('params.model1._path:', rootParams.model1._path)
  console.log('Expected defaults: segments=16, radius=10')
  const result1 = wrapped1(rootParams.model1)

  console.log('\nCalling wrapped legacy model 2 with params.model2:')
  console.log('params.model2._isParamsProxy:', rootParams.model2._isParamsProxy)
  console.log('params.model2._path:', rootParams.model2._path)
  console.log('Expected defaults: segments=32, height=20')
  const result2 = wrapped2(rootParams.model2)

  console.log('\n✓ Test 1 PASSED - No parameter pollution!')
  console.log('Result1:', result1)
  console.log('Result2:', result2)
} catch (err) {
  console.log('\n✗ Test 1 FAILED:', err.message)
  console.log(err.stack)
}

console.log('\n=== Test 2: Hierarchical model should work normally ===')
try {
  const rootState = createProxyState({}, new Set(), { mode: 'hierarchical' })
  const rootParams = createParamsProxy(rootState)

  console.log('\nCalling hierarchical model:')
  const result = hierarchicalModel.main(rootParams)

  console.log('\n✓ Test 2 PASSED - Hierarchical model works!')
  console.log('Result:', result)
} catch (err) {
  console.log('\n✗ Test 2 FAILED:', err.message)
  console.log(err.stack)
}

console.log('\n=== Test 3: Mixed scenario (like real ALL.js) ===')
try {
  const wrapped1 = wrapLegacyModule(legacyModel1)
  const wrapped2 = wrapLegacyModule(legacyModel2)

  const rootState = createProxyState({}, new Set(), { mode: 'hierarchical' })
  const rootParams = createParamsProxy(rootState)

  console.log('\nLoading models in ALL.js order:')
  const r1 = hierarchicalModel.main(rootParams.hierarchical)
  const r2 = wrapped1(rootParams.legacy1)
  const r3 = wrapped2(rootParams.legacy2)

  console.log('\n✓ Test 3 PASSED - Mixed hierarchical and legacy works!')
  console.log('Hierarchical:', r1)
  console.log('Legacy1:', r2)
  console.log('Legacy2:', r3)
} catch (err) {
  console.log('\n✗ Test 3 FAILED:', err.message)
  console.log(err.stack)
}
