# Remaining Issues

Issues identified during code review that were not addressed in the initial fix PRs.
None of these are critical - they are enhancements, documentation updates, or require architectural decisions.

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Accessibility | 6 | Low (Enhancement) |
| Memory (params system) | 2 | Medium |
| Feature Gaps | 2 | Low |
| Documentation | 1 | Low |
| Decision Needed | 2 | Low |
| **Total** | **13** | |

---

## Accessibility Enhancements

These improve usability for screen readers and keyboard-only users.

### params-ui (hierarchical-params branch)
| Issue | Description |
|-------|-------------|
| Missing ARIA roles | Tree structure lacks `tree`, `treeitem`, `aria-expanded` roles |
| No keyboard navigation | Cannot navigate parameter tree with keyboard |

### jscad-web
| Issue | Description |
|-------|-------------|
| Missing ARIA roles | Toolbar, file tree, panels lack semantic roles |
| No keyboard navigation | File tree not keyboard accessible |
| Modal focus trap | Modal dialogs don't trap focus |
| Missing aria-expanded | Collapsible panels don't announce state |

---

## Memory Issues (params system)

On `hierarchical-params` branch - address when merging feature.

| Package | Issue | Description |
|---------|-------|-------------|
| params-ui | Event listeners | Document event listeners for class input, color picker never removed |
| params-core | Proxy caching | Child proxies cached indefinitely, potential memory growth |

---

## Feature Gaps

Export formats that are advertised but incomplete.

| Package | Issue | Description |
|---------|-------|-------------|
| jscad-web | DXF export | Listed in export menu but not implemented |
| jscad-web | X3D export | Produces incorrect format |

---

## Documentation

| Package | Issue | Description |
|---------|-------|-------------|
| 3mf-export-compact | Inaccurate README | Claims "no dependencies" but uses fast-xml-parser |

---

## Decisions Needed

| Package | Issue | Recommendation |
|---------|-------|----------------|
| modeling-preview | Abandoned package | Broken API, not used anywhere. Consider removing from repo. |
| react-app | Missing Error Boundary | Example app lacks WebGL error handling. Low priority but improves example quality. |

---

## Reference

All critical issues (security, bugs, memory leaks in core packages) were fixed in PRs #22-#70.
See [PR_MERGE_STRATEGY.md](./PR_MERGE_STRATEGY.md) for complete list of merged fixes.

The detailed phase-by-phase review findings are preserved in:
- CODE_REVIEW_PHASE1.md through CODE_REVIEW_PHASE9.md
- CODE_REVIEW_PLAN.md (master tracking document)

---

*Generated: 2026-01-25*
