# Phase 3 Review Findings (2026-01-24)

## Executive Summary

Phase 3 reviewed 4 render engine packages that provide WebGL rendering for different 3D libraries. Found **28 issues** across all packages, with **12 critical** issues requiring immediate attention.

**Major Finding:** The `render-twgl` package is completely non-functional - it's a copy-paste of `render-regl` with no actual TWGL implementation.

### Critical Issues by Category

| Category | Count | Priority |
|----------|-------|----------|
| 🐛 Memory Leaks | 6 | High |
| ❌ Not Implemented | 3 | Critical |
| 🐛 API Misuse | 4 | High |
| 🐛 Logic Bugs | 3 | High |
| 📝 Documentation | 4 | Medium |
| 🧹 Code Quality | 8 | Low |

---

## 3.1 packages/render-threejs

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

This is the **primary renderer** used by the production jscad.app.

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: materials not disposed in setScene | index.js:214 |
| High | 🐛 Bug | Incorrect Three.js API: `applyMatrix4({elements:...})` should use Matrix4 instance | format-threejs/index.js:84 |
| High | 🐛 Bug | `lightPosition` parameter overwritten to null, making it non-functional | index.js:63 |
| High | 🐛 Bug | `destroy()` doesn't clean up renderer, WebGL context, or animation frame | index.js:173-175 |
| Medium | 🧹 Quality | Global window pollution with debug code (`window.camera`, `window.updateView`) | index.js:59-60 |
| Medium | 🧹 Quality | Instance rendering disabled (`useInstances: false`) without justification | index.js:188 |
| Medium | 🐛 Bug | `smooth` parameter shadows module variable, causing ambiguity | index.js:205, 224 |
| Low | 🧹 Quality | Unused variables `shouldRender`, `lastRender` suggest incomplete optimization | index.js:31-32 |
| Low | 🧹 Quality | Dead code: commented bounding box visualization (14 lines) | index.js:236-249 |
| Low | 🧹 Quality | Unused `zoomCameraToSelection` function references undefined `THREE` global | index.js:258-287 |

### Recommendations
1. Add `ent.material?.dispose?.()` alongside geometry disposal
2. Fix `applyMatrix4` to use `new Matrix4().fromArray(transforms)`
3. Remove `lightPosition = null` line or fix the parameter handling
4. Implement proper `destroy()`: cancel RAF, dispose renderer, cleanup scene
5. Remove or conditionally compile debug code

---

## 3.2 packages/render-babylonjs

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: engine not disposed on destroy | index.js:92-94 |
| High | 🐛 Bug | Memory leak: materials not disposed in setScene | index.js:125-135 |
| High | 🐛 Bug | Render loop never stopped (runs after destroy) | index.js:49-51 |
| Medium | 🐛 Bug | Canvas not sized on initialization | index.js:87-97 |
| Medium | 🐛 Bug | Typo: `letfHanded` should be `leftHanded` | index.js:117 |
| Medium | 🐛 Bug | Missing wheel event listener cleanup | index.js:98-100 |
| Medium | 📝 Docs | README says "Three.js" but this is Babylon.js | README.md:1 |
| Medium | 🧹 Quality | Unused `handlers.entities` function does nothing | index.js:60-65 |
| Low | 🧹 Quality | Inconsistent camera API (missing fov/aspect vs Three.js) | index.js:110-112 |

### Recommendations
1. Implement proper `destroy()`:
   ```javascript
   engine.stopRenderLoop()
   entities.forEach(e => { e.material?.dispose(); e.dispose() })
   _scene.dispose()
   engine.dispose()
   ```
2. Fix typo: `leftHanded: true`
3. Store and remove wheel event listener in destroy
4. Fix README documentation

---

## 3.3 packages/render-regl

**Reviewed:** 2026-01-24 | **Severity:** 🟡 Medium

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| High | 🐛 Bug | Memory leak: WebGL resources not cleaned up in destroy | index.js:232-234 |
| High | 🐛 Bug | Missing dependency validation for regl object | index.js:6 |
| Medium | 🐛 Bug | Race condition in updateView render scheduling | index.js:89-92 |
| Medium | 🐛 Bug | Transparent entities rendered before opaque (wrong order) | index.js:267-284 |
| Medium | 🐛 Bug | Missing null check for camera in resize | index.js:140-146 |
| Medium | 📝 Docs | README says "Three.js" instead of regl | README.md:1 |
| Low | 🧹 Quality | Dead code: `updateRender` variable never affects behavior | index.js:135-137 |
| Low | 🧹 Quality | Missing error handling for WebGL context creation | index.js:55-63 |

### Recommendations
1. Add WebGL context cleanup in destroy (loseContext)
2. Validate regl dependency object has required properties
3. Fix transparent rendering order (opaque first, then transparent back-to-front)
4. Add guard for camera initialization in resize
5. Fix README documentation

---

## 3.4 packages/render-twgl

**Reviewed:** 2026-01-24 | **Severity:** 🔴 Critical (Not Implemented)

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | ❌ Missing | **Entire package is copy-paste of render-regl** with no TWGL code | Entire file |
| Critical | 🐛 Bug | Imports `@jscadui/format-regl` instead of `@jscadui/format-twgl` | index.js:3 |
| Critical | 🐛 Bug | Function named `RenderRegl` instead of `RenderTwgl` | index.js:5 |
| Critical | ❌ Missing | Zero TWGL library usage - uses regl APIs throughout | index.js:6, 18, 63 |
| Critical | ❌ Missing | format-twgl package is also empty (found in Phase 2) | format-twgl/index.js |
| High | 📝 Docs | Package description claims "TWGL renderer" but contains regl code | package.json:6 |
| Medium | 🧹 Quality | Outdated Windows paths in comments referencing OpenJSCAD.org | index.js:1-2 |

### Implementation Status

| Feature | Expected | Actual |
|---------|----------|--------|
| TWGL library usage | ✅ | ❌ Uses regl |
| Format converter | CommonToTwgl | CommonToRegl |
| Function name | RenderTwgl | RenderRegl |
| Return value | JscadTwglViewer | JscadReglViewer |
| Buffer handling | TWGL APIs | regl APIs |
| Shader management | TWGL APIs | regl APIs |

### Recommendations
**Option A (Remove):** Delete both `render-twgl` and `format-twgl` packages. They are non-functional scaffolding.

**Option B (Implement):** Complete rewrite required:
1. Implement `format-twgl` converter from scratch
2. Rewrite `render-twgl` using TWGL library APIs
3. Add TWGL as dependency
4. Update engine-test availableEngines.js

---

## Cross-Package Issues

### 1. Memory Management Pattern Missing
All renderers have incomplete `destroy()` functions that don't properly release WebGL resources:
- **render-threejs**: Missing renderer.dispose(), material disposal
- **render-babylonjs**: Missing engine.dispose(), scene.dispose()
- **render-regl**: Missing WebGL context cleanup
- **render-twgl**: Inherits regl issues (non-functional anyway)

### 2. README Documentation Wrong
3 of 4 packages have incorrect README files:
- **render-babylonjs**: Says "Three.js"
- **render-regl**: Says "Three.js"
- **render-twgl**: Non-existent/wrong

### 3. Instance Rendering Disabled
All renderers have `useInstances: false`, disabling a documented performance feature.

### 4. No Test Coverage
None of the render packages have any test coverage.

---

## Priority Action Items

### Critical (Fix Immediately)
1. [ ] **render-twgl**: Remove package or implement from scratch ⚠️ *Needs owner decision*
2. [x] **render-threejs**: Fix `applyMatrix4` API usage in format-threejs → PR #16
3. [x] **render-threejs**: Add material disposal to prevent memory leaks → PR #16
4. [x] **render-babylonjs**: Add engine.stopRenderLoop() and dispose calls → PR #16
5. [x] **All renderers**: Implement proper destroy() with resource cleanup → PR #16 (threejs, babylonjs), PR #17 (regl)

### High Priority
6. [ ] **render-threejs**: Fix `lightPosition` parameter
7. [x] **render-threejs**: Implement proper destroy() cleanup → PR #16
8. [x] **render-babylonjs**: Fix `leftHanded` typo → PR #16
9. [x] **render-regl**: Fix transparent rendering order → PR #17
10. [ ] **render-regl**: Add dependency validation

### Medium Priority
11. [ ] Fix all incorrect README files
12. [ ] Remove debug code from render-threejs
13. [ ] Consider enabling instance rendering for performance
14. [ ] Add error handling for WebGL context creation
