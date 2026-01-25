# Plan: Improve Test Coverage (#87)

## Overview
Add tests to critical packages that currently have minimal or no coverage.

## Current State

### Packages WITH Tests
| Package | Test Count | Notes |
|---------|------------|-------|
| orbit | 2 | Basic tests |
| require | 13 | Good coverage |
| themes | 1 | Snapshot test |
| html-gizmo | 9 | Recently added |
| params-form | Has tests | - |

### Packages NEEDING Tests
| Package | Priority | Reason |
|---------|----------|--------|
| format-jscad | HIGH | Critical geometry conversion path |
| postmessage | HIGH | RPC layer, error handling |
| fs-provider | MEDIUM | File system abstraction |
| fs-serviceworker | MEDIUM | Service worker logic |
| format-threejs | LOW | Adapter code |
| render-* | LOW | Engine-specific, hard to test |

## Implementation Plan

### Phase 1: format-jscad Tests (4-6 hours)
**Why:** This is the critical geometry conversion path.

Test cases:
1. [ ] Simple polygon conversion
2. [ ] Polygon with holes
3. [ ] Degenerate polygons (should not crash)
4. [ ] Large meshes (performance)
5. [ ] Color handling
6. [ ] Instance deduplication

```javascript
// Example test structure
describe('JscadToCommon', () => {
  it('converts simple polygon to vertices/normals', () => {})
  it('handles polygon with holes', () => {})
  it('handles degenerate polygon gracefully', () => {})
  it('preserves color information', () => {})
})
```

### Phase 2: postmessage Tests (3-4 hours)
**Why:** RPC layer that all worker communication depends on.

Test cases:
1. [ ] Basic message send/receive
2. [ ] Timeout handling
3. [ ] Error propagation
4. [ ] Concurrent messages
5. [ ] Handler registration

### Phase 3: fs-provider Tests (2-3 hours)
Test cases:
1. [ ] Path normalization
2. [ ] File caching
3. [ ] Path traversal prevention
4. [ ] Error handling for missing files

### Phase 4: fs-serviceworker Tests (2-3 hours)
Test cases:
1. [ ] Request interception
2. [ ] Cache management
3. [ ] File change detection

## Test Infrastructure

### Setup Requirements
Each package needs:
1. `vitest` in devDependencies (already done via #97)
2. `vitest.config.js` if special config needed
3. Test files matching `**/*.test.js` or `**/*.spec.js`

### Mocking Strategy
- Use `vi.mock()` for external dependencies
- Create test fixtures for geometry data
- Mock `postMessage` for worker tests

## Success Criteria
- All HIGH priority packages have >60% coverage
- All MEDIUM priority packages have >40% coverage
- No critical path untested

## Estimated Total Effort
15-20 hours
