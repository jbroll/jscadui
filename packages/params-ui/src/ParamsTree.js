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
 */

/**
 * Create a tree-view parameter editor
 * @param {ParamsTreeOptions} options
 * @returns {{update: (options: Partial<ParamsTreeOptions>) => void, destroy: () => void}}
 */
export const createParamsTree = (options) => {
  let { target, tree, values, types, classes, codeClasses, onChange, onClassChange, showHidden = false } = options

  // Convert to Maps if plain objects
  let typesMap = toMap(types)
  let classesMap = toMap(classes)
  let codeClassesMap = toMap(codeClasses)

  // Track collapsed state
  const collapsed = new Set()

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
    if (depth > 0) div.classList.add('params-tree-node--nested')

    const hasChildren = Object.keys(node.children).length > 0
    const hasParams = node.params.filter(p => showHidden || !p.hidden).length > 0
    const isCollapsed = collapsed.has(node.path)

    // Node header (for non-root nodes)
    if (node.path) {
      const header = document.createElement('div')
      header.className = 'params-tree-header'

      // Collapse toggle
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
        header.appendChild(toggle)
      } else {
        const spacer = document.createElement('span')
        spacer.className = 'params-tree-spacer'
        header.appendChild(spacer)
      }

      // Part name
      const name = document.createElement('span')
      name.className = 'params-tree-name'
      name.textContent = node.name
      header.appendChild(name)

      // Type badge
      if (node.type) {
        const type = document.createElement('span')
        type.className = 'params-tree-type'
        type.textContent = `(${node.type})`
        header.appendChild(type)
      }

      // Class badge
      if (node.partClass) {
        const cls = document.createElement('span')
        cls.className = 'params-tree-class'
        cls.textContent = `[${node.partClass}]`
        header.appendChild(cls)
      }

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

    // Label
    const label = document.createElement('label')
    label.className = 'params-tree-label'
    label.textContent = param.label || param.name
    if (param.hidden) {
      label.classList.add('params-tree-label--hidden')
    }
    row.appendChild(label)

    // Input based on type
    const value = values[param.path] ?? param.default
    const input = createInput(param, value)
    // Store param path for external value updates (e.g., class linking)
    input.dataset.paramPath = param.path
    row.appendChild(input)

    return row
  }

  /**
   * @param {import('@jscadui/params-core').ParamDefinition} param
   * @param {unknown} value
   * @returns {HTMLElement}
   */
  const createInput = (param, value) => {
    // Special handling for _class - show combobox with available classes for this type
    if (param.name === '_class') {
      return createClassInput(param, value)
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
     * Simple, deterministic: update state, then re-render
     */
    update: (newOptions) => {
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
      render()
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
/* Base node */
.params-tree-node {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}
.params-tree-node--nested {
  margin-left: 16px;
}

/* Header row */
.params-tree-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  cursor: pointer;
  user-select: none;
}
.params-tree-header:hover {
  background: rgba(0,0,0,0.05);
}

/* Toggle arrow and spacer */
.params-tree-toggle {
  width: 12px;
  font-size: 10px;
  color: #888;
  cursor: pointer;
}
.params-tree-spacer {
  width: 12px;
}

/* Part name */
.params-tree-name {
  font-weight: 500;
}

/* Type badge */
.params-tree-type {
  font-size: 0.85em;
  color: #666;
  margin-left: 4px;
}

/* Class badge */
.params-tree-class {
  font-size: 0.8em;
  color: #08f;
  margin-left: 4px;
}

/* Parameter row */
.params-tree-param {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  margin-left: 16px;
}

/* Parameter label */
.params-tree-label {
  min-width: 80px;
  font-size: 0.9em;
  color: #666;
}
.params-tree-label--hidden {
  font-style: italic;
  color: #999;
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
