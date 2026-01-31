# JSCAD UI Code Review - Issue Tracking

**Review Date:** 2026-01-31
**Scope:** apps/jscad-web and dependent packages
**Status:** In Progress

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 10 |
| High | 26 |
| Medium | 27 |
| Low | 19 |
| **Total** | **82** |

---

## Critical Issues

### C1. Memory Leak - WebGL Buffers Not Disposed in render-regl
- [x] **Package:** `render-regl`
- **Files:** `src/commands/drawMesh.js:76-119`, `drawLines.js:50-89`, `drawLineStrip.js:51-84`, `drawMeshInstanced.js:26-29`
- **Description:** WebGL buffer resources created with `regl.buffer()` and `regl.elements()` are never disposed. Commands are cached in `drawCache` but there's no cleanup mechanism. Over time, the cache grows unbounded and underlying WebGL buffers are never freed.
- **Impact:** Progressive memory leak causing browser crashes or severe performance degradation for long-running sessions.
- **Fix:** Store buffer references, implement `dispose()` method, clear cache and dispose all WebGL resources on viewer destroy.

### C2. Incorrect Loop Bounds - Skips First Two Vertices in Bounding Box
- [x] **Package:** `format-common`
- **File:** `index.js:26`
- **Description:** The bounding box calculation loop starts at `i=5` instead of `i=3`, skipping the second vertex.
- **Impact:** Bounding boxes incorrectly calculated for all geometries, causing camera positioning and viewport fitting issues.
- **Fix:** Change `for(let i=5;` to `for(let i=3;`

### C3. Circular Dependency Detection Not Cleared on Error
- [x] **Package:** `require`
- **File:** `src/require.js:97-138`
- **Description:** If an error occurs during module loading, `requireCache.loading.delete(cacheUrl)` cleanup at line 178 is never reached. This leaves the URL in the loading set permanently.
- **Impact:** Once a module fails to load, it can never be retried, even if the error was transient.
- **Fix:** Use try-finally to ensure cleanup: `requireCache.loading.add(cacheUrl); try { ... } finally { requireCache.loading.delete(cacheUrl) }`

### C4. eval() Usage Creates Security Risk
- [ ] **Package:** `require`
- **File:** `src/require.js:24`
- **Description:** Indirect `eval()` executes user-provided module code, dangerous when loading from untrusted CDN sources.
- **Impact:** Malicious code in loaded modules executes with full JavaScript privileges.
- **Fix:** Document limitation prominently, implement CSP restrictions, add sandboxing/permission system, implement subresource integrity checks.

### C5. Race Condition in Animation Runner
- [x] **Package:** `jscad-web`
- **File:** `src/animRunner.js:24-76`
- **Description:** The `running` flag is set to `true` but `pause()` doesn't set it to `false`. If `pause()` is called immediately after `start()`, the animation might not properly stop.
- **Fix:** Add `this.running = false` in `pause()` method.

### C6. Missing Cleanup for Animation Timer
- [x] **Package:** `jscad-web`
- **File:** `src/animRunner.js:42-76`
- **Description:** Animation uses `waitTime()` with `setTimeout` but doesn't track or clear timeouts when paused.
- **Impact:** Timeout remains active after pause, causing unexpected behavior.
- **Fix:** Track timeout ID and clear it in pause method.

### C7. Service Worker Registration Failure Handling
- [x] **Package:** `jscad-web`
- **File:** `src/fileSystem.js:76-86`
- **Description:** When service worker registration fails, `shouldAllowReload()` is called but doesn't actually reload, leaving the app in a broken state.
- **Fix:** Either reload immediately or propagate the error properly.

### C8. Memory Leak - requestAnimationFrame Loop Not Stopped
- [x] **Package:** `fs-provider`
- **File:** `fs-provider.js:362`
- **Description:** The `checkFiles` function creates an infinite `requestAnimationFrame` loop that never stops, even when the service worker is destroyed.
- **Impact:** Memory leak, unnecessary CPU cycles, function continues after `clearFs()`.
- **Fix:** Add cancellation mechanism with `cancelAnimationFrame`.

### C9. Potential Path Traversal in File Resolution
- [x] **Package:** `fs-provider`
- **File:** `fs-provider.js:50,293`
- **Description:** While `splitPath()` filters `..` and `.` segments, array paths bypass this validation in `findFileInRoots`.
- **Impact:** Potential directory traversal if attacker can pass pre-split arrays.
- **Fix:** Ensure array paths are also validated in `splitPath()`.

### C10. Potential Memory Leak in Script Lock on Timeout
- [ ] **Package:** `worker`
- **File:** `worker.js:109-112`
- **Description:** When script lock times out, `release()` is called but `previousLock` promise may still be pending/hanging indefinitely with infinite loops.
- **Fix:** Add mechanism to track/terminate hanging script execution, or document limitation.

---

## High Severity Issues

### H1. Unsafe innerHTML Usage in Trusted Sources UI
- [x] **Package:** `jscad-web`
- **File:** `src/trustedSourcesUI.js:31-54,130-149`
- **Description:** Uses `innerHTML` for rendering. While `escapeHtml()` is used, defense-in-depth suggests avoiding innerHTML entirely for user content.
- **Fix:** Use `textContent` or DOM methods throughout.

### H2. Memory Leak in File Watcher
- [x] **Package:** `jscad-web`
- **File:** `src/fileSystem.js:203-222`
- **Description:** File watcher interval cleanup only works on full page unload. If file system is reinitialized, interval continues.
- **Fix:** Return cleanup function instead of relying on `beforeunload`.

### H3. Unhandled Promise Rejection in Editor
- [x] **Package:** `jscad-web`
- **File:** `src/editor.js:140-151`
- **Description:** `filesChanged` is async but doesn't catch errors from `getFileFn()` or `readAsText()`.
- **Fix:** Wrap in try-catch with proper error logging.

### H4. Type Coercion Bug in Comparison
- [x] **Package:** `jscad-web`
- **File:** `src/editor.js:144`
- **Description:** Using loose equality (`==`) to compare path strings with file objects that have `.name` property.
- **Fix:** Use strict equality (`===`).

### H5. Race Condition in Model Update
- [x] **Package:** `jscad-web`
- **File:** `src/paramsUI.js:171-214`
- **Description:** `runModelUpdate` has race condition - if called while working, `modelUpdatePending` is set but recursive call doesn't pass `deps` parameter correctly.
- **Fix:** Store pending deps and use them in recursive call.

### H6. Potential Division by Zero
- [x] **Package:** `jscad-web`
- **File:** `src/animRunner.js:28-34`
- **Description:** If `fps` is 0 or negative, division by zero occurs.
- **Fix:** Add validation: `if (!fps || fps <= 0) throw new Error('Animation fps must be positive')`

### H7. Race Condition in Module Cache Access
- [ ] **Package:** `require`
- **File:** `src/require.js:82-92`
- **Description:** Module cache lookup and LRU order update are not atomic. Concurrent require calls could corrupt LRU state.
- **Fix:** Make cache operations atomic or accept best-effort LRU tracking.

### H8. Module Cache Eviction Race Condition
- [ ] **Package:** `require`
- **File:** `src/require.js:271-285`
- **Description:** If two modules are cached simultaneously at limit, both could trigger eviction incorrectly.
- **Fix:** Use mutex/lock or redesign for concurrency safety.

### H9. Global Variable Pollution in Worker
- [ ] **Package:** `worker`
- **File:** `worker.js:121-137`
- **Description:** Multiple mutable globals track worker state, persisting across script executions.
- **Fix:** Encapsulate all worker state into single object that can be reset cleanly.

### H10. Incomplete Input Validation in resolveUrl
- [ ] **Package:** `require`
- **File:** `src/resolveUrl.js:77-136`
- **Description:** Path traversal protection via `normalizePath()` only applied to same-origin files, not cross-origin npm imports.
- **Fix:** Document why cross-origin imports skip normalization, or apply to all paths.

### H11. Memory Leak in reqMap on Unhandled Responses
- [ ] **Package:** `postmessage`
- **File:** `index.js:85-99`
- **Description:** If response never arrives and no timeout is set, promise in `reqMap` never resolves, causing memory leak.
- **Fix:** Always use a timeout (even if long) or provide way to cancel pending requests.

### H12. Inefficient Array Operations in LRU Cache
- [ ] **Package:** `require`
- **File:** `src/require.js:86-91,273-276`
- **Description:** Using `indexOf()` and `splice()` for LRU tracking is O(n), slow with many modules.
- **Fix:** Use Map for O(1) lookups and doubly-linked list for LRU, or use existing library.

### H13. transformFunc Error Handling Issues
- [ ] **Package:** `worker`
- **File:** `worker.js:340-348`
- **Description:** Error handling for syntax errors is fragile - if `transformFunc` doesn't detect the error, original unhelpful error is thrown.
- **Fix:** Compare errors or ensure `transformFunc` always throws on invalid syntax.

### H14. Inconsistent Normal Matrix Calculation
- [ ] **Package:** `render-regl`
- **File:** `src/commands/drawMesh.js:67-72`
- **Description:** Normal matrix calculation is incorrect - inverts view matrix but should be inverse transpose of model-view matrix.
- **Impact:** Incorrect lighting on transformed/scaled meshes.
- **Fix:** Compute proper inverse transpose of model-view matrix.

### H15. Race Condition in render-regl Async Initialization
- [x] **Package:** `render-regl`
- **File:** `index.js:117-177`
- **Description:** `updateView()` called before dynamic import completes, `renderer` is null so first render does nothing.
- **Fix:** Move initial `updateView()` inside `.then()` callback.

### H16. Missing Validation for Instance List
- [x] **Package:** `format-regl`
- **File:** `index.js:99-148`
- **Description:** Doesn't validate that instance list items have valid transform matrices (16 elements).
- **Fix:** Add matrix size validation with fallback to identity.

### H17. Potential Division by Zero in flatFrag Shader
- [x] **Package:** `render-regl`
- **File:** `src/shaders/mesh.js:160`
- **Description:** Flat shading doesn't handle zero-length vectors from degenerate triangles.
- **Fix:** Add length check or fallback normal.

### H18. Race Condition in Pointer Tracking
- [x] **Package:** `orbit`
- **File:** `src/OrbitControl.js:52-153`
- **Description:** `pointers` Map can get out of sync if `pointercancel`/`pointerup` events are missed.
- **Fix:** Add more robust state validation and recovery.

### H19. Infinite Loop Risk in normalizeAngle
- [x] **Package:** `orbit`
- **File:** `src/normalizeAngle.js:9-13`
- **Description:** `while` loops without guards - `Infinity`, `-Infinity`, or `NaN` creates infinite loop.
- **Fix:** Add validation: `if (!Number.isFinite(a)) return 0`

### H20. Missing Input Validation in makeGrid
- [x] **Package:** `scene`
- **File:** `src/makeGrid.js:18`
- **Description:** Validates `size` but not `color1` and `color2` arrays.
- **Fix:** Add color array validation with defaults.

### H21. Missing Error Boundary in Promise.race Timeout
- [x] **Package:** `fs-serviceworker`
- **File:** `fs-serviceworker.js:115-119`
- **Description:** Timeout Promise always resolves, errors in `fetchFile()` after timeout are silently ignored.
- **Fix:** Add error handling to log issues even when timeout wins.

### H22. Color Swatch Comparison Bug
- [x] **Package:** `params-ui`
- **File:** `src/inputs.js:290-294`
- **Description:** Compares `style.backgroundColor` (rgb format) with hex strings - always fails.
- **Fix:** Compare using `title` attribute only, or normalize both to hex.

### H23. Value Validation Missing in Number Input
- [x] **Package:** `params-ui`
- **File:** `src/inputs.js:79-84`
- **Description:** Number input's `oninput` handler doesn't validate against min/max constraints.
- **Fix:** Add constraint validation before calling `onChange`.

### H24. Missing Cleanup Tracking for Class Input
- [x] **Package:** `params-ui`
- **File:** `src/ParamsTree.js:486-516`
- **Description:** Document-level event listeners added but if error occurs before cleanup registration, listeners leak.
- **Fix:** Add try-catch around cleanup registration.

### H25. Missing Error Handling in jscadMain Params Processing
- [x] **Package:** `worker`
- **File:** `worker.js:224-231`
- **Description:** File parameter deserialization can fail without meaningful error message.
- **Fix:** Wrap in try-catch with context about which parameter failed.

### H26. Unhandled Promise Rejection in checkFiles
- [x] **Package:** `fs-provider`
- **File:** `fs-provider.js:343-363`
- **Description:** Errors in recursive `requestAnimationFrame` call are unhandled rejections.
- **Fix:** Wrap recursive call in try-catch.

---

## Medium Severity Issues

### M1. Missing Null Check in Editor
- [x] **Package:** `jscad-web`
- **File:** `src/editor.js:109-114`
- **Description:** `document.getElementById` can return null but code assumes elements exist.
- **Fix:** Add null checks before adding event listeners.

### M2. Inconsistent Error Handling in Remote Loading
- [x] **Package:** `jscad-web`
- **File:** `src/remote.js:62-86`
- **Description:** Returns `true` on success but only logs errors instead of returning `false`.
- **Fix:** Return `false` on error for consistent API.

### M3. Unsafe parseInt Without Radix
- [x] **Package:** `jscad-web`
- **File:** `src/drawer.js:39`
- **Description:** `parseInt` without radix parameter can lead to unexpected behavior.
- **Fix:** Add radix parameter: `parseInt(..., 10)`

### M4. Memory Leak - Event Listener Not Removed
- [x] **Package:** `jscad-web`
- **File:** `src/trustedSourcesUI.js:88-96`
- **Description:** Keydown event listener for Escape only removed on Escape, not on Cancel/Allow buttons.
- **Fix:** Add cleanup to all exit paths.

### M5. Duplicate Code in Trusted Sources UI
- [ ] **Package:** `jscad-web`
- **File:** `src/trustedSourcesUI.js:56-87,205-218`
- **Description:** Overlay click and Escape key handlers duplicated in two functions.
- **Fix:** Extract to shared utility function.

### M6. Inconsistent Nullish Checks
- [x] **Package:** `jscad-web`
- **File:** `src/stats.js:22-26,81-96`
- **Description:** Mixing `== null` and `!= null` checks inconsistently.
- **Fix:** Use consistent patterns throughout.

### M7. Potential NaN from Invalid Input
- [x] **Package:** `jscad-web`
- **File:** `src/animRunner.js:34`
- **Description:** `parseFloat(value)` can return NaN which propagates through calculations.
- **Fix:** Check for NaN and reset to min value.

### M8. SSRF Protection Could Be Bypassed
- [ ] **Package:** `jscad-web`
- **File:** `src/remote.js:93-126`
- **Description:** `isValidRemoteUrl` doesn't handle IPv6, DNS rebinding, or redirect chains.
- **Fix:** Enhance validation or rely on server-side proxy.

### M9. Floating Promise in Main.js
- [x] **Package:** `jscad-web`
- **File:** `main.js:177`
- **Description:** `reloadProject()` is async but called without await, errors aren't caught.
- **Fix:** Add `.catch(err => setError(err))`.

### M10. Regex Injection in Trusted Sources
- [ ] **Package:** `jscad-web`
- **File:** `src/trustedSources.js:100-109`
- **Description:** User-provided regex patterns used directly in `new RegExp()` could cause ReDoS.
- **Fix:** Add timeout/complexity limits or use simple glob patterns.

### M11. Unbounded Growth of userInteracted Set
- [x] **Package:** `worker`
- **File:** `worker.js:219-221`
- **Description:** `userInteracted` set never cleared except in `jscadScript()`, accumulates across `jscadMain()` calls.
- **Fix:** Clear or limit size periodically.

### M12. extractDefaults Doesn't Validate Choice Type
- [x] **Package:** `worker`
- **File:** `src/extractDefaults.js:8-23`
- **Description:** If choice parameter's default value not in `values`, invalid default is kept.
- **Fix:** Always fall back to `values[0]` or throw error.

### M13. Inconsistent Path Sanitization
- [ ] **Package:** `fs-provider`
- **File:** `fs-provider.js:447-451,461,468-469`
- **Description:** `sanitizePath()` defined but only used in 3 specific places, not consistently.
- **Fix:** Apply consistently to all user-provided paths.

### M14. Unused Variables Throughout
- [x] **Package:** `render-threejs`
- **Files:** `index.js:31-33,95`
- **Description:** `SHADOW`, `_shouldRender`, `_lastRender`, `tmFunc` variables declared but never used.
- **Fix:** Remove unused code or add TODO comments.

### M15. Inconsistent Index Type Detection
- [ ] **Package:** Multiple render packages
- **Files:** All draw command files
- **Description:** Index type check assumes Uint32Array or Uint16Array, doesn't handle plain Array.
- **Fix:** Add explicit type checking with error for invalid types.

### M16. Degenerate Polygon Detection Incomplete
- [ ] **Package:** `format-jscad`
- **File:** `index.js:21-22,46-47,90-91`
- **Description:** Degenerate polygon detection only after normalization, not before color processing.
- **Fix:** Add check before color processing loop.

### M17. Integer Overflow in Infinite Loop Protection
- [ ] **Package:** `transform-babel`
- **File:** `src/preventInfiniteLoops.js:26-31`
- **Description:** Loop iterator scoped to parent, nested loops share counter. Also precision issues after 2^53.
- **Fix:** Use loop-specific counters with `path.scope`.

### M18. Safari Polyfill Error Handling Too Broad
- [ ] **Package:** `fs-provider`
- **File:** `src/safariFileHandles.js:25-31`
- **Description:** Catches all errors and continues, hiding legitimate errors.
- **Fix:** Only catch expected Safari errors, re-throw unexpected.

### M19. Redundant State in OrbitControl
- [ ] **Package:** `orbit`
- **File:** `src/OrbitControl.js:42-49`
- **Description:** Multiple boolean flags track overlapping states, creating inconsistency opportunities.
- **Fix:** Use state machine or single state enum.

### M20. Inefficient Tree Path Comparison
- [ ] **Package:** `params-ui`
- **File:** `src/ParamsTree.js:71-81,538-539`
- **Description:** Creates and joins array every time for tree structure comparison, O(n) on every update.
- **Fix:** Cache tree path hash or use object identity comparison.

### M21. Duplicate Parameter Path Computation
- [ ] **Package:** `params-core`
- **File:** `src/createParamsProxy.js:226-227,267-268`
- **Description:** `fullPath` computed twice in both get and set handlers.
- **Fix:** Extract to helper function.

### M22. Hidden Parameter Logic Inconsistency
- [ ] **Package:** `params-core`
- **File:** `src/createParamsProxy.js:307,461-463`
- **Description:** `_class` explicitly marked hidden but already covered by `startsWith('_')` rule.
- **Fix:** Remove redundant `hidden: true`.

### M23. Regex Numeric String Detection Inefficiency
- [x] **Package:** `params-form`
- **File:** `src/params.js:303`
- **Description:** Regex compiled on every loop iteration.
- **Fix:** Compile regex once outside function.

### M24. Weak Error Messages Leak Implementation Details
- [ ] **Package:** `fs-provider`
- **File:** `src/FileReader.js:37,46`
- **Description:** Error messages expose internal file details.
- **Fix:** Sanitize error messages for production.

### M25. Missing Validation in toFSEntry
- [ ] **Package:** `fs-provider`
- **File:** `src/FSEntry.js:31-53`
- **Description:** Doesn't validate `handle` or `parent` before accessing properties.
- **Fix:** Add input validation with TypeError.

### M26. Inconsistent Map/Object Handling
- [ ] **Package:** `params-controller`
- **File:** `src/ParamsController.js:58,95-96,228-236`
- **Description:** Stores as plain objects but helper functions expect Maps, converts on every call.
- **Fix:** Store as Maps consistently.

### M27. Unsafe Type Coercion in Choice/Radio Inputs
- [x] **Package:** `params-ui`
- **File:** `src/inputs.js:387-388,436-437`
- **Description:** String comparison can fail for null, undefined, or NaN values.
- **Fix:** Use more robust comparison handling edge cases.

---

## Low Severity Issues

### L1. Dead Code - Unused Variable
- [x] **Package:** `jscad-web`
- **File:** `src/addV1Shim.js:8`
- **Description:** `debug` destructured but never used.
- **Fix:** Remove from destructuring.

### L2. Console.warn Instead of Console.log
- [x] **Package:** `jscad-web`
- **File:** `main.js:129`
- **Description:** Bounding box coordinates logged with `console.warn` instead of `console.log`.
- **Fix:** Use appropriate log level.

### L3. Dead Code: exportData Reference
- [x] **Package:** `worker`
- **File:** `worker.js:415`
- **Description:** `self.exportData` checked but never set or documented.
- **Fix:** Remove or document this hook.

### L4. Missing TypeScript Return Type Annotations
- [ ] **Package:** `require`
- **File:** Multiple files
- **Description:** Functions have JSDoc params but missing `@returns` annotations.
- **Fix:** Add return type documentation.

### L5. Incomplete Transferable Cleanup
- [ ] **Package:** `postmessage`
- **File:** `index.js:35-38`
- **Description:** Transferable symbol deleted but caller might retain references to neutered buffers.
- **Fix:** Document that callers should not use transferable objects after sending.

### L6. Commented-Out Dead Code
- [x] **Package:** `orbit`
- **File:** `src/fromXZRotation.js:13-30`
- **Description:** Large block of commented-out code duplicating active code.
- **Fix:** Delete lines 13-30.

### L7. Magic Numbers Without Constants
- [x] **Package:** `orbit`
- **File:** `src/OrbitState.js:105,106`
- **Description:** rx bounds use magic numbers without explanation.
- **Fix:** Add named constants with comments.

### L8. Inconsistent Naming Convention
- [ ] **Package:** `html-gizmo`
- **File:** `index.js:43,59`
- **Description:** Mix of private field naming conventions.
- **Fix:** Consider making `names` private with getter.

### L9. Unnecessary Variable Declarations
- [x] **Package:** `fs-provider`
- **File:** `fs-provider.js:272`
- **Description:** Uses `var` instead of `const`/`let`.
- **Fix:** Use `let` instead.

### L10. Hardcoded Timeout Value
- [x] **Package:** `scene`
- **File:** `downloadBlob.js:7`
- **Description:** 1000ms timeout hardcoded, may not be enough for large files.
- **Fix:** Make configurable with default.

### L11. Commented-Out Debug Code
- [ ] **Package:** `render-threejs`
- **File:** `index.js:262-277`
- **Description:** Commented-out bounding box visualization code.
- **Fix:** Remove or extract to debug utility.

### L12. Missing Null Checks in Format Converters
- [ ] **Package:** `format-threejs`, `format-regl`
- **Files:** `index.js:31`, `index.js:18`
- **Description:** Don't validate that `vertices` is actually a TypedArray.
- **Fix:** Add type validation.

### L13. DOM Property Mutation
- [ ] **Package:** `params-form`
- **File:** `src/params.js:233,251`
- **Description:** Adding custom properties to DOM elements is code smell.
- **Fix:** Use WeakMap to associate data with DOM elements.

### L14. Missing Return Type for updateValue
- [ ] **Package:** `params-ui`
- **File:** `src/inputs.js` (multiple functions)
- **Description:** `updateValue` methods don't document void return.
- **Fix:** Add JSDoc `@returns {void}`.

### L15. Magic Numbers for Step Values
- [ ] **Package:** `params-core`
- **File:** `src/createParamsProxy.js:146-149,183-187`
- **Description:** Default step values hardcoded in multiple places.
- **Fix:** Define named constants.

### L16. Unclear Variable Naming
- [x] **Package:** `params-form`
- **File:** `src/params.js:96-97`
- **Description:** `fps` variable modified in place, unclear naming.
- **Fix:** Use separate variable: `const safeFps = fps <= 0 ? 1 : fps`

### L17. Unclear Error Handling for Missing Input Functions
- [x] **Package:** `params-form`
- **File:** `src/params.js:163-171`
- **Description:** Dead code - `if (!inputFunc)` check is unreachable due to `|| inputDefault`.
- **Fix:** Remove dead code.

### L18. Missing JSDoc for Complex Functions
- [ ] **Package:** `scene`
- **File:** `src/makeGrid.js:33-49`
- **Description:** Internal helper functions not documented.
- **Fix:** Add JSDoc comments.

### L19. Unused Import in calcCamPos
- [ ] **Package:** `orbit`
- **File:** `src/calcCamPos.js:4`
- **Description:** `OrbitState` imported but only used in JSDoc comment.
- **Fix:** Move type to separate types file or accept as documentation.

---

## Notes

### Packages Reviewed
- `apps/jscad-web` - Main application
- `packages/worker` - Web Worker for executing JSCAD scripts
- `packages/postmessage` - RPC-style postMessage wrapper
- `packages/require` - ES module loader/resolver
- `packages/format-common` - TypeScript type definitions
- `packages/format-jscad` - JSCAD to WebGL-ready format conversion
- `packages/format-threejs` - Three.js adapter
- `packages/format-regl` - regl adapter
- `packages/render-threejs` - Three.js renderer
- `packages/render-regl` - regl renderer
- `packages/params-core` - Parameter proxy system
- `packages/params-controller` - Parameter controller
- `packages/params-ui` - Parameter UI components
- `packages/params-form` - Parameter form generator
- `packages/fs-provider` - File system provider
- `packages/fs-serviceworker` - Service worker file system
- `packages/orbit` - Camera orbit controls
- `packages/html-gizmo` - Camera orientation widget
- `packages/scene` - Scene utilities
- `packages/transform-babel` - Babel transform utilities

### Priority Recommendations

1. **Immediate** - Fix critical memory leaks (C1, C8, C10) and security issues (C4, C9)
2. **High Priority** - Address race conditions (C5, H5, H7, H8, H15, H18) and error handling gaps
3. **Medium Priority** - Performance optimizations and code quality improvements
4. **Low Priority** - Documentation and minor code smells

### Testing Recommendations

- Add unit tests for boundary conditions (division by zero, NaN, Infinity)
- Add integration tests for service worker lifecycle
- Add memory leak detection tests for long-running sessions
- Add stress tests for concurrent module loading
