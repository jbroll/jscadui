# Code Review 4 - jscad-web and Dependencies

**Date:** 2026-01-31
**Scope:** `apps/jscad-web` and all local packages it depends on
**Branch:** `hierarchical-params`

## Summary

This comprehensive code review analyzed the jscad-web application and its 17+ local package dependencies. The codebase shows evidence of previous code review fixes (marked with "H*", "M*", "L*", "C*" comments). Several new issues and remaining gaps have been identified.

**Total Issues Found:**
- Critical: 0
- Important: 11 (I1-I7, I9-I12; I8 downgraded)
- Medium: 9 (M1-M8, plus I8 moved here)
- Low: 4
- False Positives Flagged: 3

---

## Important Issues

### I1. Race Condition in Script Lock Timeout (worker)
**File:** `packages/worker/worker.js:105-136`
**Confidence:** 82%

**Issue:** When script execution times out, `release()` is called to allow subsequent scripts, but the timed-out script continues executing. If it modifies shared state (`main`, `scriptModule`, `solids`), it can corrupt the next script's execution.

**Evidence:**
```javascript
// Line 127-133
try {
  await Promise.race([previousLock, timeoutPromise])
} catch (err) {
  release()  // Subsequent script can now run
  throw err  // But timed-out script still running
}
```

**Recommendation:** Add a "generation counter" that increments on each script load. Have `jscadMain` check the generation and abort if mismatched.

**Status:** [ ] To Fix

---

### I2. Memory Leak: userInteracted Set Not Cleared Properly (worker)
**File:** `packages/worker/worker.js:241-250, 366`
**Confidence:** 88%

**Issue:** The `userInteracted` Set is only cleared on `jscadScript()` calls, not between `jscadMain()` calls. Stale paths accumulate when script parameters change structure without full reload.

**Evidence:**
```javascript
// Line 366: Only cleared on new script
userInteracted = new Set()

// Line 244-248: Paths persist across main calls
if (userInteractedPaths) {
  userInteractedPaths.forEach(p => userInteracted.add(p))
}
```

**Recommendation:** After `jscadMain` completes, prune paths not in current `proxyState.discovered`.

**Status:** [ ] To Fix

---

### I3. Missing Bounds Check in exportStlText (worker)
**File:** `packages/worker/src/exportStlText.js:37-49`
**Confidence:** 85%

**Issue:** STL export doesn't validate that `normals.length` matches expected size before array access. If `normals.length < indices.length`, silent data corruption occurs (NaN values).

**Evidence:**
```javascript
// Line 41: No length check
out.push(vertexToStlString('facet normal', normals, i))
```

**Recommendation:** Add validation:
```javascript
if (normals.length < indices.length) {
  throw new Error(`Invalid mesh: normals.length=${normals.length} < indices.length=${indices.length}`)
}
```

**Status:** [ ] To Fix

---

### I4. Unbounded Module Dependency Map Growth (require)
**File:** `packages/require/src/require.js:107, 81`
**Confidence:** 85%

**Issue:** The `requireCache.knownDependencies` Map grows unbounded. While modules have LRU cache (100 items), dependency tracking has no limit. Long-running sessions loading many npm packages will leak memory.

**Evidence:**
```javascript
// Line 107: Every module adds entry
requireCache.knownDependencies.set(cacheUrl, new Set())

// Line 81: Dependencies tracked
requireCache.knownDependencies.get(base)?.add(cacheUrl)
```

**Recommendation:** Add size limit with LRU eviction, or clear old entries when module is evicted from cache.

**Status:** [ ] To Fix

---

### I5. Missing URL Validation in resolveUrl (require)
**File:** `packages/require/src/resolveUrl.js:77-141`
**Confidence:** 80%

**Issue:** While path traversal is defended, there's no validation that `base` and `root` parameters are well-formed URLs before constructing new URLs.

**Recommendation:** Add explicit URL validation at function entry with try-catch around URL construction.

**Status:** [ ] To Fix

---

### I6. Incomplete Pointer ID Tracking in OrbitControl Cleanup (orbit)
**File:** `packages/orbit/src/OrbitControl.js:229-239`
**Confidence:** 85%

**Issue:** The `destroy()` method uses hardcoded `pointerId: 0` for release, but actual pointer IDs can be non-zero (e.g., touch events). Normal `pointerup` flow (line 114) correctly uses `e.pointerId`, but destroy during active drag with non-zero pointer ID won't release properly.

**Evidence:**
```javascript
// Line 139: Captures with actual pointer ID
el.setPointerCapture(e.pointerId)
// Line 141: Only stores element, not pointer ID
this.#capturedPointers.add(el)
// Line 234: Releases with hardcoded 0
el.releasePointerCapture(0)
```

**Impact:** Edge case - only affects destroy during active drag with touch/stylus input (non-zero pointer ID).

**Recommendation:** Track `{el, pointerId}` pairs or store Map instead of Set.

**Status:** [ ] To Fix (low priority)

---

### I7. Race Condition in Parameter Updates (jscad-web)
**File:** `apps/jscad-web/main.js:228-264`
**Confidence:** 85%

**Issue:** Rapid parameter changes can overwrite `lastParams` before callback executes, losing intermediate values.

**Evidence:**
```javascript
if (paramsUI.isWorking()) {
  lastParams = params  // Overwrites previous pending
  return
}
```

**Recommendation:** Use a queue instead of single variable for pending params.

**Status:** [ ] To Fix

---

### I8. FileWatcher Cleanup Pattern Inconsistency (jscad-web)
**File:** `apps/jscad-web/main.js:440-443`
**Confidence:** 70% (downgraded)

**Issue:** FileWatcher's cleanup function return value is not stored in main.js. However, `createFileWatcher` internally registers a `beforeunload` handler as fallback (fileSystem.js:229), so cleanup does occur.

**Evidence:**
```javascript
// main.js:440 - Return value ignored
fileSystem.createFileWatcher(files => ..., () => ...)

// But fileSystem.js:229 has fallback:
window.addEventListener('beforeunload', cleanup)
```

**Current Status:** Functional due to internal fallback, but inconsistent with explicit cleanup pattern used elsewhere.

**Recommendation:** For consistency and explicit control, store reference and call cleanup explicitly. Low priority since fallback exists.

**Status:** [ ] Consider (low priority)

---

### I9. Missing Worker Termination (jscad-web)
**File:** `apps/jscad-web/main.js:146-153`, `src/workerSetup.js:21-50`
**Confidence:** 80%

**Issue:** Worker is never terminated on page unload. Reference is destructured away and lost.

**Recommendation:** Store worker reference and call `worker.terminate()` on unload.

**Status:** [ ] To Fix

---

### I10. Color Picker Missing Try-Catch Protection (params-ui)
**File:** `packages/params-ui/src/ParamsTree.js:353-366`
**Confidence:** 80%

**Issue:** Color picker event listener setup lacks try-catch protection (unlike class input). If error occurs after listeners added but before cleanup registered, they leak.

**Recommendation:** Add try-catch matching the pattern used in `createClassInput` (lines 509-531).

**Status:** [ ] To Fix

---

### I11. Cleanup Error Handling in ParamsTree (params-ui)
**File:** `packages/params-ui/src/ParamsTree.js:47-52`
**Confidence:** 80%

**Issue:** `runCleanup()` doesn't handle errors from individual cleanup functions. One failure blocks remaining cleanups.

**Evidence:**
```javascript
const runCleanup = () => {
  for (const cleanup of cleanupFunctions) {
    cleanup()  // No try-catch
  }
  cleanupFunctions = []
}
```

**Recommendation:**
```javascript
for (const cleanup of cleanupFunctions) {
  try { cleanup() } catch (err) { console.error('Cleanup error:', err) }
}
```

**Status:** [ ] To Fix

---

### I12. Three.js Deferred Disposal Timing Issue (render-threejs)
**File:** `packages/render-threejs/index.js:171-191`
**Confidence:** 85%

**Issue:** `setScene()` uses setTimeout for disposal. If `destroy()` is called immediately after, the deferred callback executes after viewer is destroyed.

**Evidence:**
```javascript
setTimeout(() => {
  old.forEach(ent => {
    ent.geometry?.dispose?.()  // May execute after destroy()
    ent.material?.dispose?.()
  })
}, 0)
```

**Recommendation:** Store timeout ID and clear it in `destroy()`.

**Status:** [ ] To Fix

---

## Medium Issues

### M1. Decode Iteration Limit Missing (require)
**File:** `packages/require/src/resolveUrl.js:17-30`
**Confidence:** 70%

**Issue:** `fullyDecode` recursively decodes without iteration limit. Deeply nested encodings could cause performance issues.

**Recommendation:** Add max iteration limit (e.g., 10 rounds).

**Status:** [ ] Consider

---

### M2. Type Coercion in setParam Comparison (params-controller)
**File:** `packages/params-controller/src/ParamsController.js:116`
**Confidence:** 80%

**Issue:** Strict equality may miss updates when types differ (e.g., `5` vs `"5"`).

**Status:** [ ] Consider

---

### M3. Class Name Format Validation Missing (params-ui)
**File:** `packages/params-ui/src/ParamsTree.js:406, 433-438`
**Confidence:** 80%

**Issue:** Class names accept any string without validation. Special characters or dots could conflict with path notation.

**Recommendation:** Validate class names match `^[a-zA-Z0-9_-]+$`.

**Status:** [ ] Consider

---

### M4. Step Validation Not Enforced Programmatically (params-ui)
**File:** `packages/params-ui/src/inputs.js:82-90`
**Confidence:** 80%

**Issue:** Number inputs validate min/max but not step. Users can enter non-step values.

**Status:** [ ] Consider

---

### M5. Async Regl Loading Queue Issue (render-regl)
**File:** `packages/render-regl/index.js:237-246`
**Confidence:** 80%

**Issue:** Multiple `updateView()` calls before initialization each queue separate renders.

**Status:** [ ] Consider

---

### M6. Missing Worker State Cleanup on Error (worker)
**File:** `packages/worker/worker.js:76-84`
**Confidence:** 65%

**Issue:** Error handlers reset script lock but don't clear geometry state (`solids`, `_lastProxyState`).

**Status:** [ ] Consider

---

### M7. ShowSaveFilePicker Silent Failure (jscad-web)
**File:** `apps/jscad-web/main.js:469-481`
**Confidence:** 82%

**Issue:** In browsers without File System Access API, save operation silently fails with no user feedback.

**Status:** [ ] Consider

---

### M8. Race Condition Risk in setClass (params-controller)
**File:** `packages/params-controller/src/ParamsController.js:154-218`
**Confidence:** 80%

**Issue:** Rapid class changes could cause state inconsistency. Document non-reentrant behavior.

**Status:** [ ] Document

---

## Low Priority Issues

### L1. Unbounded Proxy Child Cache (params-core)
**File:** `packages/params-core/src/createParamsProxy.js:262-264`
**Confidence:** 85%

**Issue:** Child proxies cached indefinitely. Acceptable for typical use but could grow in dynamic scenarios.

**Status:** [ ] Monitor

---

### L2. HTML Injection Pattern (params-form)
**File:** `packages/params-form/src/params.js:197`
**Confidence:** 85%

**Issue:** Uses innerHTML with string concatenation. Currently safe (all values escaped) but fragile pattern.

**Status:** [ ] Monitor

---

### L3. Accessibility Gaps (params-ui, params-form)
**Confidence:** 100%

**Issue:** Already documented in REMAINING_ISSUES.md. Missing ARIA roles, keyboard navigation.

**Status:** [ ] Documented - Future Enhancement

---

### L4. extractPartValues Edge Case (params-controller)
**File:** `packages/params-controller/src/ParamsController.js:75-88`
**Confidence:** 75%

**Issue:** Doesn't validate params structure. Very low risk given controlled input.

**Status:** [ ] Monitor

---

## False Positives to Flag with Code Comments

### FP1. Remote Code Execution in Worker
**Files:** `packages/worker/worker.js`, `packages/require/src/require.js`

**Finding:** Code uses `new Function()` and dynamic module loading to execute arbitrary JavaScript.

**Why False Positive:** This is a fundamental, intentional feature of JSCAD - running user scripts. The worker sandbox provides isolation.

**Action:** Add comment at key locations:
```javascript
// SECURITY NOTE: Intentional code execution - JSCAD is a script playground.
// User scripts run in isolated Worker context. This is by design.
```

**Status:** [ ] Add Comments

---

### FP2. innerHTML Usage in params-form
**File:** `packages/params-form/src/params.js:197`

**Finding:** Uses `innerHTML` which could allow XSS.

**Why False Positive:** All user-controlled values are properly escaped via `escapeHtml()` function (lines 22-30). Every interpolation uses this function.

**Action:** Add comment:
```javascript
// SECURITY NOTE: All values are sanitized via escapeHtml() before interpolation.
// DO NOT add string interpolation without escaping - XSS vulnerability risk.
```

**Status:** [ ] Add Comments

---

### FP3. Dynamic Script Loading in engine.js
**File:** `apps/jscad-web/src/engine.js`

**Finding:** Dynamically loads JavaScript bundles.

**Why False Positive:** Only loads from same-origin build directory. Not user-controlled.

**Action:** Add comment if flagged:
```javascript
// NOTE: Script sources are hardcoded build paths, not user-controlled.
```

**Status:** [ ] Add Comments (if needed)

---

## Positive Findings

The codebase demonstrates excellent practices in several areas:

1. **SSRF Protection** (`remote.js:95-171`): Comprehensive IP validation blocks private ranges, link-local, IPv4-mapped IPv6.

2. **ReDoS Prevention** (`trustedSources.js:18-31`): Regex patterns validated against catastrophic backtracking.

3. **XSS Prevention**: DOM manipulation uses `textContent` and `createElement` for user data.

4. **Animation Generation Guards** (`animRunner.js`): Uses generation counters to discard stale results.

5. **Service Worker Loop Protection** (`reloadDetection.js`): Retry limits and cooldown prevent infinite loops.

6. **Index Validation** (`format-regl`): Proper bounds checking on vertex indices.

7. **Transform Validation** (`format-regl`): Identity matrix fallback for invalid data.

8. **Degenerate Polygon Handling** (`format-jscad`): Epsilon threshold prevents division by zero.

9. **Event Listener Cleanup** (`html-gizmo`): Proper tracking and disposal pattern.

10. **Transferable Objects** (`postmessage`): Comprehensive zero-copy transfer handling.

---

## Fix Priority

### Immediate (High Impact, Easy Fix)
1. I3 - STL bounds check (prevents silent data corruption)
2. I11 - Cleanup error handling (easy fix, prevents cascading failures)
3. I6 - Pointer ID tracking (causes stuck pointer state)

### Soon (Important for Long Sessions)
4. I2 - userInteracted memory leak
5. I4 - Module dependency map growth
6. I8 - FileWatcher cleanup

### When Convenient
7. I1 - Script lock race condition (low probability)
8. I7 - Parameter update race condition
9. I9 - Worker termination
10. I10 - Color picker try-catch
11. I12 - Three.js disposal timing
12. I5 - URL validation

### Document/Monitor
- M8 - setClass non-reentrant behavior
- L1-L4 - Low priority items

---

## Appendix: Files Reviewed

### apps/jscad-web
- main.js (568 lines)
- src/workerSetup.js (77 lines)
- src/fileSystem.js (270 lines)
- src/remote.js (214 lines)
- src/trustedSources.js (196 lines)
- src/trustedSourcesUI.js (553 lines)
- src/paramsUI.js (352 lines)
- src/editor.js (230 lines)
- src/engine.js (87 lines)
- src/exporter.js (107 lines)
- src/animRunner.js (120 lines)
- src/viewState.js (250 lines)
- src/error.js (53 lines)
- src/stats.js (125 lines)
- src/menu.js (68 lines)
- src/welcome.js (59 lines)
- src/drawer.js (110 lines)
- src/reloadDetection.js (48 lines)
- src/about.js (75 lines)

### packages/params-*
- params-form/src/params.js
- params-core/src/createParamsProxy.js
- params-ui/src/inputs.js
- params-ui/src/ParamsTree.js
- params-controller/src/ParamsController.js

### packages/worker, postmessage, require
- worker/worker.js
- worker/src/exportStlText.js
- postmessage/index.js
- require/src/require.js
- require/src/resolveUrl.js

### packages/render-*, format-*, orbit, scene, html-gizmo
- render-threejs/index.js
- render-babylonjs/index.js
- render-regl/index.js
- format-jscad/index.js
- format-regl/index.js
- orbit/src/OrbitControl.js
- html-gizmo/index.js

**Total:** 40+ files, ~8,000+ lines of code reviewed
