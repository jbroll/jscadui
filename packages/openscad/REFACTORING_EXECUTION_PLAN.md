# Refactoring Execution Plan - A1 and A2

## Overview

Two major architectural refactorings planned:
- **A1**: Split Context into Focused Managers (2-3 days)
- **A2**: Use AST for Bundling (3-4 days)

Both are broken into small, testable increments with tests after each step.

## Which to Do First?

### Recommendation: **A1 First, Then A2**

**Reasoning:**

1. **A1 is simpler** - Just reorganizing existing state, no algorithm changes
2. **A1 reduces complexity** - Makes A2 easier by having cleaner context
3. **A1 has lower risk** - State reorganization vs. algorithm replacement
4. **A1 teaches the pattern** - Build confidence with incremental refactoring

### Could Do A2 First If:
- You want the more impactful change sooner
- You're comfortable with higher complexity on first attempt
- You want tree-shaking capabilities ASAP

---

## A1: Split Context into Focused Managers

**Files**: `REFACTORING_A1_PLAN.md`

**Time**: 2-3 days

**Phases**:
1. Create manager classes (2-3 hours) ✅ Low risk
2. Add to context alongside old fields (1-2 hours) ✅ Low risk
3. Migrate call sites (8-12 hours) ⚠️ High risk - most time here
4. Remove old fields (1-2 hours) ✅ Low risk
5. Add manager tests (2-3 hours) ✅ Low risk

**Risk Profile**:
- Phases 1-2: Almost zero risk (just additions)
- Phase 3: Medium-high risk (touching ~50 functions)
  - Mitigated by: One manager at a time, test after each file
- Phases 4-5: Low risk (cleanup)

**Benefits**:
- Clearer ownership (CodeGenState owns usage flags)
- Better testability (test ScopeManager in isolation)
- Easier debugging (scope issues → look in ScopeManager)
- Foundation for future features

---

## A2: Use AST for Bundling

**Files**: `REFACTORING_A2_PLAN.md`

**Time**: 3-4 days

**Phases**:
1. Add declaration tracking (2-3 hours) ✅ Low risk
2. Track during transpilation (3-4 hours) ⚠️ Medium risk
3. Create AST bundling (3-4 hours) ✅ Low risk (parallel)
4. Add fallback path (2-3 hours) ✅ Low risk (flag-gated)
5. Enable and verify (4-6 hours) ⚠️ Medium-high risk
6. Remove old path (1-2 hours) ✅ Low risk

**Risk Profile**:
- Phases 1-3: Low risk (additions, not replacing)
- Phase 4: Low risk (dual path with feature flag)
- Phase 5: Medium-high risk (switching to new bundling)
  - Mitigated by: Feature flag, extensive testing, easy rollback
- Phase 6: Low risk (cleanup)

**Benefits**:
- Robust bundling (no regex dependencies)
- Source information preserved
- Foundation for tree-shaking
- Foundation for source maps

---

## Execution Strategy

### Week 1: A1 - Context Managers

**Monday**: Phases 1-2
- Create all 4 manager classes
- Add to context with compatibility layer
- Test: Should pass with zero changes

**Tuesday**: Phase 3 - CodeGenState migration
- Migrate `usedPrimitives` etc. to `ctx.codeGen.*`
- ~15 files to update
- Test after each file

**Wednesday**: Phase 3 - ScopeManager migration
- Migrate scope stack operations to `ctx.scopes.*`
- ~8 files to update
- Test after each file

**Thursday**: Phase 3 - ImportTracker migration
- Migrate import tracking to `ctx.imports.*`
- Test throughout

**Friday**: Phases 4-5
- Remove old fields
- Add manager unit tests
- Final verification
- **Commit and celebrate** 🎉

### Week 2: A2 - AST Bundling

**Monday**: Phases 1-2
- Create DeclarationTracker
- Track declarations during transpilation
- Test: Should pass (parallel tracking)

**Tuesday**: Phase 3
- Create AST bundling logic
- Write unit tests for mergeDeclarations
- Test bundling in isolation

**Wednesday-Thursday**: Phase 4-5
- Add feature flag and dual path
- Test with `useAstBundling: false` (should pass)
- Test with `useAstBundling: true` (debug if needed)
- Compare outputs between paths

**Friday**: Phase 6
- Enable by default
- Remove old code
- Final verification
- **Commit and celebrate** 🎉

---

## Testing Checklist (Use After Each Step)

```bash
# Quick test (30 seconds)
npm run build

# Unit tests (1 minute)
npx vitest run

# Full corpus (2-3 minutes)
node bin/test-harness.js test/corpus test/corpus/bosl test/corpus/bosl2
```

**Success Criteria Each Step**:
- ✅ Build passes
- ✅ 246/246 unit tests pass
- ✅ 246/281 corpus tests pass (87.5%)

**If Step Fails**:
1. Read error message carefully
2. Check what changed in last commit
3. Debug or revert: `git revert HEAD`
4. Fix issue, test again
5. If stuck >30 min, ask for help or try different approach

---

## Commit Message Template

```
refactor(openscad): [A1/A2] [phase-step] - brief description

[Detailed description of what changed]

Testing:
- Unit tests: 246/246 passing
- Corpus tests: 246/281 passing (87.5%)
- No behavioral changes

Part of [A1: Context Managers / A2: AST Bundling] refactoring
```

**Examples**:
```
refactor(openscad): A1 Phase 1.1 - create CodeGenState manager

Extracted JSCAD usage tracking into dedicated CodeGenState class.
Includes clone() and mergeFrom() for nested contexts.

Testing:
- Build passes
- File not used yet, zero behavior change

Part of A1: Split Context into Focused Managers
```

```
refactor(openscad): A1 Phase 3.1 - migrate codeGen call sites

Changed all ctx.usedPrimitives to ctx.codeGen.usedPrimitives.
Updated 15 files: builtins.ts, helpers/index.ts, statements.ts, etc.

Testing:
- Unit tests: 246/246 passing
- Corpus tests: 246/281 passing (87.5%)
- No behavioral changes

Part of A1: Split Context into Focused Managers
```

---

## Emergency Rollback

If a step goes badly wrong:

```bash
# Revert last commit
git revert HEAD

# Or go back multiple steps
git log --oneline  # Find good commit
git revert <commit>..HEAD

# Or nuclear option - abandon branch
git checkout main
git branch -D hierarchical-params
git checkout -b hierarchical-params origin/hierarchical-params
```

---

## Progress Tracking

### A1: Split Context into Focused Managers

- [ ] Phase 1: Create manager classes
  - [ ] 1.1 CodeGenState
  - [ ] 1.2 ScopeManager
  - [ ] 1.3 ImportTracker
  - [ ] 1.4 FileCacheManager
- [ ] Phase 2: Add to context
  - [ ] 2.1 CodeGenState
  - [ ] 2.2 ScopeManager
  - [ ] 2.3 ImportTracker
  - [ ] 2.4 FileCacheManager
- [ ] Phase 3: Migrate call sites
  - [ ] 3.1 CodeGenState (~15 files)
  - [ ] 3.2 ScopeManager (~8 files)
  - [ ] 3.3 ImportTracker (~6 files)
  - [ ] 3.4 FileCacheManager (~4 files)
- [ ] Phase 4: Remove old fields
  - [ ] 4.1 CodeGenState
  - [ ] 4.2 ScopeManager
  - [ ] 4.3 ImportTracker
  - [ ] 4.4 FileCacheManager
- [ ] Phase 5: Add tests
  - [ ] 5.1 CodeGenState tests
  - [ ] 5.2 ScopeManager tests
  - [ ] 5.3 ImportTracker tests
  - [ ] 5.4 FileCacheManager tests

### A2: Use AST for Bundling

- [ ] Phase 1: Add declaration tracking
  - [ ] 1.1 Define Declaration types
  - [ ] 1.2 Add to context
  - [ ] 1.3 Add to TranspiledFile cache
- [ ] Phase 2: Track during transpilation
  - [ ] 2.1 Track function declarations
  - [ ] 2.2 Track module declarations
  - [ ] 2.3 Track constant declarations
  - [ ] 2.4 Store in cache
- [ ] Phase 3: Create AST bundling
  - [ ] 3.1 Declaration transpiler
  - [ ] 3.2 AST-based bundler
- [ ] Phase 4: Add fallback path
  - [ ] 4.1 Feature flag
  - [ ] 4.2 Dual path
  - [ ] 4.3 Test new path
- [ ] Phase 5: Enable and verify
  - [ ] 5.1 Enable by default
  - [ ] 5.2 Test complex files
  - [ ] 5.3 Compare outputs
- [ ] Phase 6: Remove old path
  - [ ] 6.1 Remove string bundling
  - [ ] 6.2 Remove feature flag

---

## Success Celebration Points

After A1 complete:
- Context reduced from 30+ fields to 4 managers + config
- Code is cleaner and more maintainable
- Each manager is independently testable
- Same test pass rate maintained

After A2 complete:
- Bundling no longer depends on regex
- Source information preserved for debugging
- Foundation for tree-shaking and source maps
- Same test pass rate maintained

**Total improvement**: Major architectural cleanup with zero behavioral changes! 🎉

---

## Questions Before Starting?

1. Which refactoring to start with? (Recommend: A1)
2. How much time can you dedicate? (Recommend: Full focused days)
3. Want me to start Phase 1 of A1? (I can do the manager classes)
4. Prefer different step breakdown? (Happy to adjust)
