# Plan: jscad-web Accessibility Improvements (#79)

## Overview
Add ARIA roles, keyboard navigation, and focus management to the jscad-web production app.

## Scope

### 1. Toolbar Accessibility
**Files:** `apps/jscad-web/index.html`

- Add `role="toolbar"` and `aria-label="Main actions"` to toolbar container
- Ensure all toolbar buttons have accessible names
- Add keyboard navigation (arrow keys between buttons)

### 2. File Tree Accessibility
**Files:** `apps/jscad-web/src/editor.js`

- Add `role="tree"` to file tree container
- Add `role="treeitem"` to each file/folder
- Add `aria-expanded` for folders
- Implement keyboard navigation:
  - Arrow Up/Down: Navigate between items
  - Arrow Left: Collapse folder or move to parent
  - Arrow Right: Expand folder or move to first child
  - Enter: Open file or toggle folder
  - Home/End: Jump to first/last item

### 3. Panel Accessibility
**Files:** `apps/jscad-web/index.html`, related JS

- Add `role="region"` or `role="complementary"` to panels
- Add `aria-label` to identify each panel
- Add `aria-expanded` to collapsible panels
- Announce panel state changes to screen readers

### 4. Modal Focus Management
**Files:** Modal-related components

- Trap focus inside modals when open
- Return focus to trigger element when modal closes
- Add `role="dialog"` and `aria-modal="true"`
- Ensure Escape key closes modals

## Implementation Steps

### Phase 1: Audit (1-2 hours)
1. [ ] Run accessibility audit tools (axe, Lighthouse)
2. [ ] Document all accessibility violations
3. [ ] Prioritize by severity (critical first)

### Phase 2: Toolbar & Static Elements (2 hours)
1. [ ] Add ARIA roles to toolbar
2. [ ] Add ARIA roles to panels
3. [ ] Add proper labels to all interactive elements

### Phase 3: File Tree (4-6 hours)
1. [ ] Implement tree ARIA pattern
2. [ ] Add keyboard navigation
3. [ ] Test with screen readers (NVDA, VoiceOver)

### Phase 4: Modals & Focus (2-3 hours)
1. [ ] Implement focus trap utility
2. [ ] Apply to all modal dialogs
3. [ ] Test keyboard-only navigation

### Phase 5: Testing (2 hours)
1. [ ] Manual screen reader testing
2. [ ] Keyboard-only navigation testing
3. [ ] Automated accessibility testing

## Resources
- [WAI-ARIA Tree Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Focus Management](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

## Estimated Total Effort
10-15 hours
