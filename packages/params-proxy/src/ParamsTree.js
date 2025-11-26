/**
 * Tree-view parameter editor component
 * Renders hierarchical params with collapsible nodes, spinners, and class linking
 */

import { getClassesForType } from './createParamsProxy.js'

/**
 * @typedef {'unlink'|'move_group'|'join'|'join_group'} ClassChangeMode
 * - 'unlink': Move just this part to a new class (keeps values)
 * - 'move_group': Move all parts in current class to a new class (keeps values)
 * - 'join': Move just this part to an existing class (adopts target values)
 * - 'join_group': Move all parts in current class to an existing class (adopts target values)
 */

/**
 * @typedef {Object} ParamsTreeOptions
 * @property {HTMLElement} target - Container element
 * @property {import('./createParamsProxy.js').PartNode} tree - Parameter tree
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
  let typesMap = types instanceof Map ? types : new Map(Object.entries(types || {}))
  let classesMap = classes instanceof Map ? classes : new Map(Object.entries(classes || {}))
  let codeClassesMap = codeClasses instanceof Map ? codeClasses : new Map(Object.entries(codeClasses || {}))

  // Track collapsed state
  const collapsed = new Set()

  const render = () => {
    target.innerHTML = ''
    target.appendChild(renderNode(tree, 0))
  }

  /**
   * @param {import('./createParamsProxy.js').PartNode} node
   * @param {number} depth
   * @returns {HTMLElement}
   */
  const renderNode = (node, depth) => {
    const div = document.createElement('div')
    div.className = 'params-tree-node'
    div.style.marginLeft = depth > 0 ? '16px' : '0'

    const hasChildren = Object.keys(node.children).length > 0
    const hasParams = node.params.filter(p => showHidden || !p.hidden).length > 0
    const isCollapsed = collapsed.has(node.path)

    // Node header (for non-root nodes)
    if (node.path) {
      const header = document.createElement('div')
      header.className = 'params-tree-header'
      header.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;cursor:pointer;'

      // Collapse toggle
      if (hasChildren || hasParams) {
        const toggle = document.createElement('span')
        toggle.className = 'params-tree-toggle'
        toggle.textContent = isCollapsed ? '▶' : '▼'
        toggle.style.cssText = 'width:12px;font-size:10px;color:#888;'
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
        spacer.style.width = '12px'
        header.appendChild(spacer)
      }

      // Part name
      const name = document.createElement('span')
      name.className = 'params-tree-name'
      name.textContent = node.name
      name.style.cssText = 'font-weight:500;'
      header.appendChild(name)

      // Type badge
      if (node.type) {
        const type = document.createElement('span')
        type.className = 'params-tree-type'
        type.textContent = `(${node.type})`
        type.style.cssText = 'font-size:0.85em;color:#666;margin-left:4px;'
        header.appendChild(type)
      }

      // Class badge
      if (node.partClass) {
        const cls = document.createElement('span')
        cls.className = 'params-tree-class'
        cls.textContent = `[${node.partClass}]`
        cls.style.cssText = 'font-size:0.8em;color:#08f;margin-left:4px;'
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
   * @param {import('./createParamsProxy.js').ParamDefinition} param
   * @returns {HTMLElement}
   */
  const renderParam = (param) => {
    const row = document.createElement('div')
    row.className = 'params-tree-param'
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0;margin-left:16px;'

    // Label
    const label = document.createElement('label')
    label.textContent = param.name
    label.style.cssText = 'min-width:80px;font-size:0.9em;color:#666;'
    if (param.hidden) {
      label.style.fontStyle = 'italic'
      label.style.color = '#999'
    }
    row.appendChild(label)

    // Input based on type
    const value = values[param.path] ?? param.default
    const input = createInput(param, value)
    row.appendChild(input)

    return row
  }

  /**
   * @param {import('./createParamsProxy.js').ParamDefinition} param
   * @param {unknown} value
   * @returns {HTMLElement}
   */
  const createInput = (param, value) => {
    const { type, min, max, step, values: choiceValues, captions } = param

    // Special handling for _class - show combobox with available classes for this type
    if (param.name === '_class') {
      return createClassInput(param, value)
    }

    if (type === 'checkbox') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = !!value
      input.onchange = () => onChange(param.path, input.checked)
      return input
    }

    if (type === 'choice' && choiceValues) {
      const select = document.createElement('select')
      select.style.cssText = 'padding:2px 4px;'
      for (let i = 0; i < choiceValues.length; i++) {
        const opt = document.createElement('option')
        opt.value = choiceValues[i]
        opt.textContent = captions?.[i] || choiceValues[i]
        if (choiceValues[i] === value) opt.selected = true
        select.appendChild(opt)
      }
      select.onchange = () => onChange(param.path, select.value)
      return select
    }

    if (type === 'number' || type === 'int') {
      const container = document.createElement('span')
      container.style.cssText = 'display:flex;align-items:center;gap:2px;'

      const input = document.createElement('input')
      input.type = 'number'
      input.value = String(value)
      input.dataset.paramPath = param.path // For targeted updates
      input.style.cssText = 'width:70px;padding:2px 4px;text-align:right;'
      if (min !== undefined) input.min = String(min)
      if (max !== undefined) input.max = String(max)
      if (step !== undefined) input.step = String(step)
      else if (type === 'int') input.step = '1'

      // Use 'input' event for immediate response to spinner clicks
      // 'change' only fires on blur or Enter
      input.oninput = () => {
        const val = type === 'int' ? parseInt(input.value) : parseFloat(input.value)
        if (!isNaN(val)) {
          onChange(param.path, val)
        }
      }

      container.appendChild(input)

      // Show range if min/max defined
      if (min !== undefined && max !== undefined) {
        const range = document.createElement('span')
        range.style.cssText = 'font-size:0.75em;color:#999;'
        range.textContent = `[${min}-${max}]`
        container.appendChild(range)
      }

      return container
    }

    // Default: text input
    const input = document.createElement('input')
    input.type = 'text'
    input.value = String(value ?? '')
    input.style.cssText = 'width:120px;padding:2px 4px;'
    input.onchange = () => onChange(param.path, input.value)
    return input
  }

  /**
   * Create a class editor with dropdown menu and action buttons
   * @param {import('./createParamsProxy.js').ParamDefinition} param
   * @param {unknown} value
   * @returns {HTMLElement}
   */
  const createClassInput = (param, value) => {
    const container = document.createElement('span')
    container.style.cssText = 'display:inline-block;position:relative;'

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
    toggleBtn.textContent = currentValue || '(no class)'
    toggleBtn.style.cssText = 'padding:2px 8px;min-width:100px;text-align:left;cursor:pointer;background:#fff;border:1px solid #ccc;border-radius:3px;font-family:inherit;font-size:inherit;'

    // Dropdown menu (hidden by default) - right-aligned to stay within panel
    const menu = document.createElement('div')
    menu.style.cssText = `
      display:none;position:absolute;top:100%;right:0;z-index:1000;
      background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);
      width:200px;padding:8px 0;margin-top:2px;box-sizing:border-box;
      font-family:inherit;font-size:13px;
    `

    // Track selected class (existing or new)
    let selectedClass = currentValue

    // --- Class list section ---
    const classListLabel = document.createElement('div')
    classListLabel.textContent = 'Select class:'
    classListLabel.style.cssText = 'padding:4px 12px;font-size:11px;color:#666;'
    menu.appendChild(classListLabel)

    const classListContainer = document.createElement('div')
    classListContainer.style.cssText = 'max-height:150px;overflow-y:auto;'

    // Radio buttons for each available class
    for (const cls of availableClasses) {
      const label = document.createElement('label')
      label.style.cssText = 'display:block;padding:4px 12px;cursor:pointer;'
      label.onmouseenter = () => label.style.background = '#f0f0f0'
      label.onmouseleave = () => label.style.background = ''

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = `class-${partPath}`
      radio.value = cls
      radio.checked = cls === currentValue
      radio.style.marginRight = '8px'
      radio.onchange = () => { selectedClass = cls }

      label.appendChild(radio)
      label.appendChild(document.createTextNode(cls))
      classListContainer.appendChild(label)
    }
    menu.appendChild(classListContainer)

    // --- New class input section ---
    const newClassContainer = document.createElement('div')
    newClassContainer.style.cssText = 'padding:4px 12px;border-top:1px solid #eee;margin-top:4px;box-sizing:border-box;'

    const newClassLabel = document.createElement('label')
    newClassLabel.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'

    const newClassRadio = document.createElement('input')
    newClassRadio.type = 'radio'
    newClassRadio.name = `class-${partPath}`
    newClassRadio.value = '__new__'

    const newClassInput = document.createElement('input')
    newClassInput.type = 'text'
    newClassInput.placeholder = 'new class name'
    newClassInput.style.cssText = 'flex:1;min-width:0;padding:2px 4px;border:1px solid #ccc;border-radius:2px;box-sizing:border-box;font-family:inherit;font-size:inherit;'
    newClassInput.onfocus = () => { newClassRadio.checked = true }
    newClassInput.oninput = () => { selectedClass = newClassInput.value.trim() }

    newClassLabel.appendChild(newClassRadio)
    newClassLabel.appendChild(newClassInput)
    newClassContainer.appendChild(newClassLabel)
    menu.appendChild(newClassContainer)

    // --- Action buttons section ---
    const actionsContainer = document.createElement('div')
    actionsContainer.style.cssText = 'padding:8px 12px;border-top:1px solid #eee;margin-top:4px;display:flex;gap:8px;box-sizing:border-box;'

    const setPartBtn = document.createElement('button')
    setPartBtn.type = 'button'
    setPartBtn.textContent = 'Set Part'
    setPartBtn.title = 'Change class for this part only'
    setPartBtn.style.cssText = 'flex:1 1 0;min-width:0;padding:4px 8px;cursor:pointer;background:#e8f4fc;border:1px solid #08f;border-radius:3px;font-family:inherit;font-size:inherit;position:relative;z-index:10;'

    const setGroupBtn = document.createElement('button')
    setGroupBtn.type = 'button'
    setGroupBtn.textContent = 'Set Group'
    setGroupBtn.title = 'Change class for all parts in current group'
    setGroupBtn.style.cssText = 'flex:1 1 0;min-width:0;padding:4px 8px;cursor:pointer;background:#e8fcf4;border:1px solid #0a0;border-radius:3px;font-family:inherit;font-size:inherit;position:relative;z-index:10;'

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
      menu.style.display = 'block'
      selectedClass = currentValue
      // Reset radio selection
      const radios = menu.querySelectorAll('input[type="radio"]')
      radios.forEach(r => { r.checked = r.value === currentValue })
      newClassInput.value = ''
    }

    const closeMenu = () => {
      if (!isOpen) return
      isOpen = false
      menu.style.display = 'none'
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
        typesMap = types instanceof Map ? types : new Map(Object.entries(types || {}))
      }
      if (newOptions.classes !== undefined) {
        classes = newOptions.classes
        classesMap = classes instanceof Map ? classes : new Map(Object.entries(classes || {}))
      }
      if (newOptions.codeClasses !== undefined) {
        codeClasses = newOptions.codeClasses
        codeClassesMap = codeClasses instanceof Map ? codeClasses : new Map(Object.entries(codeClasses || {}))
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
 * Basic CSS styles for the params tree
 * Can be injected or used as reference for custom styling
 */
export const paramsTreeStyles = `
.params-tree-node {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}
.params-tree-header {
  user-select: none;
}
.params-tree-header:hover {
  background: rgba(0,0,0,0.05);
}
.params-tree-toggle {
  cursor: pointer;
}
.params-tree-param input[type="number"],
.params-tree-param input[type="text"],
.params-tree-param select {
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: inherit;
  font-size: inherit;
}
.params-tree-param input[type="number"]:focus,
.params-tree-param input[type="text"]:focus,
.params-tree-param select:focus {
  outline: none;
  border-color: #08f;
}
`
