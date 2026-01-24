/**
 * Tree-view parameter editor component
 * Renders hierarchical params with collapsible nodes, spinners, and class linking
 */

import { getClassesForType, toMap } from '@jscadui/params-core'
import { createInput as createInputComponent } from './inputs.js'

/** @typedef {import('@jscadui/params-core').ClassChangeMode} ClassChangeMode */

/**
 * @typedef {Object} ParamsTreeOptions
 * @property {HTMLElement} target - Container element
 * @property {import('@jscadui/params-core').PartNode} tree - Parameter tree
 * @property {Object} values - Current parameter values (flat, dot-notation keys)
 * @property {Map<string, string>|Object} types - Part types
 * @property {Map<string, string>|Object} classes - Part classes (current effective classes)
 * @property {Map<string, string>|Object} [codeClasses] - Original code-defined classes (for showing all options)
 * @property {(paramPath: string, value: unknown) => void} onChange - Called when a value changes
 * @property {(partPath: string, newClass: string, mode: ClassChangeMode) => void} [onClassChange] - Called when a class changes
 * @property {boolean} [showHidden=false] - Whether to show hidden params
 * @property {boolean} [startCollapsed=true] - Whether sub-levels start collapsed
 */

/**
 * Create a tree-view parameter editor
 * @param {ParamsTreeOptions} options
 * @returns {{update: (options: Partial<ParamsTreeOptions>) => void, destroy: () => void}}
 */
export const createParamsTree = (options) => {
  let { target, tree, values, types, classes, codeClasses, onChange, onClassChange, showHidden = false, startCollapsed = true } = options

  // Convert to Maps if plain objects
  let typesMap = toMap(types)
  let classesMap = toMap(classes)
  let codeClassesMap = toMap(codeClasses)

  // Track collapsed state
  const collapsed = new Set()

  // Helper to collect all node paths for collapsing
  const collectAllPaths = (node) => {
    if (node.path) collapsed.add(node.path)
    for (const child of Object.values(node.children)) {
      collectAllPaths(child)
    }
  }

  // Initialize collapsed state - collapse all sub-levels by default
  if (startCollapsed && tree) {
    collectAllPaths(tree)
  }

  /**
   * Get a string key representing tree structure (paths only, not values)
   * Used to detect if tree structure changed vs just param values
   */
  const getTreePaths = (node, paths = []) => {
    if (!node) return ''
    if (node.path) paths.push(node.path)
    for (const param of node.params || []) {
      paths.push(param.path)
    }
    for (const child of Object.values(node.children || {})) {
      getTreePaths(child, paths)
    }
    return paths.join('|')
  }

  /**
   * Update input values in-place without re-rendering
   * This preserves active drag state on sliders
   */
  const updateValuesInPlace = () => {
    const rows = target.querySelectorAll('.params-tree-param')
    for (const row of rows) {
      if (typeof row.updateValue === 'function') {
        const pathEl = row.querySelector('[data-param-path]')
        if (pathEl) {
          const path = pathEl.dataset.paramPath
          if (path && path in values) {
            row.updateValue(values[path])
          }
        }
      }
    }
  }

  const render = () => {
    target.innerHTML = ''
    target.appendChild(renderNode(tree, 0))
  }

  /**
   * @param {import('@jscadui/params-core').PartNode} node
   * @param {number} depth
   * @returns {HTMLElement}
   */
  const renderNode = (node, depth) => {
    const div = document.createElement('div')
    div.className = 'params-tree-node'
    div.style.setProperty('--depth', depth)
    if (depth > 0) div.classList.add('params-tree-node--nested')

    const hasChildren = Object.keys(node.children).length > 0
    const hasParams = node.params.filter(p => showHidden || !p.hidden).length > 0
    const isCollapsed = collapsed.has(node.path)

    // Node header (for non-root nodes)
    if (node.path) {
      const header = document.createElement('div')
      header.className = 'params-tree-header'

      // Indent column with toggle
      const indent = document.createElement('span')
      indent.className = 'params-tree-indent'
      if (hasChildren || hasParams) {
        const toggle = document.createElement('span')
        toggle.className = 'params-tree-toggle'
        toggle.textContent = isCollapsed ? '▶' : '▼'
        toggle.onclick = (e) => {
          e.stopPropagation()
          if (isCollapsed) {
            collapsed.delete(node.path)
          } else {
            collapsed.add(node.path)
          }
          render()
        }
        indent.appendChild(toggle)
      }
      header.appendChild(indent)

      // Name column (name + badges)
      const nameCell = document.createElement('span')
      nameCell.className = 'params-tree-name-cell'

      const name = document.createElement('span')
      name.className = 'params-tree-name'
      name.textContent = node.name
      nameCell.appendChild(name)

      // Type badge
      if (node.type) {
        const type = document.createElement('span')
        type.className = 'params-tree-type'
        type.textContent = `(${node.type})`
        nameCell.appendChild(type)
      }

      // Class badge
      if (node.partClass) {
        const cls = document.createElement('span')
        cls.className = 'params-tree-class'
        cls.textContent = `[${node.partClass}]`
        nameCell.appendChild(cls)
      }
      header.appendChild(nameCell)

      // Empty cells for control and value columns (header spans them)
      const headerSpan = document.createElement('span')
      headerSpan.className = 'params-tree-header-span'
      header.appendChild(headerSpan)

      header.onclick = () => {
        if (isCollapsed) {
          collapsed.delete(node.path)
        } else {
          collapsed.add(node.path)
        }
        render()
      }

      div.appendChild(header)
    }

    // Content (params and children)
    if (!isCollapsed || !node.path) {
      const content = document.createElement('div')
      content.className = 'params-tree-content'

      // Params
      for (const param of node.params) {
        if (!showHidden && param.hidden) continue
        content.appendChild(renderParam(param))
      }

      // Children
      for (const child of Object.values(node.children)) {
        content.appendChild(renderNode(child, depth + 1))
      }

      div.appendChild(content)
    }

    return div
  }

  /**
   * @param {import('@jscadui/params-core').ParamDefinition} param
   * @returns {HTMLElement}
   */
  const renderParam = (param) => {
    const row = document.createElement('div')
    row.className = 'params-tree-param'

    // Indent spacer
    const indent = document.createElement('span')
    indent.className = 'params-tree-indent'
    row.appendChild(indent)

    // Label
    const label = document.createElement('label')
    label.className = 'params-tree-label'
    label.textContent = param.label || param.name
    if (param.hidden) {
      label.classList.add('params-tree-label--hidden')
    }
    row.appendChild(label)

    // Input based on type
    const currentValue = values[param.path] ?? param.default
    const inputResult = createInput(param, currentValue)

    if (inputResult.span) {
      // Text/radio span both columns
      const spanCell = document.createElement('div')
      spanCell.className = 'params-tree-input-span'
      if (inputResult.control) {
        inputResult.control.dataset.paramPath = param.path
        spanCell.appendChild(inputResult.control)
      }
      row.appendChild(spanCell)
    } else {
      // Separate control and value columns
      const controlCell = document.createElement('div')
      controlCell.className = 'params-tree-control'
      if (inputResult.control) {
        controlCell.appendChild(inputResult.control)
      }
      row.appendChild(controlCell)

      const valueCell = document.createElement('div')
      valueCell.className = 'params-tree-value'
      if (inputResult.value) {
        inputResult.value.dataset.paramPath = param.path
        valueCell.appendChild(inputResult.value)
      }
      row.appendChild(valueCell)
    }

    // Store updateValue method on row for external updates
    if (inputResult.updateValue) {
      row.updateValue = inputResult.updateValue
    }

    return row
  }

  /**
   * @param {import('@jscadui/params-core').ParamDefinition} param
   * @param {unknown} value
   * @returns {{control: HTMLElement|null, value: HTMLElement|null, span: boolean, updateValue?: (newValue: unknown) => void}}
   */
  const createInput = (param, value) => {
    // Special handling for _class - show combobox with available classes for this type
    if (param.name === '_class') {
      const classInput = createClassInput(param, value)
      // Class input goes in value column
      return { control: null, value: classInput, span: false }
    }

    // Use the input factory for all other parameter types
    return createInputComponent({
      param,
      value,
      onChange: (val) => onChange(param.path, val)
    })
  }

  /**
   * Create a class editor with dropdown menu and action buttons
   * @param {import('@jscadui/params-core').ParamDefinition} param
   * @param {unknown} value
   * @returns {HTMLElement}
   */
  const createClassInput = (param, value) => {
    const container = document.createElement('span')
    container.className = 'params-tree-class-container'

    const partPath = param.parent
    const partType = typesMap.get(partPath)

    // Get classes from effective (user-modified) classes
    const effectiveClasses = partType ? getClassesForType(typesMap, classesMap, partType) : []
    // Get classes from original code-defined classes (to keep empty classes available)
    const codeDefinedClasses = partType ? getClassesForType(typesMap, codeClassesMap, partType) : []
    // Merge both sets - effective classes + any code-defined classes not already in effective
    const availableClasses = [...effectiveClasses]
    for (const cls of codeDefinedClasses) {
      if (!availableClasses.includes(cls)) {
        availableClasses.push(cls)
      }
    }
    const currentValue = String(value ?? '')

    // Current class display / toggle button
    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = 'params-tree-class-toggle'
    toggleBtn.textContent = currentValue || '(no class)'

    // Dropdown menu (hidden by default)
    const menu = document.createElement('div')
    menu.className = 'params-tree-class-menu'

    // Track selected class (existing or new)
    let selectedClass = currentValue

    // --- Class list section ---
    const classListLabel = document.createElement('div')
    classListLabel.className = 'params-tree-menu-label'
    classListLabel.textContent = 'Select class:'
    menu.appendChild(classListLabel)

    const classListContainer = document.createElement('div')
    classListContainer.className = 'params-tree-class-list'

    // Radio buttons for each available class
    for (const cls of availableClasses) {
      const label = document.createElement('label')
      label.className = 'params-tree-radio-label'
      label.onmouseenter = () => label.classList.add('params-tree-radio-label--hover')
      label.onmouseleave = () => label.classList.remove('params-tree-radio-label--hover')

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = `class-${partPath}`
      radio.value = cls
      radio.checked = cls === currentValue
      radio.className = 'params-tree-radio'
      radio.onchange = () => { selectedClass = cls }

      label.appendChild(radio)
      label.appendChild(document.createTextNode(cls))
      classListContainer.appendChild(label)
    }
    menu.appendChild(classListContainer)

    // --- New class input section ---
    const newClassContainer = document.createElement('div')
    newClassContainer.className = 'params-tree-new-class'

    const newClassLabel = document.createElement('label')
    newClassLabel.className = 'params-tree-new-class-label'

    const newClassRadio = document.createElement('input')
    newClassRadio.type = 'radio'
    newClassRadio.name = `class-${partPath}`
    newClassRadio.value = '__new__'
    newClassRadio.className = 'params-tree-radio'

    const newClassInput = document.createElement('input')
    newClassInput.type = 'text'
    newClassInput.placeholder = 'new class name'
    newClassInput.className = 'params-tree-new-class-input'
    newClassInput.onfocus = () => { newClassRadio.checked = true }
    newClassInput.oninput = () => { selectedClass = newClassInput.value.trim() }

    newClassLabel.appendChild(newClassRadio)
    newClassLabel.appendChild(newClassInput)
    newClassContainer.appendChild(newClassLabel)
    menu.appendChild(newClassContainer)

    // --- Action buttons section ---
    const actionsContainer = document.createElement('div')
    actionsContainer.className = 'params-tree-actions'

    const setPartBtn = document.createElement('button')
    setPartBtn.type = 'button'
    setPartBtn.className = 'params-tree-btn params-tree-btn--part'
    setPartBtn.textContent = 'Set Part'
    setPartBtn.title = 'Change class for this part only'

    const setGroupBtn = document.createElement('button')
    setGroupBtn.type = 'button'
    setGroupBtn.className = 'params-tree-btn params-tree-btn--group'
    setGroupBtn.textContent = 'Set Group'
    setGroupBtn.title = 'Change class for all parts in current group'

    setPartBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (selectedClass && selectedClass !== currentValue) {
        // Determine mode: join existing or create new
        const mode = availableClasses.includes(selectedClass) ? 'join' : 'unlink'
        if (onClassChange) {
          onClassChange(partPath, selectedClass, mode)
        }
      }
      closeMenu()
    })

    setGroupBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (selectedClass && selectedClass !== currentValue) {
        // Determine mode: join_group existing or move_group to new
        const mode = availableClasses.includes(selectedClass) ? 'join_group' : 'move_group'
        if (onClassChange) {
          onClassChange(partPath, selectedClass, mode)
        }
      }
      closeMenu()
    })

    actionsContainer.appendChild(setPartBtn)
    actionsContainer.appendChild(setGroupBtn)
    menu.appendChild(actionsContainer)

    // --- Menu open/close logic ---
    let isOpen = false

    const openMenu = () => {
      if (isOpen) return
      isOpen = true
      menu.classList.add('params-tree-class-menu--open')
      selectedClass = currentValue
      // Reset radio selection
      const radios = menu.querySelectorAll('input[type="radio"]')
      radios.forEach(r => { r.checked = r.value === currentValue })
      newClassInput.value = ''
    }

    const closeMenu = () => {
      if (!isOpen) return
      isOpen = false
      menu.classList.remove('params-tree-class-menu--open')
    }

    toggleBtn.onclick = (e) => {
      e.stopPropagation()
      if (isOpen) closeMenu()
      else openMenu()
    }

    // Close on click outside
    const handleClickOutside = (e) => {
      if (isOpen && !container.contains(e.target)) {
        closeMenu()
      }
    }
    document.addEventListener('click', handleClickOutside)

    // Close on Escape
    const handleKeydown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeMenu()
      }
    }
    document.addEventListener('keydown', handleKeydown)

    // Enter in new class input triggers Set Part
    newClassInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        setPartBtn.click()
      }
    }

    container.appendChild(toggleBtn)
    container.appendChild(menu)

    return container
  }

  // Initial render
  render()

  return {
    /**
     * Update the tree view with new data
     * Only re-renders when structure changes; updates values in-place otherwise
     * This prevents breaking slider drags during model updates
     */
    update: (newOptions) => {
      // Check if structure is changing (requires full re-render)
      // Tree structure change = different paths, not just different param values
      const treeStructureChanged = newOptions.tree !== undefined &&
        getTreePaths(newOptions.tree) !== getTreePaths(tree)

      const structureChanging = (
        treeStructureChanged ||
        newOptions.types !== undefined ||
        newOptions.classes !== undefined ||
        newOptions.codeClasses !== undefined ||
        newOptions.showHidden !== undefined
      )

      if (newOptions.tree !== undefined) tree = newOptions.tree
      if (newOptions.values !== undefined) values = newOptions.values
      if (newOptions.showHidden !== undefined) showHidden = newOptions.showHidden
      if (newOptions.types !== undefined) {
        types = newOptions.types
        typesMap = toMap(types)
      }
      if (newOptions.classes !== undefined) {
        classes = newOptions.classes
        classesMap = toMap(classes)
      }
      if (newOptions.codeClasses !== undefined) {
        codeClasses = newOptions.codeClasses
        codeClassesMap = toMap(codeClasses)
      }

      if (structureChanging) {
        // Full re-render needed
        render()
      } else {
        // Values-only update: update inputs in-place without re-rendering
        // This preserves active drag state on sliders
        updateValuesInPlace()
      }
    },
    destroy: () => {
      target.innerHTML = ''
    },
    setShowHidden: (show) => {
      showHidden = show
      render()
    },
    collapseAll: () => {
      const collectPaths = (node) => {
        if (node.path) collapsed.add(node.path)
        for (const child of Object.values(node.children)) {
          collectPaths(child)
        }
      }
      collectPaths(tree)
      render()
    },
    expandAll: () => {
      collapsed.clear()
      render()
    }
  }
}

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
