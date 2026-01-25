# Plan: Improve Error Handling Consistency (#85)

## Overview
Establish consistent error handling patterns across the codebase.

## Current Issues
1. Some catch blocks swallow errors silently
2. Some Promise chains lack error handlers
3. Inconsistent error logging

## Proposed Patterns

### Pattern 1: Always Log Errors
```javascript
// BAD
try {
  await riskyOperation()
} catch (e) {
  // silently swallowed
}

// GOOD
try {
  await riskyOperation()
} catch (error) {
  console.error('riskyOperation failed:', error)
  // optionally re-throw or handle
}
```

### Pattern 2: Promise Chains Must Have Catch
```javascript
// BAD
workerApi.jscadScript({ url }).then(handleResult)

// GOOD
workerApi.jscadScript({ url })
  .then(handleResult)
  .catch(error => console.error('Script failed:', error))
```

### Pattern 3: Async Functions Should Handle Errors
```javascript
// Use try/catch in async functions that can fail
async function loadScript(url) {
  try {
    const result = await workerApi.jscadScript({ url })
    return result
  } catch (error) {
    console.error('Failed to load script:', url, error)
    throw error // re-throw for caller to handle
  }
}
```

## Implementation Steps

### Phase 1: Audit (2-3 hours)
1. [ ] Search for empty catch blocks: `catch\s*\([^)]*\)\s*\{\s*\}`
2. [ ] Search for .then() without .catch()
3. [ ] Document all locations needing fixes

### Phase 2: Fix Critical Paths (2-3 hours)
Priority areas:
1. [ ] Worker message handling (`packages/worker`)
2. [ ] File system operations (`packages/fs-provider`, `fs-serviceworker`)
3. [ ] Module loading (`packages/require`)

### Phase 3: Fix Remaining Areas (2-3 hours)
1. [ ] UI event handlers in apps
2. [ ] Rendering pipeline
3. [ ] Export functionality

### Phase 4: Add Error Events (Optional, 2-3 hours)
For packages that are used as libraries:
1. [ ] Define error event types
2. [ ] Emit events for consumer handling
3. [ ] Document expected errors

## Files to Review

### High Priority
- `packages/worker/worker.js`
- `packages/postmessage/index.js`
- `packages/require/require.js`
- `packages/fs-provider/index.js`
- `packages/fs-serviceworker/index.js`

### Medium Priority
- `apps/jscad-web/src/*.js`
- `apps/engine-test/main.js`
- `packages/render-*/index.js`

## Estimated Total Effort
8-12 hours
