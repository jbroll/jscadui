# Generic PR Review Procedure

A reusable procedure for reviewing and merging batches of PRs, developed from the jscadui code review experience.

## Overview

This procedure provides systematic gates for evaluating PRs before merge. It balances automation with human judgment to ensure code quality while avoiding unnecessary delays.

## Phase 1: Automated Verification

Run these checks first - they're fast and objective.

```bash
# Check PR status
gh pr view <PR_NUMBER> --json state,mergeable,statusCheckRollup

# If CI is configured:
# - All tests pass
# - Build succeeds
# - Type checking passes (if applicable)
# - Linting passes (if applicable)
```

**Gate**: All automated checks must pass before proceeding.

## Phase 2: Change Assessment

Before reviewing code, understand WHAT changed and WHY.

### 2.1 Scope Analysis
```bash
# View the changes
gh pr diff <PR_NUMBER>

# Check file count and lines changed
gh pr view <PR_NUMBER> --json files,additions,deletions
```

Questions to answer:
- [ ] Is the scope appropriate? (Single concern per PR)
- [ ] Are the file changes expected for the stated goal?
- [ ] Are there any unexpected files modified?

### 2.2 Necessity Check

**Critical Question: Is this change necessary?**

For each change, ask:
1. **Does the problem exist?** Can you reproduce the bug or verify the vulnerability?
2. **Is the fix correct?** Does it actually solve the stated problem?
3. **Is it minimal?** Does it change only what's needed, or does it include gratuitous refactoring?

Red flags:
- "Cleanup" changes bundled with fixes
- Speculative fixes for theoretical issues
- Changes that add complexity without clear benefit

### 2.3 Risk Assessment

| Risk Level | Criteria | Review Depth |
|------------|----------|--------------|
| Low | Documentation, comments, trivial fixes | Quick scan |
| Medium | Bug fixes in isolated code, new utilities | Standard review |
| High | Security fixes, API changes, core logic | Deep review + testing |
| Critical | Authentication, authorization, data handling | Deep review + multiple reviewers |

## Phase 3: Code Review

Use `/git-pr-workflows:code-reviewer` skill for systematic analysis.

### 3.1 Security Review (for security-related PRs)

- [ ] Does the fix address the vulnerability completely?
- [ ] Does it introduce new attack vectors?
- [ ] Is input validation sufficient?
- [ ] Are there similar issues elsewhere that need fixing?

### 3.2 Correctness Review

- [ ] Does the logic handle edge cases?
- [ ] Are error conditions handled appropriately?
- [ ] Is the code defensive against unexpected inputs?
- [ ] Does it maintain backward compatibility (if required)?

### 3.3 Quality Review

- [ ] Is the code readable and maintainable?
- [ ] Are there performance concerns?
- [ ] Does it follow project conventions?
- [ ] Is there appropriate error messaging for debugging?

### 3.4 Browser/Environment Compatibility

For frontend code:
- [ ] ES version compatibility (e.g., Object.hasOwn is ES2022)
- [ ] Browser API availability
- [ ] Node.js version requirements (if applicable)

## Phase 4: Testing Verification

### 4.1 Automated Tests
- [ ] Are existing tests passing?
- [ ] Are new tests added for new code?
- [ ] Is test coverage adequate for the change?

### 4.2 Manual Testing (for High/Critical risk)
```bash
# Build and test locally
npm install
npm run build
npm test

# For UI changes, run the app
npm run start
```

### 4.3 Regression Check
- [ ] Do related features still work?
- [ ] Are there integration points that could break?

## Phase 5: PR Comments & Communication

```bash
# Check for existing comments
gh pr view <PR_NUMBER> --comments

# Respond to any outstanding questions or concerns
gh pr comment <PR_NUMBER> --body "Your response"
```

- [ ] All reviewer comments addressed
- [ ] All automated review comments resolved (Sourcery, etc.)
- [ ] No unresolved conversations

## Phase 6: Merge Decision

### Merge Checklist
- [ ] Phase 1: All automated checks pass
- [ ] Phase 2: Change is necessary and appropriate
- [ ] Phase 3: Code review complete, no blocking issues
- [ ] Phase 4: Testing complete (appropriate to risk level)
- [ ] Phase 5: All comments resolved

### Merge Strategy
```bash
gh pr merge <PR_NUMBER> --rebase
```

**Note**: Only rebase merges are allowed on this repository.

## Conflict Resolution

If PR has merge conflicts:
```bash
git fetch origin
git checkout <branch>
git rebase origin/main
# Resolve conflicts
git push --force-with-lease
```

## Batch Processing Strategy

When processing multiple PRs:

### 1. Categorize by Risk
Sort PRs into Low/Medium/High/Critical risk categories.

### 2. Order by Dependencies
Identify which PRs affect common files and may conflict with each other.

### 3. Process in Waves
- **Wave 1**: Low-risk, no conflicts - can merge quickly
- **Wave 2**: Medium-risk, no conflicts - standard review
- **Wave 3**: High/Critical risk - deep review
- **Wave 4**: Conflicting PRs - resolve in dependency order

### 4. Checkpoint Testing
After each wave, run full test suite:
```bash
npm install
npm run build
npm test
```

## Quick Reference Commands

```bash
# List all open PRs
gh pr list --state open

# View PR details
gh pr view <NUMBER>

# Check mergeable status
gh pr view <NUMBER> --json mergeable,statusCheckRollup

# View PR diff
gh pr diff <NUMBER>

# Read comments
gh pr view <NUMBER> --comments

# Add comment
gh pr comment <NUMBER> --body "Comment text"

# Merge (rebase only)
gh pr merge <NUMBER> --rebase

# Rebase conflicting branch
git checkout <branch> && git rebase origin/main && git push --force-with-lease
```

## Anti-Patterns to Avoid

1. **Rubber-stamping**: Merging without actually reviewing code
2. **Scope creep**: Accepting unrelated changes bundled in a PR
3. **Premature optimization**: Accepting complex solutions for simple problems
4. **Review fatigue**: Rushing through large batches without breaks
5. **Ignoring context**: Not understanding why a change was made
6. **Skipping tests**: Assuming automated tests catch everything

## When to Request Changes

- Security vulnerability introduced or not fully fixed
- Logic errors that will cause bugs
- Breaking changes without migration path
- Missing error handling in critical paths
- Code that violates project conventions significantly
- Changes that are unnecessary or out of scope

## When to Approve with Comments

- Minor style issues
- Suggestions for future improvement
- Non-blocking observations
- Documentation improvements

---

*This procedure is designed to be adapted to project needs. Adjust risk thresholds and review depth based on project maturity and team capacity.*
