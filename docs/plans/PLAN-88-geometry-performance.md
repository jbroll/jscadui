# Plan: Review Geometry Pipeline Performance (#88)

## Overview
Profile and optimize the geometry conversion pipeline for large models.

## Current Pipeline
```
JSCAD CSG → format-jscad → Float32Arrays → postMessage (transfer) → renderer
```

## Areas to Investigate

### 1. format-jscad Conversion
**Files:** `packages/format-jscad/index.js`

Potential issues:
- Memory allocation for large meshes
- Normal calculation efficiency
- Instancing deduplication overhead

Profiling tasks:
1. [ ] Measure conversion time for models of various sizes
2. [ ] Profile memory usage during conversion
3. [ ] Identify hot spots with browser profiler

### 2. Normal Calculation
**Function:** `toCreasedNormals` or similar

Questions:
- Is normal smoothing performed?
- Can it be done in a worker?
- Is it necessary for all use cases?

### 3. Instance Deduplication
When `userInstances` is enabled, identical geometries are deduplicated.

Questions:
- What's the hashing overhead?
- Is the hash algorithm efficient?
- Memory savings vs CPU cost?

### 4. Transfer Efficiency
Verify zero-copy transfer:
1. [ ] Confirm Float32Array is Transferable
2. [ ] Check for unnecessary copies
3. [ ] Measure transfer time for large buffers

### 5. Rendering
**Files:** `packages/render-threejs`, `render-babylonjs`, `render-regl`

Check:
- WebGL buffer management
- Draw call batching
- Frustum culling

## Benchmarking Plan

### Test Models
1. Small: <1000 vertices
2. Medium: 10,000-100,000 vertices
3. Large: 1,000,000+ vertices

### Metrics to Capture
- Total conversion time (ms)
- Peak memory usage (MB)
- Transfer time (ms)
- First render time (ms)
- FPS during interaction

### Benchmark Script
```javascript
// Create benchmark utility
async function benchmarkModel(modelFn) {
  const start = performance.now()
  const memBefore = performance.memory?.usedJSHeapSize

  const result = await workerApi.jscadScript({ script: modelFn })

  const conversionTime = performance.now() - start
  const memAfter = performance.memory?.usedJSHeapSize

  return {
    conversionTime,
    memoryDelta: memAfter - memBefore,
    vertexCount: countVertices(result)
  }
}
```

## Potential Optimizations

### If Normal Calculation is Slow
- Add option to skip normal smoothing
- Move to worker thread
- Use simpler algorithm for preview

### If Memory is High
- Stream conversion for very large models
- Use ArrayBuffer pooling
- Implement progressive loading

### If Transfer is Slow
- Verify Transferable is being used
- Consider compression for very large models
- Implement chunked transfer

## Implementation Steps

### Phase 1: Baseline Measurements (4 hours)
1. [ ] Create benchmark suite
2. [ ] Measure current performance
3. [ ] Document baseline metrics

### Phase 2: Profiling (4-6 hours)
1. [ ] Profile with Chrome DevTools
2. [ ] Identify bottlenecks
3. [ ] Document findings

### Phase 3: Optimization (time varies)
Based on profiling results, implement targeted optimizations.

### Phase 4: Verification (2 hours)
1. [ ] Re-run benchmarks
2. [ ] Verify improvements
3. [ ] Check for regressions

## Estimated Total Effort
10-15 hours for investigation
Additional time for optimization depends on findings
