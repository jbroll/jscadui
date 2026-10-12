/**
 * Tree-view parameter editor component
 * Renders hierarchical params with collapsible nodes, spinners, and class linking
 */

import { toMap } from '@jscadui/params-core'
import { createInput as createInputComponent } from './inputs.js'
import { createClassInput } from './createClassInput.js'

export { paramsTreeStyles } from './paramsTreeStyles.js'

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
 * @property {string[]} [expandedPaths] - Node paths to start expanded, for a
 *   rebuild that carries the previous tree's collapse state; every other node
 *   collapses as `startCollapsed` would
 */

/**
 * Create a tree-view parameter editor
 * @param {ParamsTreeOptions} options
 * @returns {{update: (options: Partial<ParamsTreeOptions>) => void, destroy: () => void, getExpandedPaths: () => string[], reset: () => Record<string, unknown>}}
 */
export const createParamsTree = (options) => {
  const { target, onChange, onClassChange, startCollapsed = true, expandedPaths } = options
  let { tree, values, types, classes, codeClasses, showHidden = false } = options

  // Convert to Maps if plain objects
  let typesMap = toMap(types)
  let classesMap = toMap(classes)
  let codeClassesMap = toMap(codeClasses)

  // Track collapsed state
  const collapsed = new Set()

  // Track cleanup functions for inputs with document-level event listeners
  /** @type {Array<() => void>} */
  let cleanupFunctions = []

  /** Call all cleanup functions and clear the list */
  // I11 fix: Handle errors in individual cleanup functions to prevent one failure from blocking others
  const runCleanup = () => {
    for (const cleanup of cleanupFunctions) {
      try {
        cleanup()
      } catch (err) {
        console.error('Cleanup error:', err)
      }
    }
    cleanupFunctions = []
  }

  // Helper to collect all node paths for collapsing
  /** @param {import('@jscadui/params-core').PartNode} node @returns {string[]} */
  const collectPaths = (node, paths = []) => {
    if (node.path) paths.push(node.path)
    for (const child of Object.values(node.children)) collectPaths(child, paths)
    return paths
  }

  // Collapse all sub-levels by default, keeping the paths a rebuild carries.
  const initializeCollapsed = () => {
    collapsed.clear()
    if (!tree) return
    const all = collectPaths(tree)
    if (expandedPaths) {
      const expanded = new Set(expandedPaths)
      for (const path of all) {
        if (!expanded.has(path)) collapsed.add(path)
      }
    } else if (startCollapsed) {
      for (const path of all) collapsed.add(path)
    }
  }

  initializeCollapsed()

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
    // Clean up any existing document-level event listeners before re-rendering
    runCleanup()
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
          const wasCollapsed = collapsed.has(node.path)
          if (wasCollapsed) {
            collapsed.delete(node.path)
          } else {
            collapsed.add(node.path)
          }
          // Incremental update: toggle visibility without full re-render
          const content = div.querySelector(':scope > .params-tree-content')
          if (content) {
            content.classList.toggle('params-tree-content--collapsed', !wasCollapsed)
            toggle.textContent = wasCollapsed ? '▼' : '▶'
          } else {
            // Content doesn't exist yet (was initially collapsed), need full render
            render()
          }
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

    // Content (params and children) - always render, use CSS for collapse
    if (hasChildren || hasParams || !node.path) {
      const content = document.createElement('div')
      content.className = 'params-tree-content'
      if (isCollapsed && node.path) {
        content.classList.add('params-tree-content--collapsed')
      }

      // Params, with a heading wherever the group label changes
      let group
      for (const param of node.params) {
        if (!showHidden && param.hidden) continue
        if (param.group && param.group !== group) {
          const heading = document.createElement('div')
          heading.className = 'params-tree-group'
          heading.textContent = param.group
          content.appendChild(heading)
        }
        group = param.group
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
   * @returns {{control: HTMLElement|null, value: HTMLElement|null, span: boolean, updateValue?: (newValue: unknown) => void, cleanup?: () => void}}
   */
  const createInput = (param, value) => {
    // Special handling for _class - show combobox with available classes for this type
    if (param.name === '_class') {
      const classInputResult = createClassInput({ param, value, typesMap, classesMap, codeClassesMap, onClassChange })
      // Track cleanup function if provided
      if (classInputResult.cleanup) {
        cleanupFunctions.push(classInputResult.cleanup)
      }
      // Class input goes in value column
      return classInputResult
    }

    // Use the input factory for all other parameter types
    const result = createInputComponent({
      param,
      value,
      onChange: (val) => onChange(param.path, val)
    })

    // Track cleanup function if provided (e.g., color picker)
    if (result.cleanup) {
      cleanupFunctions.push(result.cleanup)
    }

    return result
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
      runCleanup()
      target.innerHTML = ''
    },
    setShowHidden: (show) => {
      showHidden = show
      render()
    },
    collapseAll: () => {
      for (const path of collectPaths(tree)) collapsed.add(path)
      render()
    },
    expandAll: () => {
      collapsed.clear()
      render()
    },
    getExpandedPaths: () => collectPaths(tree).filter((path) => !collapsed.has(path)),
    reset: () => {
      const defaults = {}
      const walk = (node) => {
        for (const param of node.params) defaults[param.path] = param.default
        for (const child of Object.values(node.children)) walk(child)
      }
      if (tree) walk(tree)
      values = { ...defaults }
      collapsed.clear()
      if (tree && startCollapsed) {
        for (const path of collectPaths(tree)) collapsed.add(path)
      }
      render()
      return defaults
    }
  }
}
