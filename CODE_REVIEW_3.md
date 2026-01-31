# Code Review 3 - Deep Security and Quality Analysis

**Date:** 2026-01-31
**Scope:** apps/jscad-web and dependent local packages
**Methodology:** Multi-agent specialized code review with manual verification

## Executive Summary

This review used multiple specialized code review agents to analyze security, code quality, memory management, and error handling across the jscad-web application and its dependencies. The codebase shows evidence of recent security hardening (H1-H26 fixes, C1-C9 fixes), but several issues remain.

**Issue Counts:**
| Severity | Count |
|----------|-------|
| Medium   | 5     |
| Low      | 12    |
| Info/FP  | 6     |

---

## Medium Severity Issues

### M1. ReDoS Risk in Trusted Sources Regex

**File:** `apps/jscad-web/src/trustedSources.js:103`
**Status:** Open

User-controlled regex patterns from localStorage are compiled and executed without validation. A malicious user could craft a pathological regex pattern that causes catastrophic backtracking.

```javascript
const pathRegex = new RegExp(rule.pathPattern)  // Line 103
if (pathRegex.test(url.pathname)) {
  return true
}
```

**Impact:** DoS via CPU exhaustion when checking URLs against malicious patterns.

**Recommendation:** Add regex validation or use simpler glob-based matching:
```javascript
const isSafeRegex = (pattern) => {
  // Block common ReDoS patterns like (a+)+, (a*)*
  if (/(.*\+.*\+|.*\*.*\*)/g.test(pattern)) return false
  if (pattern.length > 100) return false
  return true
}
```

---

### M2. Path Traversal in Development Server

**File:** `apps/jscad-web/serve.js:51`
**Status:** Open

The development server uses `path.join` to construct file paths without validating the result stays within the build directory.

```javascript
const filePath = path.join(process.cwd(), 'build', pathname)
```

**Impact:** Attackers could read arbitrary files on the development machine via `../` sequences.

**Recommendation:**
```javascript
const buildDir = path.resolve(process.cwd(), 'build')
const filePath = path.resolve(buildDir, pathname.replace(/^\/+/, ''))
if (!filePath.startsWith(buildDir + path.sep)) {
  return { status: 403, content: 'forbidden' }
}
```

---

### M3. Missing IPv6 SSRF Validation in Server-Side

**File:** `apps/jscad-web/serve.js:72-101`
**Status:** Open

The server-side `isValidRemoteUrl` function lacks the comprehensive IPv6 validation present in the client-side version (`remote.js` H9 fix).

```javascript
// Only blocks basic cases
if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
  return false
}
// Missing: fe80::, ::ffff:127.0.0.1, fc00::, etc.
```

**Impact:** SSRF via IPv6 addresses like `[::ffff:127.0.0.1]` or `[fe80::1]`.

**Recommendation:** Sync server-side validation with the comprehensive client-side implementation in `remote.js`.

---

### M4. Memory Leak in postmessage destroy()

**File:** `packages/postmessage/index.js:170-172`
**Status:** Open

The `destroy()` method removes the event listener but does not clean up pending requests in `reqMap`. Pending requests, their timeouts, and promise callbacks remain in memory.

```javascript
const destroy = () => {
  _self.removeEventListener?.('message', wrappedListener)
  // Missing: cleanup of reqMap
}
```

**Recommendation:**
```javascript
const destroy = () => {
  _self.removeEventListener?.('message', wrappedListener)
  for (const [id, [resolve, reject, timeoutId]] of reqMap.entries()) {
    if (timeoutId) clearTimeout(timeoutId)
    reject(new Error('Messaging destroyed with pending request'))
  }
  reqMap.clear()
  onJobCount?.(0)
}
```

---

### M5. OrbitControl Not Destroyed in Apps

**File:** `apps/jscad-web/main.js:558-566`
**Status:** Open

OrbitControl instances are created (line 85) but never destroyed. The cleanup handler destroys menu, remote, welcome, about, editor, and viewer, but NOT the `ctrl` OrbitControl instance.

```javascript
window.addEventListener('unload', () => {
  menu.destroy()
  remote.destroy()
  welcome.destroy()
  about.destroy()
  paramsUI.destroyParamsTreeView()
  editor.destroy()
  viewState.viewer?.destroy?.()
  // Missing: ctrl.destroy()
})
```

**Impact:** Event listeners persist, requestAnimationFrame continues, memory leaks.

**Recommendation:** Add `ctrl.destroy()` to the cleanup handler.

---

## Low Severity Issues

### L1. Prototype Pollution Risk in saveMap

**File:** `apps/jscad-web/src/fileSystem.js:195`
**Status:** Open

User-controlled file paths are used as object keys without validation. Paths like `__proto__` could potentially pollute object prototypes.

**Recommendation:** Use `Map` instead of plain object, or validate keys.

---

### L2. Race Condition in Script Lock Timeout

**File:** `packages/worker/worker.js:105-136`
**Status:** Open (Design Limitation)

When `acquireScriptLock` times out, the timed-out script continues executing (JavaScript can't terminate running code). This can cause race conditions where two scripts execute simultaneously.

**Note:** This is a fundamental JavaScript limitation. The code already has a comment acknowledging this.

**Recommendation:** Add a flag to track abandoned scripts and refuse new executions until the abandoned script completes.

---

### L3. FileReader Error Handler Memory Pattern

**File:** `packages/fs-provider/src/FileReader.js:42-52`
**Status:** Open

When FileReader errors occur, the reader object and event handlers remain in closure scope until garbage collection.

**Recommendation:** Clear event handlers explicitly:
```javascript
reader.onerror = error => {
  reader.onload = null
  reader.onerror = null
  reject(new Error('error reading ' + f.name))
}
```

---

### L4. Missing Safari DataTransferItem Validation

**File:** `packages/fs-provider/src/safariFileHandles.js:49-52`
**Status:** Open

`safariGetAsHandle` doesn't validate that `dti` is a valid DataTransferItem or that `webkitGetAsEntry()` exists/returns a value.

**Recommendation:** Add validation before calling methods.

---

### L5. Race Condition in checkFiles

**File:** `packages/fs-provider/fs-provider.js:366-390`
**Status:** Open

The file checking function can have race conditions if `sw.filesToCheck` is modified during async operations by `clearFs()` or `fileDropped()`.

**Recommendation:** Create a snapshot of the array before async operations.

---

### L6. checkFiles Uses Promise.all (Single Failure Stops All)

**File:** `packages/fs-provider/fs-provider.js:371`
**Status:** Open

If any single file check throws (e.g., permission denied), `Promise.all` rejects and no files get checked.

**Recommendation:** Use `Promise.allSettled` instead.

---

### L7. NaN Propagation in Bounds Calculation

**File:** `packages/render-regl/src/utils/bounds.js:33-46`
**Status:** Open

`boundingBox()` doesn't validate that position values are finite numbers. NaN or Infinity values propagate through min/max comparisons, breaking camera/rendering.

**Recommendation:** Add `Number.isFinite(val)` check before comparisons.

---

### L8. Near-Zero Division in Normal Calculation

**File:** `packages/format-jscad/index.js:129-132`
**Status:** Open

The code checks `len === 0` but doesn't handle near-zero values that could produce very large or NaN results.

```javascript
const len = Math.hypot(Nx, Ny, Nz)
if (len === 0) return [0, 0, 1]  // Good
return [Nx / len, Ny / len, Nz / len]  // Risk with near-zero
```

**Recommendation:** Use epsilon threshold: `if (len < 1e-10) return [0, 0, 1]`

---

### L9. Pointer Capture Not Released on OrbitControl Destroy

**File:** `packages/orbit/src/OrbitControl.js:210-220`
**Status:** Open

If `destroy()` is called while a pointer is captured (during drag), the pointer remains captured indefinitely.

**Recommendation:** Track captured pointers and release them in destroy().

---

### L10. Missing NaN Validation in fromXZRotation

**File:** `packages/orbit/src/fromXZRotation.js:7-13`
**Status:** Open

If `rx` or `rz` are NaN/Infinity, the resulting matrix will contain invalid values that cascade through orbit calculations.

**Recommendation:** Return identity matrix for invalid inputs.

---

### L11. Gizmo setNames() Leak When Called Before Connection

**File:** `packages/html-gizmo/index.js:101-116`
**Status:** Open

If `setNames()` is called before the element is connected to DOM, listeners are registered but `disconnectedCallback()` won't be triggered.

**Recommendation:** Guard `setNames()` to only operate when connected or defer setup.

---

### L12. Negative Number Regex in params-form

**File:** `packages/params-form/src/params.js:14`
**Status:** Open

`NUMERIC_STRING_REGEX = /^(\d+|\d+\.\d+)$/` doesn't match negative numbers, so `-5` stays as string.

**Recommendation:** Update to `/^-?(\d+|\d+\.\d+)$/`

---

## Informational / False Positives

### FP1. Color Input Validation (FALSE POSITIVE)

**File:** `packages/params-ui/src/inputs.js:302-317`
**Reported Issue:** Color values passed to `onChange` bypass validation.

**Verification:** This is a false positive. The `selectColor()` function is only called from:
1. `hexInput.onchange` - which validates the hex format first (line 311)
2. Swatch clicks - which use pre-defined hex values from `s.title`
3. Palette selections - which use pre-defined palette colors

All code paths either validate input or use pre-defined safe values.

**Recommendation:** Add code comment to prevent future confusion:
```javascript
// Note: selectColor() is only called with validated hex values from hexInput.onchange
// or pre-defined swatch/palette colors. No additional validation needed here.
const selectColor = (color) => {
```

---

### FP2. Number Input Min/Max Validation (FALSE POSITIVE)

**File:** `packages/params-ui/src/inputs.js:79-87`
**Reported Issue:** Missing blur validation for min/max.

**Verification:** This is mostly a false positive. The `oninput` event fires on every keystroke including when using spinner buttons. Combined with HTML5 native `min/max` attributes, values are properly constrained. Edge cases are minimal.

**Recommendation:** Add code comment documenting the validation approach:
```javascript
// H23 fix: oninput validates on every keystroke. HTML5 min/max attributes
// provide additional browser-level validation. No blur handler needed.
input.oninput = () => {
```

---

### FP3. Type Mismatch in Index Array (FALSE POSITIVE)

**File:** `packages/format-jscad/index.js:33`
**Reported Issue:** Index buffer type determination may be incorrect.

**Verification:** The logic `vLen / 3 > 65535` correctly checks vertex count since index values range from 0 to (vertex_count - 1). This is correct.

---

### FP4. Closure Memory Leak in OrbitControl (FALSE POSITIVE)

**File:** `packages/orbit/src/OrbitControl.js:88-176`
**Reported Issue:** Event handler closures capture OrbitControl instance.

**Verification:** The `destroy()` method properly removes all listeners, breaking the reference chain. This is handled correctly.

---

### FP5. Loading Set Circular Dependency Check (FALSE POSITIVE)

**File:** `packages/require/src/require.js:81-148`
**Reported Issue:** Circular dependency detection might fail for cached modules.

**Verification:** Cached modules are already fully loaded, so circular dependency detection isn't needed for them. The current logic is correct.

---

### FP6. Infinite Loop in normalizeAngle (FALSE POSITIVE)

**File:** `packages/orbit/src/normalizeAngle.js:10-14`
**Reported Issue:** While loops could run many times for large values.

**Verification:** The H19 fix already handles Infinity/NaN. Large but finite values would complete quickly (max ~100 iterations for reasonable inputs). This is acceptable.

---

## Already-Fixed Issues (Good Practices Observed)

The codebase shows evidence of recent security work:

| Fix ID | Description | Location |
|--------|-------------|----------|
| H1 | Async error handling in message listener | postmessage/index.js:159-164 |
| H2 | Timeout cleanup when response arrives | postmessage/index.js:126-127 |
| H8 | Loading set cleanup on module errors | require/src/require.js |
| H9 | Comprehensive IPv6 SSRF prevention | apps/jscad-web/src/remote.js |
| H10 | Workspace path sanitization | fs-provider |
| H11 | Default timeout prevents memory leak | postmessage/index.js:6-8 |
| H19 | Finite number check in normalizeAngle | orbit/src/normalizeAngle.js |
| H20 | Color validation in makeGrid | scene/makeGrid.js |
| H23 | Min/max validation for number inputs | params-ui/src/inputs.js:82-84 |
| C1 | Cleanup methods for renderers | render-regl/index.js |
| C8 | stopCheckFiles cancels animation frame | fs-provider |
| C9 | Path traversal prevention via splitPath | fs-provider |

---

## Recommendations Summary

### Priority 1 (Security)
1. **M1** - Add ReDoS protection to trusted sources regex
2. **M2** - Add path traversal protection to serve.js
3. **M3** - Sync server-side SSRF validation with client-side IPv6 checks

### Priority 2 (Memory/Resources)
4. **M4** - Clean up pending requests in postmessage destroy()
5. **M5** - Add ctrl.destroy() to jscad-web cleanup handler
6. **L3** - Clear FileReader handlers on error
7. **L9** - Release pointer capture on OrbitControl destroy

### Priority 3 (Robustness)
8. **L6** - Use Promise.allSettled in checkFiles
9. **L7** - Validate finite numbers in bounds calculation
10. **L8** - Use epsilon threshold for normal length check
11. **L10** - Validate rx/rz in fromXZRotation

### Priority 4 (Code Quality)
12. Add code comments to FP1 and FP2 locations to prevent future false positives

---

## Files Reviewed

### apps/jscad-web
- main.js, serve.js, trustedSources.js, trustedSourcesUI.js
- remote.js, fileSystem.js, animRunner.js, viewState.js
- editor.js, exporter.js, params.js, paramsUI.js, stats.js

### packages/postmessage
- index.js

### packages/worker
- worker.js

### packages/require
- src/require.js, src/resolveUrl.js, src/readFileWeb.js

### packages/fs-provider
- fs-provider.js, src/FSEntry.js, src/FileReader.js, src/safariFileHandles.js

### packages/fs-serviceworker
- fs-serviceworker.js

### packages/params-core
- src/createParamsProxy.js, src/convertLegacyDefs.js

### packages/params-controller
- src/controller.js

### packages/params-ui
- src/inputs.js, src/ParamsTree.js

### packages/params-form
- src/params.js

### packages/format-jscad
- index.js

### packages/format-threejs
- index.js

### packages/render-threejs
- index.js

### packages/render-regl
- index.js, src/prepareRender.js, src/utils/bounds.js

### packages/scene
- makeGrid.js

### packages/orbit
- src/OrbitControl.js, src/OrbitState.js, src/normalizeAngle.js
- src/calcCamPos.js, src/fromXZRotation.js

### packages/html-gizmo
- index.js
