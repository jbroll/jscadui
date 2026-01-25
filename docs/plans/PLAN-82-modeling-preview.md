# Plan: Remove modeling-preview Package (#82)

## Decision
**Recommendation: Remove the package**

The `packages/modeling-preview` package appears to be abandoned legacy code that is not used anywhere in the codebase.

## Evidence
1. No imports reference this package in any other package or app
2. API doesn't match current codebase patterns
3. No tests
4. No documentation

## Implementation Steps

### Phase 1: Verification
1. [ ] Grep codebase for any references to `@jscadui/modeling-preview`
2. [ ] Check if any external projects depend on this package (npm registry)
3. [ ] Review git history for context on why it was created

### Phase 2: Removal
1. [ ] Delete the `packages/modeling-preview` directory
2. [ ] Remove from npm workspaces in root package.json (if listed)
3. [ ] Run `npm install` to update package-lock.json
4. [ ] Verify build still works

### Phase 3: Documentation
1. [ ] Add note to CHANGELOG about removal
2. [ ] Update any documentation that references the package

## Estimated Effort
- Verification: 15 minutes
- Removal: 5 minutes
- Total: ~20 minutes

## Risk Assessment
**Low risk** - Package is not used anywhere.
