# Phase 1 Review Findings (2026-01-24)

## Executive Summary

Phase 1 reviewed 7 core foundation packages with zero internal dependencies. Found **37 issues** across all packages, with **10 critical** issues requiring immediate attention.

### Critical Issues by Category

| Category | Count | Priority |
|----------|-------|----------|
| 🔒 Security (XSS) | 3 | Immediate |
| 🐛 Memory Leaks | 7 | High |
| 🐛 Logic Bugs | 5 | High |
| ⚡ Performance | 2 | Medium |
| 📝 Type Safety | 4 | Medium |
| 🧹 Code Quality | 16 | Low |

---

## 1.1 packages/postmessage

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: timeout doesn't clean up reqMap | index.js:88-92 |
| High | 🐛 Bug | Undefined `id` variable in sendNotify debug log | index.js:67 |
| High | 🐛 Bug | Missing error response for unknown handlers | index.js:123-126 |
| High | 🐛 Bug | Race condition: timeout doesn't prevent double resolution | index.js:88-92 |
| Medium | 🔒 Security | Unrestricted method invocation (prototype pollution risk) | index.js:122-129 |
| Medium | 🐛 Bug | Typo: `crated` should be `created` | index.js:162 |
| Medium | 📝 Docs | JSDoc typos and incorrect types | index.js:22 |

### Recommendations
1. Add `reqMap.delete(id)` and `onJobCount?.(reqMap.size)` in timeout handler
2. Fix undefined `id` in sendNotify debug log
3. Use `Object.hasOwn(handlers, method)` to prevent prototype pollution
4. Send error response when handler is missing

---

## 1.2 packages/format-common

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | `JscadLinesEntity` extends wrong interface (JscadLineEntityRaw instead of JscadLinesEntityRaw) | src/output.d.ts:31 |
| High | 📝 Types | CSG types missing `type` discriminator for union narrowing | src/csg.d.ts:3-42 |
| Medium | 📝 Types | `indices` required but docs say optional | src/output.d.ts:38 |
| Medium | 📝 Types | `opacity` typed as `unknown` with TODO | src/output.d.ts:42 |
| Medium | 📝 Types | `UserParameters` weak typing | src/output.d.ts:60 |

### Recommendations
1. Fix `JscadLinesEntity` to extend `JscadLinesEntityRaw`
2. Add `type` discriminator field to all CSG interfaces
3. Resolve `indices` optional/required inconsistency
4. Complete TODO types (opacity, UserParameters)

---

## 1.3 packages/scene

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Buffer overflow: `lines1` undersized by 12 floats | src/makeGrid.js:21-22 |
| Medium | 🧹 Quality | Inconsistent color property: `color` vs `colors` | makeGrid.js:55 vs makeAxes.js:21 |
| Medium | 📝 Docs | Invalid JSDoc syntax | src/makeGrid.js:2-6 |
| Medium | 🧹 Quality | Missing input validation | Both files |
| High | ✅ Testing | No test coverage despite test infrastructure | Package-wide |

### Recommendations
1. Fix array allocation: `mainLinesInLoop * 24 + 24` instead of `mainLineCount * 12 + 12`
2. Standardize color property naming
3. Add input validation for size, color arrays
4. Add test files for both functions

---

## 1.4 packages/html-gizmo

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: event listeners never removed (no disconnectedCallback) | index.js:67-68, 120-126 |
| High | 🐛 Bug | Event listener accumulation on setNames() - appends without clearing | index.js:70-79 |
| Medium | 🐛 Bug | Multiple registration error in static block | index.js:31-34 |
| Medium | 🐛 Bug | Shadow DOM reattachment error on reconnect | index.js:56-57 |

### Recommendations
1. Implement `disconnectedCallback()` for cleanup
2. Clear existing children before `setNames()` appends new ones
3. Guard `customElements.define()` with `customElements.get()` check
4. Check `this.#root` before calling `attachShadow()`

---

## 1.5 packages/orbit

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: requestAnimationFrame never canceled | src/OrbitControl.js:140, 155 |
| High | 🐛 Bug | Memory leak: event listeners never removed | src/OrbitControl.js:68-138 |
| High | 🐛 Bug | Division by zero when camera at target position | src/camRotation.js:10-11 |
| High | 🐛 Bug | Pointer capture not released on missed pointerup | src/OrbitControl.js:80, 100 |
| High | 🐛 Bug | Race condition in pinch gesture state | src/OrbitControl.js:53-54, 117-128 |
| Medium | ⚡ Perf | normalizeAngle uses while loops (O(n) for large angles) | src/normalizeAngle.js:9-12 |
| Medium | 🧹 Quality | Missing wheel event preventDefault | src/OrbitControl.js:89-92 |

### Recommendations
1. Add `destroy()` method to clean up RAF and event listeners
2. Add `len == 0` check in camRotation
3. Check `pointers.size >= 2` in calculatePinch
4. Use modulo for normalizeAngle: `a = a % TAU`
5. Add `e.preventDefault()` to wheel handler

---

## 1.6 packages/params-form

**Reviewed:** 2026-01-24 | **Severity:** 🔴 Critical (Security)

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | 🔒 Security | XSS: Unescaped user input in innerHTML (caption, name, value, placeholder) | src/params.js:36,47-49,57-62,75-82,113-127,158,162 |
| High | 🐛 Bug | Memory leak: event listeners not cleaned up | src/params.js:209-223, 238 |
| Medium | 🧹 Quality | Custom properties on DOM elements (fragile state) | src/params.js:194, 204, 222 |
| Medium | 🧹 Quality | Inconsistent FPS validation logic | src/params.js:68, 145-147, 200-202 |

### Recommendations
1. **IMMEDIATE**: Implement HTML escaping function and apply to all template interpolations
2. Better: Use DOM APIs (createElement, setAttribute, textContent) instead of innerHTML
3. Return cleanup function from genParams
4. Use WeakMap for element-to-data associations

---

## 1.7 packages/themes

**Reviewed:** 2026-01-24 | **Severity:** 🟡 Medium

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Circular export: `export * from './index'` | themes/index.ts:18 |
| Medium | 🧹 Quality | One theme file minified (inconsistent formatting) | themes/technologymeetsnature.ts:1 |
| Medium | 📝 Types | Missing Theme interface definition | Package-wide |
| Low | 🧹 Quality | Inconsistent number precision (2 vs 17 decimal places) | Various theme files |

### Recommendations
1. Remove circular export on line 18
2. Reformat technologymeetsnature.ts to match project standards
3. Add `Theme` interface and apply to all exports
4. Standardize color precision to 2-3 decimal places

---

## Priority Action Items

### Immediate (Security)
1. [x] **params-form XSS**: Add HTML escaping or switch to DOM APIs → PR #2

### High Priority (Bugs/Memory Leaks)
2. [x] **postmessage**: Fix timeout cleanup and undefined variable → PR #3
3. [x] **format-common**: Fix JscadLinesEntity interface extension → PR #4
4. [x] **scene**: Fix buffer overflow in makeGrid → PR #5
5. [x] **html-gizmo**: Add disconnectedCallback and fix setNames → PR #6
6. [x] **orbit**: Add destroy() method for cleanup → PR #7
7. [x] **themes**: Remove circular export → PR #8

### Medium Priority
8. [x] Add type discriminators to CSG types → PR #9
9. [x] Add input validation across packages → PR #10
10. [x] Standardize event listener cleanup patterns → PR #11
11. [ ] Add missing test coverage
