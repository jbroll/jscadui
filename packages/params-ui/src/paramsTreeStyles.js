/**
 * CSS styles for the params tree component
 * Inject into document head or use as reference for custom styling
 */
export const paramsTreeStyles = `
/* Root node defines the grid */
.params-tree-node {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  display: grid;
  grid-template-columns:
    [indent] auto
    [label] minmax(80px, auto)
    [control] 1fr
    [value] auto;
  align-items: center;
  row-gap: 2px;
}

/* Nested nodes inherit grid via subgrid */
.params-tree-node--nested {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
}

/* Content container uses subgrid */
.params-tree-content {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
}
.params-tree-content--collapsed {
  display: none;
}

/* Header row uses subgrid */
.params-tree-header {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 2px 0;
  cursor: pointer;
  user-select: none;
}
.params-tree-header:hover {
  background: rgba(0,0,0,0.05);
}

/* Indent column - padding based on depth */
.params-tree-indent {
  grid-column: indent;
  padding-left: calc(var(--depth, 0) * 16px);
  display: flex;
  align-items: center;
}

/* Toggle arrow */
.params-tree-toggle {
  width: 12px;
  font-size: 10px;
  color: #888;
  cursor: pointer;
}

/* Name cell in header */
.params-tree-name-cell {
  grid-column: label;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Part name */
.params-tree-name {
  font-weight: 500;
}

/* Type badge */
.params-tree-type {
  font-size: 0.85em;
  color: #666;
}

/* Class badge */
.params-tree-class {
  font-size: 0.8em;
  color: #08f;
}

/* Header span for control+value columns */
.params-tree-header-span {
  grid-column: control / -1;
}

/* Heading for a run of params with the same group label */
.params-tree-group {
  grid-column: 1 / -1;
  font-weight: 600;
  font-size: 0.85em;
  margin-top: 6px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.3);
}

/* Parameter row uses subgrid */
.params-tree-param {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 2px 0;
}

/* Parameter label */
.params-tree-label {
  grid-column: label;
  font-size: 0.9em;
  color: #666;
}
.params-tree-label--hidden {
  font-style: italic;
  color: #999;
}

/* Control column */
.params-tree-control {
  grid-column: control;
  justify-self: end;
  padding-right: 8px;
}

/* Value column */
.params-tree-value {
  grid-column: value;
}

/* Spanning input (text, radio) */
.params-tree-input-span {
  grid-column: control / -1;
}

/* Class selector container */
.params-tree-class-container {
  display: inline-block;
  position: relative;
}

/* Class toggle button */
.params-tree-class-toggle {
  padding: 2px 8px;
  min-width: 100px;
  text-align: left;
  cursor: pointer;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: inherit;
  font-size: inherit;
}
.params-tree-class-toggle:hover {
  border-color: #08f;
}

/* Class dropdown menu */
.params-tree-class-menu {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 1000;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  width: 200px;
  padding: 8px 0;
  margin-top: 2px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 13px;
}
.params-tree-class-menu--open {
  display: block;
}

/* Menu label */
.params-tree-menu-label {
  padding: 4px 12px;
  font-size: 11px;
  color: #666;
}

/* Class list */
.params-tree-class-list {
  max-height: 150px;
  overflow-y: auto;
}

/* Radio labels in class list */
.params-tree-radio-label {
  display: block;
  padding: 4px 12px;
  cursor: pointer;
}
.params-tree-radio-label--hover {
  background: #f0f0f0;
}
.params-tree-radio {
  margin-right: 8px;
}

/* New class section */
.params-tree-new-class {
  padding: 4px 12px;
  border-top: 1px solid #eee;
  margin-top: 4px;
  box-sizing: border-box;
}
.params-tree-new-class-label {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.params-tree-new-class-input {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 2px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: inherit;
}
.params-tree-new-class-input:focus {
  outline: none;
  border-color: #08f;
}

/* Action buttons */
.params-tree-actions {
  padding: 8px 12px;
  border-top: 1px solid #eee;
  margin-top: 4px;
  display: flex;
  gap: 8px;
  box-sizing: border-box;
}
.params-tree-btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 3px;
  font-family: inherit;
  font-size: inherit;
  position: relative;
  z-index: 10;
}
.params-tree-btn--part {
  background: #e8f4fc;
  border: 1px solid #08f;
}
.params-tree-btn--part:hover {
  background: #d0e8f8;
}
.params-tree-btn--group {
  background: #e8fcf4;
  border: 1px solid #0a0;
}
.params-tree-btn--group:hover {
  background: #d0f8e8;
}
`
