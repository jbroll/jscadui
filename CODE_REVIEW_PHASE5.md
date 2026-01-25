# Phase 5 Review Findings (2026-01-24)

## Executive Summary

Phase 5 reviewed 3 parameter system packages that handle hierarchical parameters, state management, and UI rendering. Found **40 issues** across all packages, with **12 critical** issues requiring immediate attention.

**Major Findings:**
- **Memory leaks** in params-ui from document-level event listeners never being removed
- **Accessibility gaps** - no ARIA attributes or keyboard navigation in tree UI
- **Missing test coverage** for ParamsTree component (547 lines untested)
- **Security concerns** with prototype pollution risk and missing input validation

### Critical Issues by Category

| Category | Count | Priority |
|----------|-------|----------|
| 🐛 Memory Leaks | 4 | Critical |
| ♿ Accessibility | 4 | High |
| 🔒 Security | 3 | High |
| ✅ Testing | 3 | High |
| 🐛 Logic Bugs | 8 | High |
| 📝 Documentation | 6 | Medium |
| 🧹 Code Quality | 12 | Low |

---

## 5.1 packages/params-core

**Reviewed:** 2026-01-24 | **Severity:** 🔴 High

This package provides the core proxy-based parameter discovery system for JSCAD.

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | 🔒 Security | [x] vitest@0.24.5 has CVE-2025-24964 (CVSS 9.6) RCE, CVE-2025-24963 (CVSS 5.9) → PR #34 | package.json:18 |
| High | 🔒 Security | Prototype pollution risk via Object.assign with unchecked properties | createParamsProxy.js:314,317 |
| High | 🐛 Bug | Path splitting without validation - empty segments, traversal risks | createParamsProxy.js:389,413,494,518,636-640 |
| High | 🐛 Bug | Memory leak - child proxies cached indefinitely, never garbage collected | createParamsProxy.js:250-254 |
| High | 🔒 Security | No sanitization for caption text (XSS risk when rendered) | createParamsProxy.js:724 |
| High | 🐛 Bug | Race condition - discovered array accessed twice without synchronization | createParamsProxy.js:302-320,328-332 |
| High | 🐛 Bug | Missing error handling in wrapLegacyModule when getParameterDefinitions throws | createParamsProxy.js:828-840 |
| Medium | 🐛 Bug | Missing validation for _type and _class values (any string accepted) | createParamsProxy.js:264,271 |
| Medium | 🐛 Bug | toMap doesn't handle null-prototype objects | createParamsProxy.js:74-77 |
| Medium | 🧹 Quality | Type normalization duplicated across multiple functions | createParamsProxy.js:125-128,680-691,728-731 |
| Low | 📝 Docs | Missing JSDoc return type details | Multiple locations |
| Low | 📝 Docs | Typo in comment: `/ Step:` should be `// Step:` | createParamsProxy.js:140 |

### Recommendations
1. **IMMEDIATE**: Upgrade vitest to ^4.0.0 for CVE fixes
2. Add prototype pollution protection to Object.assign calls
3. Validate path strings before splitting
4. Add error handling to wrapLegacyModule
5. Document XSS concerns for caption/label strings

---

## 5.2 packages/params-controller

**Reviewed:** 2026-01-24 | **Severity:** 🟡 Medium

This package manages parameter state and class linking for the hierarchical parameter system.

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | 🐛 Bug | Type mismatch - code treats classes/types as Objects but typedef says Map | ParamsController.js:54-58 |
| High | 🐛 Bug | setClass doesn't return updated paths (inconsistent with setParam API) | ParamsController.js:155-218 |
| High | 🐛 Bug | updateProxyState mutates input newState object directly | ParamsController.js:224-238 |
| High | 🔒 Security | getState returns mutable references - callers can mutate internal state | ParamsController.js:243-248 |
| High | 🐛 Bug | No validation of setClass mode parameter - invalid modes silently ignored | ParamsController.js:155-218 |
| High | ✅ Testing | Zero tests for setClass method (63 lines with complex branching) | ParamsController.test.js |
| Medium | 🐛 Bug | Shallow copy in codeClassValues - object/array values could be mutated | ParamsController.js:61-66 |
| Medium | 🧹 Quality | Inconsistent null handling - both null and undefined filtered | ParamsController.js:141 |
| Low | 🧹 Quality | Outdated vitest@0.24.5 (2+ years old) | package.json:17 |
| Low | 📝 Docs | Missing JSDoc @returns for reset, initFromResult, setClass, updateProxyState | Multiple locations |
| Low | 📝 Docs | No README.md for package | Package root |
| Low | 🧹 Quality | Direct property access exposes internal state bypassing controlled API | ParamsController.js:268-273 |

### Recommendations
1. Fix type mismatch - document that types/classes are Objects in serialized form
2. Return updated paths from setClass for UI sync
3. Clone newState before mutation in updateProxyState
4. Clone all objects in getState return value
5. Add validation for mode parameter with error for invalid values
6. Add comprehensive tests for setClass method

---

## 5.3 packages/params-ui

**Reviewed:** 2026-01-24 | **Severity:** 🔴 Critical

This package provides the tree UI for hierarchical parameter editing.

### Critical Issues

| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | 🐛 Memory | Document event listeners never removed - leak on every class input render | ParamsTree.js:453,461 |
| Critical | 🐛 Memory | Color picker adds document listeners without cleanup | inputs.js:294,301 |
| Critical | ✅ Testing | ParamsTree.js (547 lines) has zero test coverage | ParamsTree.js |
| High | ♿ A11y | Missing ARIA roles (tree, treeitem), aria-expanded, aria-level | ParamsTree.js:101,119 |
| High | ♿ A11y | No keyboard navigation for tree (arrow keys, Enter/Space) | ParamsTree.js:119-130,165-172 |
| High | ♿ A11y | Form inputs lack proper label association (htmlFor) | ParamsTree.js:213-219 |
| High | ♿ A11y | Dropdown menus missing role="menu" and role="menuitem" | ParamsTree.js:314-348 |
| Medium | 🐛 Bug | Radio button name collision if same input rendered twice | inputs.js:359,338 |
| Medium | 🧹 Quality | innerHTML = '' doesn't clean up event listeners | ParamsTree.js:90,526 |
| Medium | 🧹 Quality | No input validation or length limits on user values | Multiple locations |
| Medium | 🧹 Quality | No error handling for invalid parameter definitions | ParamsTree.js:105 |
| Medium | 🧹 Quality | CSS Grid subgrid not supported in older browsers, no fallback | ParamsTree.js:571-579 |
| Low | 🧹 Quality | Outdated vitest@0.24.5, jsdom@22 | package.json |
| Low | 📝 Docs | No README.md for package | Package root |
| Low | 🧹 Quality | Magic numbers in styles (16px, 200px) not customizable | CSS strings |

### Recommendations
1. **IMMEDIATE**: Add cleanup mechanism for document event listeners
2. **IMMEDIATE**: Track cleanup functions and call them in destroy()
3. Add comprehensive ARIA attributes for screen reader support
4. Implement keyboard navigation following ARIA tree pattern
5. Add test coverage for ParamsTree component
6. Use unique ID generator for radio button names

---

## Cross-Package Issues

### 1. Outdated Testing Dependencies
All three packages use vitest@0.24.5 with critical CVEs:
- **CVE-2025-24964** (CVSS 9.6) - Remote Code Execution
- **CVE-2025-24963** (CVSS 5.9) - Local File Read

### 2. Test Coverage Gaps
| Package | Tested | Untested |
|---------|--------|----------|
| params-core | createParamsProxy.js | - |
| params-controller | Core linking | setClass method |
| params-ui | inputs.js | ParamsTree.js (547 lines) |

### 3. Accessibility Not Considered
The params-ui package lacks:
- ARIA roles and attributes
- Keyboard navigation
- Focus management
- Screen reader announcements

### 4. Documentation Missing
- params-controller: No README
- params-ui: No README
- JSDoc incomplete across all packages

### 5. Memory Management Pattern Missing
Both params-core and params-ui have memory leak patterns:
- **params-core**: Proxy children cached forever
- **params-ui**: Document event listeners never cleaned up

---

## Priority Action Items

### Critical (Fix Immediately)
1. [x] **All packages**: Upgrade vitest to ^2.1.9 for CVE-2025-24964, CVE-2025-24963 → PR #34
2. [ ] **params-ui**: Add cleanup for document event listeners in destroy()
3. [ ] **params-ui**: Track cleanup functions for class input and color picker
4. [ ] **params-core**: Add prototype pollution protection to Object.assign

### High Priority
5. [ ] **params-ui**: Add ARIA attributes (role="tree", aria-expanded, etc.)
6. [ ] **params-ui**: Implement keyboard navigation for tree
7. [ ] **params-ui**: Add test coverage for ParamsTree.js
8. [ ] **params-controller**: Add tests for setClass method
9. [ ] **params-controller**: Fix getState to return cloned objects
10. [ ] **params-core**: Add path validation before splitting

### Medium Priority
11. [ ] **params-controller**: Return updated paths from setClass
12. [ ] **params-controller**: Clone newState in updateProxyState
13. [ ] **params-ui**: Fix radio button name collisions
14. [ ] **params-core**: Add error handling to wrapLegacyModule
15. [ ] Add README.md to params-controller and params-ui

