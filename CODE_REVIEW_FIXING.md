# Code Review Issue Fixing Procedure

## Priority Order

Select next issue (highest priority first):

1. **Security** - XSS, SSRF, path traversal, CVEs, eval risks
2. **Crash bugs** - undefined variables, wrong constructors, missing handlers
3. **Memory leaks** - event listeners, object URLs, timeouts, RAF handles
4. **Data corruption** - wrong types, buffer overflows, race conditions
5. **Accessibility** - ARIA roles, keyboard navigation
6. **Performance** - blocking operations, missing debounce
7. **Code quality** - dead code, documentation, naming

## Per-Issue Workflow

### 1. Find Next Issue (on agent-code-review branch)
- Open phase file (start with `CODE_REVIEW_PHASE1.md`, work forward)
- Find first unchecked `[ ]` item in priority order
- Note the package, description, and location

### 2. Evaluate & Plan (on agent-code-review branch)
- Read source code at the location
- If invalid/already fixed: mark `[x] N/A` in phase file, commit, skip to next
- Write plan to `CURRENT_FIX.md` (untracked file):

```markdown
# Current Fix

**Issue:** <description>
**Phase:** <N> | **Severity:** <Critical/High/Medium>
**Package:** <package-name>
**Location:** <file:line>

## Analysis
<what the problem is, why it's a problem>

## Fix Plan
<specific changes to make, files to modify>

## Test Plan
<how to verify the fix>

## Branch Name
fix/<package>-<brief-description>
```

### 3. Create Fix Branch
```bash
git checkout main
git pull origin main
git checkout -b fix/<package>-<brief-description>
```
Note: `CURRENT_FIX.md` stays as untracked file, visible on new branch

### 4. Implement Fix
- Follow the plan in `CURRENT_FIX.md`
- Make minimal, focused code changes
- Check for similar patterns elsewhere

### 5. Test
- Run `npm test` in affected package
- For security fixes, manually verify vulnerability is closed

### 6. Commit & PR
```bash
git add <fixed files>
git commit -m "fix(<package>): <brief description>

<details from CURRENT_FIX.md>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

git push -u origin fix/<package>-<brief-description>
gh pr create --title "fix(<package>): <description>" --body "..."
```

### 7. Update Tracking
```bash
git checkout agent-code-review
```
- In phase file, mark issue: `[x] → PR #<num>`
- Commit: `docs: mark <issue> fixed in PR #<num>`
- Push
- Delete `CURRENT_FIX.md`

### 8. Next Issue
- **Do not wait for user confirmation** - continue immediately to the next issue
- User will review PRs asynchronously
- Fix as many issues as possible in one session
- Return to step 1

## Files

| File | Branch | Tracked | Purpose |
|------|--------|---------|---------|
| `CODE_REVIEW_PHASE*.md` | agent-code-review | Yes | Issue tracking |
| `CURRENT_FIX.md` | (untracked) | No | Current fix plan |

## Quick Reference

```
ON agent-code-review:
  1. Find next [ ] in phase file
  2. Read code, evaluate issue
  3. Write plan to CURRENT_FIX.md

ON fix branch:
  4. git checkout main && git checkout -b fix/<name>
  5. Implement fix per CURRENT_FIX.md
  6. Test, commit, push, create PR

ON agent-code-review:
  7. Mark [x] with PR#, commit, push
  8. Delete CURRENT_FIX.md
  9. Repeat
```
