# PR Merge Strategy

This document outlines the strategy for reviewing and merging the 43 PRs created during the code review process.

## Overview

| Total PRs | Mergeable | Conflicting | All Checks Pass |
|-----------|-----------|-------------|-----------------|
| 43        | 39        | 4           | 43              |

## PRs by Risk Level

### High Risk (Security, Core Logic)
| PR | Package | Issue Type |
|----|---------|------------|
| #2 | params-form | XSS prevention |
| #3 | postmessage | Prototype pollution |
| #21 | fs-provider | Path traversal |
| #22 | fs-serviceworker | Security validations |
| #27 | jscad-web | Security fixes |
| #29 | vue3-jscad | Security fixes |
| #30 | model-page | Security fixes |
| #33 | linearcs | SSRF, path traversal |
| #34 | All | CVE - vitest |
| #35 | transform-babel | CVE - babel |
| #37 | 3mf-export | XML injection |
| #38 | fs-provider | Path sanitization |
| #40 | worker | Race condition (mutex) |

### Medium Risk (Bug Fixes, Memory Leaks)
| PR | Package | Issue Type |
|----|---------|------------|
| #4 | format-common | Interface fix |
| #6 | html-gizmo | Memory leaks |
| #7 | orbit | Missing cleanup |
| #11 | postmessage,params-form | Event cleanup |
| #12 | format-jscad | Polygon handling |
| #14 | format-threejs | Matrix update |
| #16 | render-threejs,render-babylonjs | Memory leaks |
| #17 | render-regl | Cleanup |
| #18 | worker | indexOf fix |
| #19 | worker,transform-babel | Error handling |
| #39 | require | Path normalization |
| #41 | require | Cache memory leaks |
| #42 | fs-serviceworker | Error handling |
| #44 | jscad-web | Event cleanup |

### Low Risk (Cleanup, Minor Fixes)
| PR | Package | Issue Type |
|----|---------|------------|
| #5 | scene | Buffer size |
| #8 | themes | Export fix |
| #9 | format-common | Type discriminators |
| #10 | orbit,scene | Input validation |
| #13 | format-babylonjs | Constructor fix |
| #15 | format-babylonjs,format-regl | Color indexing |
| #20 | require | URL validation |
| #23 | 3mf-export-compact | Import fix |
| #24 | vanilla-three | Dead code |
| #25 | linearcs | Undefined fix |
| #26 | cardboard-cutter | Implicit globals |
| #28 | jscad-web | URL validation |
| #31 | engine-test | Remove TWGL |
| #32 | cardboard-cutter | setTimeout fix |
| #43 | All apps | Promise handlers |

## PRs with Merge Conflicts (Resolve First)

These PRs have conflicts with main and need to be rebased before merging:

| PR | Title | Conflict Reason |
|----|-------|-----------------|
| #19 | fix(worker,transform-babel): add error handling | worker.js modified |
| #34 | fix(deps): update vitest to ^2.1.9 | package.json changes |
| #35 | fix(transform-babel): update @babel/standalone | package.json changes |
| #40 | fix(worker): add mutex for race conditions | worker.js modified |

**Action Required:** Rebase these PRs against main before merging.

## Merge Order Strategy

PRs should be merged in dependency order to minimize conflicts and ensure stability.

### Phase 1: Core Infrastructure (Merge First)
These are foundational packages with no dependencies on other PRs:

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 1.1 | #3 | postmessage | Memory leak, undefined var, prototype pollution |
| 1.2 | #4 | format-common | Lines interface fix |
| 1.3 | #9 | format-common | CSG type discriminators |
| 1.4 | #8 | themes | Circular export fix |

### Phase 2: Format Pipeline
Format packages that convert JSCAD geometries:

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 2.1 | #12 | format-jscad | Degenerate polygons, index threshold |
| 2.2 | #14 | format-threejs | instanceMatrix.needsUpdate |
| 2.3 | #13 | format-babylonjs | Index array type, Mesh constructor |
| 2.4 | #15 | format-babylonjs,format-regl | Color indexing |

### Phase 3: Render Packages

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 3.1 | #16 | render-threejs,render-babylonjs | Memory leaks, API |
| 3.2 | #17 | render-regl | Transparency, destroy cleanup |

### Phase 4: UI Components

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 4.1 | #5 | scene | Grid buffer size |
| 4.2 | #6 | html-gizmo | Lifecycle, memory leaks |
| 4.3 | #7 | orbit | destroy() method |
| 4.4 | #10 | orbit,scene | Input validation |
| 4.5 | #11 | postmessage,params-form | Event listener cleanup |
| 4.6 | #2 | params-form | XSS escape |

### Phase 5: File System Packages

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 5.1 | #21 | fs-provider | Path traversal prevention |
| 5.2 | #38 | fs-provider | Error handling, path sanitization |
| 5.3 | #22 | fs-serviceworker | Security validations |
| 5.4 | #42 | fs-serviceworker | Comprehensive error handling |

### Phase 6: Worker & Require (Resolve Conflicts First)

| Order | PR | Package | Description | Status |
|-------|-----|---------|-------------|--------|
| 6.1 | #18 | worker | extractDefaults indexOf fix | Ready |
| 6.2 | #19 | worker,transform-babel | Error handling | **CONFLICT** |
| 6.3 | #20 | require | jsdelivr URL validation | Ready |
| 6.4 | #39 | require | Path normalization | Ready |
| 6.5 | #41 | require | Cache memory leaks | Ready |
| 6.6 | #40 | worker | Mutex for race conditions | **CONFLICT** |

### Phase 7: Dependency Updates (Resolve Conflicts First)

| Order | PR | Package | Description | Status |
|-------|-----|---------|-------------|--------|
| 7.1 | #34 | All packages | vitest CVE update | **CONFLICT** |
| 7.2 | #35 | transform-babel | @babel/standalone CVE | **CONFLICT** |

### Phase 8: File Format Exporters

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 8.1 | #23 | 3mf-export-compact | XMLBuilder import |
| 8.2 | #37 | 3mf-export | Input validation, XML injection |

### Phase 9: Example Apps

| Order | PR | Package | Description |
|-------|-----|---------|-------------|
| 9.1 | #24 | vanilla-three | Remove dead code |
| 9.2 | #25 | linearcs | Undefined shape fix |
| 9.3 | #26 | cardboard-cutter | Implicit globals |
| 9.4 | #32 | cardboard-cutter | setTimeout error handling |
| 9.5 | #33 | linearcs | SSRF, path traversal |
| 9.6 | #29 | vue3-jscad | Security fixes |
| 9.7 | #30 | model-page | Security fixes |
| 9.8 | #31 | engine-test | Remove TWGL |
| 9.9 | #27 | jscad-web | Security, memory leak fixes |
| 9.10 | #28 | jscad-web | URL validation |
| 9.11 | #43 | All apps | Promise error handling |
| 9.12 | #44 | jscad-web | Event listener cleanup |

## Review Process for Each PR

**See [PR_REVIEW_PROCEDURE.md](./PR_REVIEW_PROCEDURE.md) for the complete generic review procedure.**

### Quick Checklist for Each PR

1. **Automated Checks**
   ```bash
   gh pr view <PR_NUMBER> --json state,mergeable,statusCheckRollup
   ```

2. **Assess Necessity** (Critical - don't skip!)
   - Is the problem real and reproducible?
   - Is the fix correct and minimal?
   - Does it add unnecessary complexity?

3. **Risk-Based Review**
   | Category | Risk Level | Review Depth |
   |----------|------------|--------------|
   | Security fixes | High | Deep review, verify fix is complete |
   | Memory leaks | Medium | Check cleanup is thorough |
   | Bug fixes | Medium | Verify edge cases |
   | CVE updates | High | Check for breaking changes |
   | Cleanup/dead code | Low | Quick scan |

4. **Code Review** (use `/git-pr-workflows:code-reviewer` skill)
   ```bash
   gh pr diff <PR_NUMBER>
   ```
   - [ ] Security: No new vulnerabilities introduced
   - [ ] Correctness: Logic handles edge cases
   - [ ] Compatibility: ES version, browser APIs
   - [ ] Conventions: Follows project patterns

5. **Comments & Communication**
   ```bash
   gh pr view <PR_NUMBER> --comments
   ```

6. **Resolve Conflicts (if needed)**
   ```bash
   git fetch origin
   git checkout <branch>
   git rebase origin/main
   git push --force-with-lease
   ```

7. **Merge** (this repo requires rebase)
   ```bash
   gh pr merge <PR_NUMBER> --rebase
   ```

## Conflict Resolution Strategy

For PRs with conflicts (#19, #34, #35, #40):

1. **PR #19 & #40 (worker.js):**
   - Both modify worker.js
   - Merge #19 first, then rebase #40

2. **PR #34 & #35 (package.json dependencies):**
   - Both update package.json files
   - Merge #34 first (larger change), then rebase #35

## Testing Strategy

### Quick Sanity Test
After merging each phase, run:
```bash
npm install
npm run build --workspace=packages/...
npm test --workspace=packages/...
```

### Full Test After All Merges
```bash
npm install
npm run build
npm test
cd apps/jscad-web && npm run build
```

## Rollback Plan

If issues are discovered after merging:

```bash
# Revert a single PR
git revert -m 1 <merge-commit-sha>

# Or reset to a known good state
git reset --hard <good-commit-sha>
git push --force  # Only if no other commits on top
```

## Progress Tracking

Use checkboxes to track merge progress:

### Phase 1: Core Infrastructure ✅
- [x] #3 postmessage
- [x] #4 format-common (lines)
- [x] #9 format-common (CSG)
- [x] #8 themes

### Phase 2: Format Pipeline
- [ ] #12 format-jscad
- [ ] #14 format-threejs
- [ ] #13 format-babylonjs
- [ ] #15 format-babylonjs,format-regl

### Phase 3: Render Packages
- [ ] #16 render-threejs,render-babylonjs
- [ ] #17 render-regl

### Phase 4: UI Components
- [ ] #5 scene
- [ ] #6 html-gizmo
- [ ] #7 orbit
- [ ] #10 orbit,scene
- [ ] #11 postmessage,params-form
- [ ] #2 params-form

### Phase 5: File System
- [ ] #21 fs-provider
- [ ] #38 fs-provider
- [ ] #22 fs-serviceworker
- [ ] #42 fs-serviceworker

### Phase 6: Worker & Require
- [ ] #18 worker (extractDefaults)
- [ ] #19 worker,transform-babel (CONFLICT - resolve)
- [ ] #20 require (jsdelivr)
- [ ] #39 require (path)
- [ ] #41 require (cache)
- [ ] #40 worker (mutex) (CONFLICT - resolve after #19)

### Phase 7: Dependencies
- [ ] #34 vitest (CONFLICT - resolve)
- [ ] #35 babel (CONFLICT - resolve after #34)

### Phase 8: File Formats
- [ ] #23 3mf-export-compact
- [ ] #37 3mf-export

### Phase 9: Apps
- [ ] #24 vanilla-three
- [ ] #25 linearcs (shape)
- [ ] #26 cardboard-cutter (globals)
- [ ] #32 cardboard-cutter (setTimeout)
- [ ] #33 linearcs (SSRF)
- [ ] #29 vue3-jscad
- [ ] #30 model-page
- [ ] #31 engine-test
- [ ] #27 jscad-web (security)
- [ ] #28 jscad-web (URL)
- [ ] #43 All apps (Promise)
- [ ] #44 jscad-web (cleanup)

---

## Quick Commands Reference

```bash
# List all open PRs
gh pr list --state open

# View specific PR
gh pr view <NUMBER>

# Check PR mergeable status
gh pr view <NUMBER> --json mergeable,statusCheckRollup

# Merge with rebase (required on this repo)
gh pr merge <NUMBER> --rebase

# Rebase a conflicting PR
git checkout <branch>
git fetch origin
git rebase origin/main
git push --force-with-lease

# Review PR using skill
# /git-pr-workflows:code-reviewer to review a specific PR
```

---

*Generated: 2026-01-25*
