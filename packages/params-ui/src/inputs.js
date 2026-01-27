/**
 * Input component factory for parameter types
 * Creates DOM elements for each parameter type with appropriate event handling
 */

/**
 * @typedef {import('@jscadui/params-core').ParamDefinition} ParamDefinition
 */

/**
 * @typedef {Object} InputOptions
 * @property {ParamDefinition} param - Parameter definition
 * @property {unknown} value - Current value
 * @property {(value: unknown) => void} onChange - Change handler
 */

/**
 * @typedef {Object} InputResult
 * @property {HTMLElement|null} control - Auxiliary control element (col 3) - slider track, color swatch
 * @property {HTMLElement|null} value - Primary input element (col 4) - number input, checkbox, dropdown
 * @property {boolean} span - Whether the control should span both columns (for text, radio)
 * @property {(newValue: unknown) => void} [updateValue] - Method for external value updates
 * @property {() => void} [cleanup] - Method to remove event listeners and prevent memory leaks
 */

/**
 * Create a checkbox input
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createCheckboxInput = ({ param, value, onChange }) => {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'params-input params-input-checkbox'
  input.checked = !!value
  input.onchange = () => onChange(input.checked)

  // ARIA: checkbox has implicit role, add label reference
  if (param.label) {
    input.setAttribute('aria-label', param.label)
  }

  return {
    control: null,
    value: input,
    span: false,
    updateValue: (newValue) => { input.checked = !!newValue }
  }
}

/**
 * Create a number input (int or number type)
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createNumberInput = ({ param, value, onChange }) => {
  const { type, min, max, step } = param

  const container = document.createElement('span')
  container.className = 'params-input-number-container'

  const input = document.createElement('input')
  input.type = 'number'
  input.className = 'params-input params-input-number'
  input.value = String(value ?? '')
  input.dataset.paramPath = param.path

  if (min !== undefined) input.min = String(min)
  if (max !== undefined) input.max = String(max)
  if (step !== undefined) input.step = String(step)
  else if (type === 'int') input.step = '1'

  // ARIA: add label and value range
  if (param.label) {
    input.setAttribute('aria-label', param.label)
  }

  // Use 'input' event for immediate response to spinner clicks
  input.oninput = () => {
    const val = type === 'int' ? parseInt(input.value) : parseFloat(input.value)
    if (!isNaN(val)) {
      onChange(val)
    }
  }

  container.appendChild(input)

  // Show range hint if min/max defined
  if (min !== undefined && max !== undefined) {
    const range = document.createElement('span')
    range.className = 'params-input-range-hint'
    range.textContent = `[${min}-${max}]`
    container.appendChild(range)
  }

  return {
    control: null,
    value: container,
    span: false,
    updateValue: (newValue) => { input.value = String(newValue) }
  }
}

/**
 * Create a slider input (range type)
 * Returns slider track as control, editable number input as value
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createSliderInput = ({ param, value, onChange }) => {
  const { min = 0, max = 100, step = 1, live = true } = param
  const initialValue = value ?? min

  // Range slider (control column)
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.className = 'params-input params-input-slider'
  slider.value = String(initialValue)
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)

  // ARIA: slider has implicit role, add value attributes
  slider.setAttribute('aria-valuenow', String(initialValue))
  slider.setAttribute('aria-valuemin', String(min))
  slider.setAttribute('aria-valuemax', String(max))
  if (param.label) {
    slider.setAttribute('aria-label', param.label)
  }

  // Editable number input (value column)
  const numberInput = document.createElement('input')
  numberInput.type = 'number'
  numberInput.className = 'params-input params-input-slider-number'
  numberInput.value = String(initialValue)
  numberInput.min = String(min)
  numberInput.max = String(max)
  numberInput.step = String(step)

  // ARIA: number input as secondary control
  if (param.label) {
    numberInput.setAttribute('aria-label', `${param.label} value`)
  }

  // Slider -> Number sync + onChange
  slider.oninput = () => {
    numberInput.value = slider.value
    slider.setAttribute('aria-valuenow', slider.value)
    if (live) {
      onChange(Number(slider.value))
    }
  }
  slider.onchange = () => {
    onChange(Number(slider.value))
  }

  // Number -> Slider sync + onChange
  numberInput.oninput = () => {
    const val = Number(numberInput.value)
    if (!isNaN(val)) {
      slider.value = String(val)
      slider.setAttribute('aria-valuenow', String(val))
      onChange(val)
    }
  }

  // Method for external value updates (e.g., class linking)
  const updateValue = (newValue) => {
    slider.value = String(newValue)
    numberInput.value = String(newValue)
    slider.setAttribute('aria-valuenow', String(newValue))
  }

  return {
    control: slider,
    value: numberInput,
    span: false,
    updateValue
  }
}

/**
 * Default color palette for quick selection
 */
const defaultColorPalette = [
  // Row 1: Primary colors + black/white
  '#000000', '#ffffff', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6',
  // Row 2: Darker shades
  '#2c3e50', '#7f8c8d', '#c0392b', '#d35400', '#f39c12', '#27ae60', '#16a085', '#2980b9', '#8e44ad',
  // Row 3: Lighter shades
  '#ecf0f1', '#bdc3c7', '#fadbd8', '#fdebd0', '#fcf3cf', '#d5f5e3', '#d1f2eb', '#d6eaf8', '#e8daef'
]

/**
 * Create a color picker input with palette
 * Returns swatch button (with panel) as control, editable hex input as value
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createColorInput = ({ param, value, onChange }) => {
  const { palette = defaultColorPalette } = param
  const currentValue = String(value ?? '#000000')

  // Control container (button + panel)
  const controlContainer = document.createElement('span')
  controlContainer.className = 'params-input-color-control'

  // Main color button (shows current color)
  const colorBtn = document.createElement('button')
  colorBtn.type = 'button'
  colorBtn.className = 'params-input-color-btn'
  colorBtn.style.backgroundColor = currentValue

  // ARIA: color button controls a popup
  colorBtn.setAttribute('aria-haspopup', 'listbox')
  colorBtn.setAttribute('aria-expanded', 'false')
  colorBtn.setAttribute('aria-label', param.label ? `${param.label} color picker` : 'Color picker')

  // Dropdown panel
  const panel = document.createElement('div')
  panel.className = 'params-input-color-panel'
  panel.setAttribute('role', 'listbox')
  panel.setAttribute('aria-label', 'Color palette')

  // Color palette grid
  const grid = document.createElement('div')
  grid.className = 'params-input-color-grid'

  for (const color of palette) {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'params-input-color-swatch'
    swatch.style.backgroundColor = color
    swatch.title = color

    // ARIA: swatch as option in listbox
    swatch.setAttribute('role', 'option')
    swatch.setAttribute('aria-label', color)
    const isSelected = color.toLowerCase() === currentValue.toLowerCase()
    swatch.setAttribute('aria-selected', String(isSelected))
    if (isSelected) {
      swatch.classList.add('params-input-color-swatch--selected')
    }
    swatch.onclick = (e) => {
      e.stopPropagation()
      selectColor(color)
      closePanel()
    }
    grid.appendChild(swatch)
  }
  panel.appendChild(grid)

  // Custom color picker row
  const customRow = document.createElement('div')
  customRow.className = 'params-input-color-custom'

  const customLabel = document.createElement('span')
  customLabel.className = 'params-input-color-custom-label'
  customLabel.textContent = 'Custom:'

  const customInput = document.createElement('input')
  customInput.type = 'color'
  customInput.className = 'params-input-color-custom-input'
  customInput.value = currentValue

  customInput.oninput = () => {
    selectColor(customInput.value)
  }

  customRow.appendChild(customLabel)
  customRow.appendChild(customInput)
  panel.appendChild(customRow)

  controlContainer.appendChild(colorBtn)
  controlContainer.appendChild(panel)

  // Editable hex input (value column)
  const hexInput = document.createElement('input')
  hexInput.type = 'text'
  hexInput.className = 'params-input params-input-color-hex'
  hexInput.value = currentValue.toUpperCase()
  hexInput.maxLength = 7
  hexInput.placeholder = '#000000'

  // Helper to update all color UI elements (without triggering onChange)
  const updateColorUI = (color) => {
    colorBtn.style.backgroundColor = color
    hexInput.value = color.toUpperCase()
    customInput.value = color
    grid.querySelectorAll('.params-input-color-swatch').forEach(s => {
      const isSelected = s.style.backgroundColor === color || s.title.toLowerCase() === color.toLowerCase()
      s.classList.toggle('params-input-color-swatch--selected', isSelected)
      s.setAttribute('aria-selected', String(isSelected))
    })
  }

  const selectColor = (color) => {
    updateColorUI(color)
    onChange(color)
  }

  // Hex input -> color sync
  hexInput.onchange = () => {
    const hex = hexInput.value.trim()
    // Validate hex color format
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      selectColor(hex)
    } else {
      // Reset to previous valid value
      hexInput.value = colorBtn.style.backgroundColor
    }
  }

  let isOpen = false

  const openPanel = () => {
    if (isOpen) return
    isOpen = true
    panel.classList.add('params-input-color-panel--open')
    colorBtn.setAttribute('aria-expanded', 'true')
  }

  const closePanel = () => {
    if (!isOpen) return
    isOpen = false
    panel.classList.remove('params-input-color-panel--open')
    colorBtn.setAttribute('aria-expanded', 'false')
  }

  colorBtn.onclick = (e) => {
    e.stopPropagation()
    if (isOpen) closePanel()
    else openPanel()
  }

  // Close on click outside
  const handleClickOutside = (e) => {
    if (isOpen && !controlContainer.contains(e.target) && e.target !== hexInput) {
      closePanel()
    }
  }
  document.addEventListener('click', handleClickOutside)

  // Close on Escape
  const handleKeydown = (e) => {
    if (e.key === 'Escape' && isOpen) {
      closePanel()
    }
  }
  document.addEventListener('keydown', handleKeydown)

  // Cleanup function to remove document-level event listeners
  const cleanup = () => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
  }

  return {
    control: controlContainer,
    value: hexInput,
    span: false,
    updateValue: updateColorUI,
    cleanup
  }
}

/**
 * Create a choice (dropdown) input
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createChoiceInput = ({ param, value, onChange }) => {
  const { values = [], captions } = param

  const select = document.createElement('select')
  select.className = 'params-input params-input-choice'

  // ARIA: add label reference
  if (param.label) {
    select.setAttribute('aria-label', param.label)
  }

  for (let i = 0; i < values.length; i++) {
    const opt = document.createElement('option')
    opt.value = String(values[i])
    opt.textContent = captions?.[i] ?? String(values[i])
    if (values[i] === value || String(values[i]) === String(value)) {
      opt.selected = true
    }
    select.appendChild(opt)
  }

  select.onchange = () => {
    // Try to preserve original type (number vs string)
    const selectedValue = select.value
    const originalValue = values.find(v => String(v) === selectedValue)
    onChange(originalValue !== undefined ? originalValue : selectedValue)
  }

  return {
    control: null,
    value: select,
    span: false,
    updateValue: (newValue) => { select.value = String(newValue) }
  }
}

/**
 * Create a radio button group input
 * Spans both control and value columns
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createRadioInput = ({ param, value, onChange }) => {
  const { values = [], captions } = param
  const radioName = `radio-${param.path}-${Date.now()}`

  const container = document.createElement('div')
  container.className = 'params-input-radio-container'

  // ARIA: container as radiogroup
  container.setAttribute('role', 'radiogroup')
  if (param.label) {
    container.setAttribute('aria-label', param.label)
  }

  for (let i = 0; i < values.length; i++) {
    const label = document.createElement('label')
    label.className = 'params-input-radio-label'

    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.className = 'params-input params-input-radio'
    radio.name = radioName
    radio.value = String(values[i])
    if (values[i] === value || String(values[i]) === String(value)) {
      radio.checked = true
    }

    radio.onchange = () => {
      if (radio.checked) {
        // Try to preserve original type
        const originalValue = values.find(v => String(v) === radio.value)
        onChange(originalValue !== undefined ? originalValue : radio.value)
      }
    }

    const text = document.createElement('span')
    text.textContent = captions?.[i] ?? String(values[i])

    label.appendChild(radio)
    label.appendChild(text)
    container.appendChild(label)
  }

  return {
    control: container,
    value: null,
    span: true,
    updateValue: (newValue) => {
      const radios = container.querySelectorAll('input[type="radio"]')
      radios.forEach(r => {
        r.checked = r.value === String(newValue)
      })
    }
  }
}

/**
 * Create a text input (also handles email, url, password)
 * Spans both control and value columns
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createTextInput = ({ param, value, onChange }) => {
  const { type, size, maxLength, placeholder } = param

  const input = document.createElement('input')

  // Map type to HTML input type
  switch (type) {
    case 'email':
      input.type = 'email'
      break
    case 'url':
      input.type = 'url'
      break
    case 'password':
      input.type = 'password'
      break
    default:
      input.type = 'text'
  }

  input.className = `params-input params-input-${type}`
  input.value = String(value ?? '')

  if (size !== undefined) input.size = size
  if (maxLength !== undefined) input.maxLength = maxLength
  if (placeholder !== undefined) input.placeholder = placeholder

  // ARIA: add label reference
  if (param.label) {
    input.setAttribute('aria-label', param.label)
  }

  input.onchange = () => onChange(input.value)

  return {
    control: input,
    value: null,
    span: true,
    updateValue: (newValue) => { input.value = String(newValue ?? '') }
  }
}

/**
 * Create a date input
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createDateInput = ({ param, value, onChange }) => {
  const { min, max, placeholder } = param

  const input = document.createElement('input')
  input.type = 'date'
  input.className = 'params-input params-input-date'
  input.value = String(value ?? '')

  if (min !== undefined) input.min = String(min)
  if (max !== undefined) input.max = String(max)
  if (placeholder !== undefined) input.placeholder = placeholder

  // ARIA: add label reference
  if (param.label) {
    input.setAttribute('aria-label', param.label)
  }

  input.onchange = () => onChange(input.value)

  return {
    control: null,
    value: input,
    span: false,
    updateValue: (newValue) => { input.value = String(newValue ?? '') }
  }
}

/**
 * Format a value for display with reasonable precision
 * @param {unknown} value
 * @returns {string}
 */
const formatDisplayValue = (value) => {
  if (value == null) return ''
  if (typeof value === 'number') {
    // Use toFixed(2) but trim trailing zeros
    return Number(value.toFixed(2)).toString()
  }
  if (Array.isArray(value)) {
    // Format each element, join with comma
    return '[' + value.map(formatDisplayValue).join(', ') + ']'
  }
  return String(value)
}

/**
 * Create a read-only display for constrained parameters
 * @param {InputOptions} options
 * @returns {InputResult}
 */
const createConstrainedDisplay = ({ param }) => {
  const display = document.createElement('span')
  display.className = 'params-input-constrained-value'
  // Always use param.default for constrained params - that's where the calculated value is stored
  // Format numbers to reasonable precision for display
  const formatted = formatDisplayValue(param.default)
  display.textContent = formatted
  display.title = 'Value set by parent assembly (read-only)'

  // ARIA: mark as readonly output
  display.setAttribute('role', 'status')
  display.setAttribute('aria-readonly', 'true')
  if (param.label) {
    display.setAttribute('aria-label', `${param.label} (read-only)`)
  }

  return {
    control: null,
    value: display,
    span: false,
    updateValue: (newValue) => {
      display.textContent = formatDisplayValue(newValue)
    }
  }
}

/**
 * Input factory - creates the appropriate input for a parameter type
 * @param {InputOptions} options
 * @returns {InputResult}
 */
export const createInput = (options) => {
  const { param } = options
  const { type, constrained } = param

  // Constrained parameters are read-only
  if (constrained) {
    return createConstrainedDisplay(options)
  }

  switch (type) {
    case 'checkbox':
      return createCheckboxInput(options)

    case 'int':
    case 'number':
      return createNumberInput(options)

    case 'slider':
      return createSliderInput(options)

    case 'color':
      return createColorInput(options)

    case 'choice':
      return createChoiceInput(options)

    case 'radio':
      return createRadioInput(options)

    case 'date':
      return createDateInput(options)

    case 'email':
    case 'url':
    case 'password':
    case 'text':
    default:
      return createTextInput(options)
  }
}

/**
 * CSS styles for input components
 */
export const inputStyles = `
/* Base input styles */
.params-input {
  font-family: inherit;
  font-size: 13px;
  box-sizing: border-box;
}

/* Constrained (read-only) parameter display */
.params-input-constrained {
  display: inline-block;
}

.params-input-constrained-value {
  display: inline-block;
  padding: 2px 8px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 13px;
  color: #666;
  font-style: italic;
  cursor: not-allowed;
}

/* Standard input height for consistency */
.params-input-number,
.params-input-text,
.params-input-email,
.params-input-url,
.params-input-password,
.params-input-date,
.params-input-choice {
  height: 24px;
  padding: 2px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  box-sizing: border-box;
  font-size: 13px;
}

/* Checkbox */
.params-input-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  margin: 0;
}

/* Number input */
.params-input-number-container {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.params-input-number {
  width: 90px;
  text-align: right;
}
.params-input-number:focus {
  outline: none;
  border-color: #08f;
}
.params-input-range-hint {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
}

/* Slider input (control column) */
.params-input-slider {
  width: 100%;
  min-width: 80px;
  height: 6px;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background: #ddd;
  border-radius: 3px;
}
.params-input-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #08f;
  border-radius: 50%;
  cursor: pointer;
}
.params-input-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #08f;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

/* Slider number input (value column) */
.params-input-slider-number {
  width: 70px;
  height: 24px;
  padding: 2px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  box-sizing: border-box;
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.params-input-slider-number:focus {
  outline: none;
  border-color: #08f;
}

/* Color input control (swatch button + panel) */
.params-input-color-control {
  display: inline-block;
  position: relative;
}
.params-input-color-btn {
  width: 44px;
  height: 24px;
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 3px;
  cursor: pointer;
  box-sizing: border-box;
}
.params-input-color-btn:hover {
  border-color: #08f;
}

/* Color hex input (value column) */
.params-input-color-hex {
  width: 80px;
  height: 24px;
  padding: 2px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  box-sizing: border-box;
  font-size: 12px;
  font-family: monospace;
  text-transform: uppercase;
}
.params-input-color-hex:focus {
  outline: none;
  border-color: #08f;
}
.params-input-color-panel {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 10px;
  margin-top: 4px;
  width: 200px;
}
.params-input-color-panel--open {
  display: block;
}
.params-input-color-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 4px;
  margin-bottom: 10px;
}
.params-input-color-swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 3px;
  cursor: pointer;
  box-sizing: border-box;
}
.params-input-color-swatch:hover {
  transform: scale(1.15);
  z-index: 1;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}
.params-input-color-swatch--selected {
  border: 2px solid #08f;
  box-shadow: 0 0 0 1px #fff inset;
}
.params-input-color-custom {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}
.params-input-color-custom-label {
  font-size: 0.85em;
  color: #666;
}
.params-input-color-custom-input {
  flex: 1;
  height: 24px;
  padding: 2px;
  border: 1px solid #ccc;
  border-radius: 3px;
  cursor: pointer;
}
.params-input-color-custom-input::-webkit-color-swatch-wrapper {
  padding: 0;
}
.params-input-color-custom-input::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}
.params-input-color-custom-input::-moz-color-swatch {
  border: none;
  border-radius: 2px;
}

/* Choice (select) input */
.params-input-choice {
  min-width: 120px;
  background: #fff;
  cursor: pointer;
}
.params-input-choice:focus {
  outline: none;
  border-color: #08f;
}

/* Radio input */
.params-input-radio-container {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
}
.params-input-radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 3px;
}
.params-input-radio-label:hover {
  background: rgba(0,0,0,0.04);
}
.params-input-radio {
  cursor: pointer;
  margin: 0;
}

/* Text inputs */
.params-input-text,
.params-input-email,
.params-input-url,
.params-input-password {
  width: 150px;
}
.params-input-text:focus,
.params-input-email:focus,
.params-input-url:focus,
.params-input-password:focus {
  outline: none;
  border-color: #08f;
}

/* Date input */
.params-input-date {
  width: 140px;
}
.params-input-date:focus {
  outline: none;
  border-color: #08f;
}
`
