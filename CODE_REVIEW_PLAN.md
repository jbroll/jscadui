# JSCADUI Code Review Plan

This document outlines a systematic approach to reviewing all 36 modules in the jscadui monorepo.

## Review Methodology

For each module, we will evaluate:
1. **Code Quality** - Readability, naming conventions, consistency
2. **Architecture** - Design patterns, separation of concerns, modularity
3. **Error Handling** - Edge cases, graceful degradation, error messages
4. **Performance** - Algorithmic efficiency, memory usage, unnecessary computations
5. **Security** - Input validation, XSS prevention, safe eval patterns
6. **Testing** - Coverage, test quality, edge case testing
7. **Documentation** - JSDoc comments, README, type definitions
8. **Dependencies** - Outdated packages, unused dependencies, bundle size

---

## Findings Documents

Each phase produces a separate findings document to keep results manageable:

| Phase | Document | Status |
|-------|----------|--------|
| Phase 1 | [CODE_REVIEW_PHASE1.md](./CODE_REVIEW_PHASE1.md) | ✅ Complete |
| Phase 2 | [CODE_REVIEW_PHASE2.md](./CODE_REVIEW_PHASE2.md) | ✅ Complete |
| Phase 3 | [CODE_REVIEW_PHASE3.md](./CODE_REVIEW_PHASE3.md) | ✅ Complete |
| Phase 4 | [CODE_REVIEW_PHASE4.md](./CODE_REVIEW_PHASE4.md) | ✅ Complete |
| Phase 5 | [CODE_REVIEW_PHASE5.md](./CODE_REVIEW_PHASE5.md) | ✅ Complete |
| Phase 6 | [CODE_REVIEW_PHASE6.md](./CODE_REVIEW_PHASE6.md) | ✅ Complete |
| Phase 7 | [CODE_REVIEW_PHASE7.md](./CODE_REVIEW_PHASE7.md) | ✅ Complete |
| Phase 8 | [CODE_REVIEW_PHASE8.md](./CODE_REVIEW_PHASE8.md) | ✅ Complete |
| Phase 9 | [CODE_REVIEW_PHASE9.md](./CODE_REVIEW_PHASE9.md) | ✅ Complete |

---

## Phase 1: Core Foundation (No Dependencies)

These packages have zero internal dependencies - review first.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 1.1 | `packages/postmessage` | 1 | High | ✅ |
| 1.2 | `packages/format-common` | 7 | High | ✅ |
| 1.3 | `packages/scene` | 3 | Medium | ✅ |
| 1.4 | `packages/html-gizmo` | 3 | Medium | ✅ |
| 1.5 | `packages/orbit` | 11 | High | ✅ |
| 1.6 | `packages/params-form` | 2 | Medium | ✅ |
| 1.7 | `packages/themes` | 25+ | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE1.md](./CODE_REVIEW_PHASE1.md) - 37 issues, 10 critical

---

## Phase 2: Format Adapters

Geometry conversion pipeline - depends on format-common types.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 2.1 | `packages/format-jscad` | 1 | High | ✅ |
| 2.2 | `packages/format-threejs` | 1 | Medium | ✅ |
| 2.3 | `packages/format-babylonjs` | 1 | Low | ✅ |
| 2.4 | `packages/format-regl` | 1 | Low | ✅ |
| 2.5 | `packages/format-twgl` | 1 | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE2.md](./CODE_REVIEW_PHASE2.md) - 25 issues, 8 critical

---

## Phase 3: Render Engines

Renderer-specific implementations - depend on format adapters.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 3.1 | `packages/render-threejs` | 2 | High | ✅ |
| 3.2 | `packages/render-babylonjs` | 1 | Low | ✅ |
| 3.3 | `packages/render-regl` | 1 | Low | ✅ |
| 3.4 | `packages/render-twgl` | 1 | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE3.md](./CODE_REVIEW_PHASE3.md) - 28 issues, 12 critical

---

## Phase 4: Worker System

Module loading and worker execution - critical path.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 4.1 | `packages/transform-babel` | 2 | High | ✅ |
| 4.2 | `packages/require` | 5 | High | ✅ |
| 4.3 | `packages/worker` | 4 | High | ✅ |

**Findings:** [CODE_REVIEW_PHASE4.md](./CODE_REVIEW_PHASE4.md) - 42 issues, 15 critical

---

## Phase 5: Parameter System

Hierarchical parameters - new feature area.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 5.1 | `packages/params-core` | 2 | High | ✅ |
| 5.2 | `packages/params-controller` | 2 | High | ✅ |
| 5.3 | `packages/params-ui` | 3 | High | ✅ |

**Findings:** [CODE_REVIEW_PHASE5.md](./CODE_REVIEW_PHASE5.md) - 40 issues, 12 critical

---

## Phase 6: File System & Utilities

Support packages for file handling.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 6.1 | `packages/fs-provider` | 4 | Medium | ✅ |
| 6.2 | `packages/fs-serviceworker` | 1 | Medium | ✅ |
| 6.3 | `packages/modeling-preview` | 1 | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE6.md](./CODE_REVIEW_PHASE6.md) - 37 issues, 10 critical

---

## Phase 7: File Format Exporters

3MF export functionality.

| # | Package | Files | Priority | Status |
|---|---------|-------|----------|--------|
| 7.1 | `file-format/3mf-export` | 11 | Medium | ✅ |
| 7.2 | `file-format/3mf-export-compact` | 10 | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE7.md](./CODE_REVIEW_PHASE7.md) - 22 issues, 6 critical

---

## Phase 8: Example Applications

Smaller apps for reference implementations.

| # | App | Files | Priority | Status |
|---|-----|-------|----------|--------|
| 8.1 | `apps/vanilla-three` | 2 | Low | ✅ |
| 8.2 | `apps/react-app` | 11 | Low | ✅ |
| 8.3 | `apps/vue3-jscad` | 15 | Low | ✅ |
| 8.4 | `apps/model-page` | 12 | Medium | ✅ |
| 8.5 | `apps/cardboard-cutter` | 9 | Low | ✅ |
| 8.6 | `apps/linearcs-app` | 8 | Low | ✅ |
| 8.7 | `apps/engine-test` | ~5 | Low | ✅ |

**Findings:** [CODE_REVIEW_PHASE8.md](./CODE_REVIEW_PHASE8.md) - 68 issues, 18 critical

---

## Phase 9: Production Application

The main jscad.app - largest and most complex.

| # | App | Files | Priority | Status |
|---|-----|-------|----------|--------|
| 9.1 | `apps/jscad-web` | 1,168 | High | ✅ |

**Findings:** [CODE_REVIEW_PHASE9.md](./CODE_REVIEW_PHASE9.md) - 50 issues, 17 critical

**Sub-phases reviewed:**
- 9.1a: Core application bootstrap ✅
- 9.1b: Editor integration (CodeMirror) ✅
- 9.1c: Worker communication ✅
- 9.1d: UI components ✅
- 9.1e: File handling ✅
- 9.1f: Export functionality ✅

---

## Execution Notes

### Recommended Order
1. Start with Phase 1 (foundation) to establish baseline expectations
2. Follow phases 2-6 in order (dependency chain)
3. Phase 7-8 can be parallelized
4. Phase 9 should be done last with learnings from earlier phases

### Output Format
**Each phase should produce a separate findings document:**
- Filename: `CODE_REVIEW_PHASE{N}.md`
- Include executive summary with issue counts
- Group findings by module
- Include priority action items at the end

### Per-Module Review Checklist
- [ ] Read all source files
- [ ] Review test coverage
- [ ] Check for TODO/FIXME comments
- [ ] Verify error handling
- [ ] Check bundle size impact
- [ ] Look for code duplication
- [ ] Validate TypeScript types
- [ ] Document findings

### Issue Tracking
Create issues for findings in categories:
- 🐛 **Bug** - Incorrect behavior
- 🔒 **Security** - Potential vulnerabilities
- ⚡ **Performance** - Optimization opportunities
- 🧹 **Cleanup** - Code quality improvements
- 📝 **Documentation** - Missing or unclear docs
- ✅ **Testing** - Missing test coverage

---

## Progress Tracking

| Phase | Modules | Reviewed | Remaining | Issues Found |
|-------|---------|----------|-----------|--------------|
| 1 | 7 | 7 | 0 | 37 |
| 2 | 5 | 5 | 0 | 25 |
| 3 | 4 | 4 | 0 | 28 |
| 4 | 3 | 3 | 0 | 42 |
| 5 | 3 | 3 | 0 | 40 |
| 6 | 3 | 3 | 0 | 37 |
| 7 | 2 | 2 | 0 | 22 |
| 8 | 7 | 7 | 0 | 68 |
| 9 | 1 | 1 | 0 | 50 |
| **Total** | **35** | **35** | **0** | **349** |

---

## Cumulative Critical Issues

### Security (Immediate)
- [ ] **params-form**: XSS vulnerabilities via innerHTML
- [ ] **transform-babel**: CVE-2025-27789 in @babel/standalone
- [ ] **require**: CVE-2025-24964 (CVSS 9.6) RCE in vitest
- [ ] **require**: CVE-2025-24963 (CVSS 5.9) file read in vitest
- [ ] **require/worker**: eval() code execution without sandboxing

### Bugs (High Priority)
- [ ] **worker/extractDefaults**: indexOf() called with function instead of value
- [ ] **format-babylonjs**: Wrong typed array for indices
- [ ] **format-babylonjs**: Wrong Mesh constructor
- [ ] **format-jscad**: Division by zero in normals
- [ ] **format-jscad**: Wrong index array threshold
- [ ] **format-twgl**: Package not implemented
- [ ] **orbit**: Memory leaks (RAF + event listeners)
- [ ] **html-gizmo**: Memory leaks (no cleanup)
- [ ] **scene**: Buffer overflow in makeGrid
- [ ] **postmessage**: Timeout memory leak
- [ ] **format-common**: Wrong interface extension
- [ ] **themes**: Circular export
- [ ] **worker**: Race condition with global state
- [ ] **worker**: userInteracted Set memory leak
- [ ] **require**: Cache memory leak, dependency tracking leak

### Memory Leaks (Phase 5)
- [ ] **params-ui**: Document event listeners never removed (class input, color picker)
- [ ] **params-core**: Child proxies cached indefinitely

### Accessibility (Phase 5)
- [ ] **params-ui**: Missing ARIA roles (tree, treeitem, aria-expanded)
- [ ] **params-ui**: No keyboard navigation for tree

### Security (Phase 6)
- [ ] **fs-provider**: Path traversal vulnerability - `..` not filtered
- [ ] **fs-serviceworker**: Missing origin validation
- [ ] **fs-serviceworker**: Cache poisoning via unvalidated clientId

### Abandoned/Broken (Phase 6)
- [ ] **modeling-preview**: Package appears abandoned, broken API, not used anywhere

### Duplicate/Misleading Packages (Phase 7)
- [ ] **3mf-export-compact**: Wrong import defeats tree-shaking, produces LARGER bundle
- [ ] **3mf-export-compact**: README claims "no dependencies" but has fast-xml-parser
- [ ] **Both 3mf packages**: No input validation for geometry data

### Example Apps Security (Phase 8)
- [ ] **model-page**: SSRF vulnerability in handleRemote
- [ ] **model-page**: Unsafe global workerApi exposure
- [ ] **vue3-jscad, linearcs**: SSRF in remote URL fetching
- [ ] **vanilla-three, vue3-jscad**: XSS via innerHTML

### Example Apps Bugs (Phase 8)
- [ ] **linearcs**: Undefined `shape` variable crashes on click
- [ ] **cardboard-cutter**: Implicit global variables
- [ ] **engine-test**: TWGL engine incomplete - hangs forever
- [ ] **react-app**: Missing Error Boundary for WebGL

### Production App Security (Phase 9)
- [ ] **jscad-web**: XSS via innerHTML in editor tabs, file tree, error display
- [ ] **jscad-web**: SSRF vulnerability in remote URL fetching
- [ ] **jscad-web**: Path traversal - filenames with `..` not sanitized
- [ ] **jscad-web**: Unvalidated remote script execution - no URL allowlist
- [ ] **jscad-web**: ZIP slip vulnerability - entry paths not validated
- [ ] **jscad-web**: Export filename not sanitized before download

### Production App Bugs (Phase 9)
- [ ] **jscad-web**: Missing global error handlers (window.onerror, unhandledrejection)
- [ ] **jscad-web**: Race condition in worker initialization
- [ ] **jscad-web**: Worker.onerror not handled - crashes silently
- [ ] **jscad-web**: Timeout memory leak - pending timeouts not cleared
- [ ] **jscad-web**: Object URL memory leak - never revoked after download
- [ ] **jscad-web**: DXF export advertised but not implemented
- [ ] **jscad-web**: X3D export produces wrong format
- [ ] **jscad-web**: 3MF serializer typo causes undefined in output

### Production App Accessibility (Phase 9)
- [ ] **jscad-web**: Missing ARIA roles on toolbar, file tree, panels
- [ ] **jscad-web**: No keyboard navigation in file tree
- [ ] **jscad-web**: Modal lacks focus trap
- [ ] **jscad-web**: Missing aria-expanded on collapsible panels

---

## Review Findings Template

Use this template for each phase findings document:

```markdown
# Phase N Review Findings (YYYY-MM-DD)

## Executive Summary
Phase N reviewed X packages. Found **Y issues** with **Z critical**.

### Critical Issues by Category
| Category | Count | Priority |
|----------|-------|----------|
| ... | ... | ... |

---

## N.1 packages/package-name

**Reviewed:** YYYY-MM-DD | **Severity:** 🔴/🟡/🟢

### Critical Issues
| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| ... | ... | ... | ... |

### Recommendations
1. ...

---

## Priority Action Items

### Critical (Fix Immediately)
1. [ ] ...

### High Priority
2. [ ] ...
```
