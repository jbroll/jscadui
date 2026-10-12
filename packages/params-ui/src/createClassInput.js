/**
 * Class editor input for the parameter tree
 * Dropdown menu and action buttons for changing a part's class
 */

import { getClassesForType } from '@jscadui/params-core'

/** @typedef {import('@jscadui/params-core').ParamDefinition} ParamDefinition */
/** @typedef {import('@jscadui/params-core').ClassChangeMode} ClassChangeMode */

/**
 * @typedef {Object} ClassInputOptions
 * @property {ParamDefinition} param
 * @property {unknown} value
 * @property {Map<string, string>} typesMap
 * @property {Map<string, string>} classesMap
 * @property {Map<string, string>} codeClassesMap
 * @property {(partPath: string, newClass: string, mode: ClassChangeMode) => void} [onClassChange]
 */

/**
 * Create a class editor with dropdown menu and action buttons
 * @param {ClassInputOptions} options
 * @returns {{control: HTMLElement|null, value: HTMLElement|null, span: boolean, updateValue?: (newValue: unknown) => void, cleanup?: () => void}}
 */
export const createClassInput = ({ param, value, typesMap, classesMap, codeClassesMap, onClassChange }) => {
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

  // Close on Escape
  const handleKeydown = (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeMenu()
    }
  }

  // Cleanup function to remove document-level event listeners
  const cleanup = () => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
  }

  // H24 fix: Add event listeners with cleanup on error to prevent leaks
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)

  try {
    // Enter in new class input triggers Set Part
    newClassInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        setPartBtn.click()
      }
    }

    container.appendChild(toggleBtn)
    container.appendChild(menu)

    return {
      control: null,
      value: container,
      span: false,
      cleanup
    }
  } catch (err) {
    // If an error occurs after listeners are added, clean them up
    cleanup()
    throw err
  }
}
