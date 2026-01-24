import { describe, it, expect, vi } from 'vitest'
import {
  createInput,
  createCheckboxInput,
  createNumberInput,
  createSliderInput,
  createColorInput,
  createChoiceInput,
  createRadioInput,
  createTextInput,
  createDateInput,
  inputStyles,
} from './inputs.js'

describe('createCheckboxInput', () => {
  it('creates a checkbox input element', () => {
    const onChange = vi.fn()
    const result = createCheckboxInput({
      param: { path: 'test.enabled', name: 'enabled', type: 'checkbox' },
      value: true,
      onChange
    })

    expect(result.control).toBeNull()
    expect(result.value.tagName).toBe('INPUT')
    expect(result.value.type).toBe('checkbox')
    expect(result.value.checked).toBe(true)
    expect(result.value.className).toContain('params-input-checkbox')
    expect(result.span).toBe(false)
  })

  it('calls onChange when checkbox is toggled', () => {
    const onChange = vi.fn()
    const result = createCheckboxInput({
      param: { path: 'test.enabled', name: 'enabled', type: 'checkbox' },
      value: false,
      onChange
    })

    result.value.checked = true
    result.value.onchange()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('provides updateValue method', () => {
    const onChange = vi.fn()
    const result = createCheckboxInput({
      param: { path: 'test.enabled', name: 'enabled', type: 'checkbox' },
      value: false,
      onChange
    })

    result.updateValue(true)
    expect(result.value.checked).toBe(true)
  })
})

describe('createNumberInput', () => {
  it('creates a number input with container', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.count', name: 'count', type: 'number' },
      value: 42,
      onChange
    })

    expect(result.control).toBeNull()
    expect(result.value.className).toContain('params-input-number-container')
    const input = result.value.querySelector('input')
    expect(input.type).toBe('number')
    expect(input.value).toBe('42')
    expect(result.span).toBe(false)
  })

  it('respects min/max/step', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number', min: 0, max: 100, step: 0.5 },
      value: 50,
      onChange
    })

    const input = result.value.querySelector('input')
    expect(input.min).toBe('0')
    expect(input.max).toBe('100')
    expect(input.step).toBe('0.5')
  })

  it('shows range hint when min/max defined', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number', min: 0, max: 100 },
      value: 50,
      onChange
    })

    const hint = result.value.querySelector('.params-input-range-hint')
    expect(hint).not.toBeNull()
    expect(hint.textContent).toBe('[0-100]')
  })

  it('uses step=1 for int type', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.n', name: 'n', type: 'int' },
      value: 5,
      onChange
    })

    const input = result.value.querySelector('input')
    expect(input.step).toBe('1')
  })

  it('calls onChange with parsed number', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number' },
      value: 10,
      onChange
    })

    const input = result.value.querySelector('input')
    input.value = '25.5'
    input.oninput()
    expect(onChange).toHaveBeenCalledWith(25.5)
  })

  it('calls onChange with parsed int for int type', () => {
    const onChange = vi.fn()
    const result = createNumberInput({
      param: { path: 'test.n', name: 'n', type: 'int' },
      value: 10,
      onChange
    })

    const input = result.value.querySelector('input')
    input.value = '25'
    input.oninput()
    expect(onChange).toHaveBeenCalledWith(25)
  })
})

describe('createSliderInput', () => {
  it('creates a slider with number input', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider', min: 0, max: 100 },
      value: 50,
      onChange
    })

    // Control is the slider
    expect(result.control.type).toBe('range')
    expect(result.control.value).toBe('50')
    expect(result.control.min).toBe('0')
    expect(result.control.max).toBe('100')

    // Value is the number input
    expect(result.value.type).toBe('number')
    expect(result.value.value).toBe('50')

    expect(result.span).toBe(false)
  })

  it('syncs slider to number input on drag', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    result.control.value = '75'
    result.control.oninput()

    expect(result.value.value).toBe('75')
  })

  it('syncs number input to slider on type', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    result.value.value = '25'
    result.value.oninput()

    expect(result.control.value).toBe('25')
  })

  it('calls onChange when live=true (default)', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    result.control.value = '75'
    result.control.oninput()

    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('does not call onChange during drag when live=false', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider', live: false },
      value: 50,
      onChange
    })

    result.control.value = '75'
    result.control.oninput()

    expect(onChange).not.toHaveBeenCalled()

    // But calls on change (mouse release)
    result.control.onchange()
    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('provides updateValue method', () => {
    const onChange = vi.fn()
    const result = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    result.updateValue(75)
    expect(result.control.value).toBe('75')
    expect(result.value.value).toBe('75')
  })
})

describe('createColorInput', () => {
  it('creates a color picker with button and hex input', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    // Control contains swatch button and panel
    expect(result.control.className).toContain('params-input-color-control')

    // Color button shows current color
    const colorBtn = result.control.querySelector('.params-input-color-btn')
    expect(colorBtn).not.toBeNull()
    expect(colorBtn.style.backgroundColor).toBe('rgb(255, 0, 0)')

    // Value is hex input
    expect(result.value.className).toContain('params-input-color-hex')
    expect(result.value.value).toBe('#FF0000')

    // Hidden panel with palette
    const panel = result.control.querySelector('.params-input-color-panel')
    expect(panel).not.toBeNull()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(false)

    expect(result.span).toBe(false)
  })

  it('shows palette with color swatches', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const swatches = result.control.querySelectorAll('.params-input-color-swatch')
    expect(swatches.length).toBeGreaterThan(0)
  })

  it('allows custom palette', () => {
    const onChange = vi.fn()
    const customPalette = ['#111', '#222', '#333']
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color', palette: customPalette },
      value: '#111',
      onChange
    })

    const swatches = result.control.querySelectorAll('.params-input-color-swatch')
    expect(swatches.length).toBe(3)
  })

  it('calls onChange when swatch is clicked', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const swatches = result.control.querySelectorAll('.params-input-color-swatch')
    swatches[0].click()

    expect(onChange).toHaveBeenCalled()
  })

  it('updates via custom color input', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const customInput = result.control.querySelector('.params-input-color-custom-input')
    customInput.value = '#00ff00'
    customInput.oninput()

    expect(onChange).toHaveBeenCalledWith('#00ff00')
  })

  it('opens panel on button click', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const colorBtn = result.control.querySelector('.params-input-color-btn')
    const panel = result.control.querySelector('.params-input-color-panel')

    colorBtn.click()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(true)

    colorBtn.click()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(false)
  })

  it('provides updateValue method', () => {
    const onChange = vi.fn()
    const result = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    result.updateValue('#00ff00')
    const colorBtn = result.control.querySelector('.params-input-color-btn')
    expect(colorBtn.style.backgroundColor).toBe('rgb(0, 255, 0)')
    expect(result.value.value).toBe('#00FF00')
  })
})

describe('createChoiceInput', () => {
  it('creates a select with options', () => {
    const onChange = vi.fn()
    const result = createChoiceInput({
      param: {
        path: 'test.size',
        name: 'size',
        type: 'choice',
        values: ['small', 'medium', 'large'],
        captions: ['Small', 'Medium', 'Large']
      },
      value: 'medium',
      onChange
    })

    expect(result.control).toBeNull()
    expect(result.value.tagName).toBe('SELECT')
    expect(result.value.options.length).toBe(3)
    expect(result.value.options[1].value).toBe('medium')
    expect(result.value.options[1].textContent).toBe('Medium')
    expect(result.value.options[1].selected).toBe(true)
    expect(result.span).toBe(false)
  })

  it('uses values as captions if no captions provided', () => {
    const onChange = vi.fn()
    const result = createChoiceInput({
      param: {
        path: 'test.size',
        name: 'size',
        type: 'choice',
        values: ['small', 'medium', 'large']
      },
      value: 'small',
      onChange
    })

    expect(result.value.options[0].textContent).toBe('small')
  })

  it('preserves numeric values', () => {
    const onChange = vi.fn()
    const result = createChoiceInput({
      param: {
        path: 'test.count',
        name: 'count',
        type: 'choice',
        values: [1, 2, 3]
      },
      value: 2,
      onChange
    })

    result.value.value = '3'
    result.value.onchange()
    expect(onChange).toHaveBeenCalledWith(3) // Number, not string
  })
})

describe('createRadioInput', () => {
  it('creates radio buttons for each value', () => {
    const onChange = vi.fn()
    const result = createRadioInput({
      param: {
        path: 'test.shape',
        name: 'shape',
        type: 'radio',
        values: ['circle', 'square', 'triangle']
      },
      value: 'square',
      onChange
    })

    // Radio spans both columns
    expect(result.control.className).toContain('params-input-radio-container')
    expect(result.value).toBeNull()
    expect(result.span).toBe(true)

    const radios = result.control.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    expect(radios[1].checked).toBe(true)
    expect(radios[1].value).toBe('square')
  })

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn()
    const result = createRadioInput({
      param: {
        path: 'test.shape',
        name: 'shape',
        type: 'radio',
        values: ['circle', 'square', 'triangle']
      },
      value: 'circle',
      onChange
    })

    const radios = result.control.querySelectorAll('input[type="radio"]')
    radios[2].checked = true
    radios[2].onchange()

    expect(onChange).toHaveBeenCalledWith('triangle')
  })
})

describe('createTextInput', () => {
  it('creates a text input', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.name', name: 'name', type: 'text' },
      value: 'hello',
      onChange
    })

    // Text spans both columns
    expect(result.control.tagName).toBe('INPUT')
    expect(result.control.type).toBe('text')
    expect(result.control.value).toBe('hello')
    expect(result.value).toBeNull()
    expect(result.span).toBe(true)
  })

  it('supports email type', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.email', name: 'email', type: 'email' },
      value: 'test@example.com',
      onChange
    })

    expect(result.control.type).toBe('email')
  })

  it('supports url type', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.website', name: 'website', type: 'url' },
      value: 'https://example.com',
      onChange
    })

    expect(result.control.type).toBe('url')
  })

  it('supports password type', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.secret', name: 'secret', type: 'password' },
      value: 'secret123',
      onChange
    })

    expect(result.control.type).toBe('password')
  })

  it('respects size and maxLength', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.code', name: 'code', type: 'text', size: 5, maxLength: 10 },
      value: '',
      onChange
    })

    expect(result.control.size).toBe(5)
    expect(result.control.maxLength).toBe(10)
  })

  it('respects placeholder', () => {
    const onChange = vi.fn()
    const result = createTextInput({
      param: { path: 'test.name', name: 'name', type: 'text', placeholder: 'Enter name' },
      value: '',
      onChange
    })

    expect(result.control.placeholder).toBe('Enter name')
  })
})

describe('createDateInput', () => {
  it('creates a date input', () => {
    const onChange = vi.fn()
    const result = createDateInput({
      param: { path: 'test.date', name: 'date', type: 'date' },
      value: '2024-01-15',
      onChange
    })

    expect(result.control).toBeNull()
    expect(result.value.tagName).toBe('INPUT')
    expect(result.value.type).toBe('date')
    expect(result.value.value).toBe('2024-01-15')
    expect(result.span).toBe(false)
  })

  it('respects min/max dates', () => {
    const onChange = vi.fn()
    const result = createDateInput({
      param: { path: 'test.date', name: 'date', type: 'date', min: '2024-01-01', max: '2024-12-31' },
      value: '2024-06-15',
      onChange
    })

    expect(result.value.min).toBe('2024-01-01')
    expect(result.value.max).toBe('2024-12-31')
  })
})

describe('createInput factory', () => {
  it('creates checkbox for checkbox type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'checkbox' },
      value: true,
      onChange: vi.fn()
    })
    expect(result.value.type).toBe('checkbox')
  })

  it('creates number input for number type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'number' },
      value: 10,
      onChange: vi.fn()
    })
    expect(result.value.className).toContain('params-input-number-container')
  })

  it('creates number input for int type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'int' },
      value: 10,
      onChange: vi.fn()
    })
    const input = result.value.querySelector('input')
    expect(input.step).toBe('1')
  })

  it('creates slider for slider type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'slider' },
      value: 50,
      onChange: vi.fn()
    })
    expect(result.control.type).toBe('range')
    expect(result.value.type).toBe('number')
  })

  it('creates color picker for color type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'color' },
      value: '#ff0000',
      onChange: vi.fn()
    })
    expect(result.control.querySelector('input[type="color"]')).not.toBeNull()
  })

  it('creates select for choice type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'choice', values: ['a', 'b'] },
      value: 'a',
      onChange: vi.fn()
    })
    expect(result.value.tagName).toBe('SELECT')
  })

  it('creates radios for radio type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'radio', values: ['a', 'b'] },
      value: 'a',
      onChange: vi.fn()
    })
    expect(result.control.querySelectorAll('input[type="radio"]').length).toBe(2)
    expect(result.span).toBe(true)
  })

  it('creates date input for date type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'date' },
      value: '2024-01-15',
      onChange: vi.fn()
    })
    expect(result.value.type).toBe('date')
  })

  it('creates text input for email type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'email' },
      value: 'test@example.com',
      onChange: vi.fn()
    })
    expect(result.control.type).toBe('email')
    expect(result.span).toBe(true)
  })

  it('creates text input for unknown type', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'unknown' },
      value: 'test',
      onChange: vi.fn()
    })
    expect(result.control.type).toBe('text')
    expect(result.span).toBe(true)
  })
})

describe('constrained parameter display', () => {
  it('creates read-only display for constrained params', () => {
    const result = createInput({
      param: { path: 'test.shelfHeight', name: 'shelfHeight', type: 'slider', constrained: true, default: 5.85 },
      value: 5.85,
      onChange: vi.fn()
    })

    expect(result.control).toBeNull()
    expect(result.value.className).toContain('params-input-constrained-value')
    expect(result.value.textContent).toBe('5.85')
    expect(result.span).toBe(false)
  })

  it('formats numbers to 2 decimal places', () => {
    const result = createInput({
      param: { path: 'test.value', name: 'value', type: 'number', constrained: true, default: 3.14159 },
      value: 3.14159,
      onChange: vi.fn()
    })

    expect(result.value.textContent).toBe('3.14')
  })

  it('handles integer values', () => {
    const result = createInput({
      param: { path: 'test.count', name: 'count', type: 'int', constrained: true, default: 42 },
      value: 42,
      onChange: vi.fn()
    })

    expect(result.value.textContent).toBe('42.00')
  })

  it('handles string values', () => {
    const result = createInput({
      param: { path: 'test.name', name: 'name', type: 'text', constrained: true, default: 'fixed' },
      value: 'fixed',
      onChange: vi.fn()
    })

    expect(result.value.textContent).toBe('fixed')
  })

  it('provides updateValue method for dynamic updates', () => {
    const result = createInput({
      param: { path: 'test.value', name: 'value', type: 'number', constrained: true, default: 5.85 },
      value: 5.85,
      onChange: vi.fn()
    })

    expect(result.updateValue).toBeDefined()
    result.updateValue(9.85)

    expect(result.value.textContent).toBe('9.85')
  })

  it('uses param.default for display, not value', () => {
    // When constrained, param.default contains the calculated value
    // value might be stale
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'number', constrained: true, default: 10.5 },
      value: 5.0,  // stale value
      onChange: vi.fn()
    })

    expect(result.value.textContent).toBe('10.50')  // uses param.default
  })

  it('returns slider for non-constrained slider param', () => {
    const result = createInput({
      param: { path: 'test.x', name: 'x', type: 'slider', default: 50, min: 0, max: 100 },
      value: 50,
      onChange: vi.fn()
    })

    // Should be a slider, not constrained display
    expect(result.control.type).toBe('range')
    expect(result.value.type).toBe('number')
  })
})

describe('inputStyles', () => {
  it('exports CSS styles string', () => {
    expect(typeof inputStyles).toBe('string')
    expect(inputStyles).toContain('.params-input')
    expect(inputStyles).toContain('.params-input-checkbox')
    expect(inputStyles).toContain('.params-input-number')
    expect(inputStyles).toContain('.params-input-slider')
    expect(inputStyles).toContain('.params-input-color')
    expect(inputStyles).toContain('.params-input-choice')
    expect(inputStyles).toContain('.params-input-radio')
    expect(inputStyles).toContain('.params-input-date')
  })

  it('includes constrained parameter styles', () => {
    expect(inputStyles).toContain('.params-input-constrained')
    expect(inputStyles).toContain('.params-input-constrained-value')
  })
})
