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
    const el = createCheckboxInput({
      param: { path: 'test.enabled', name: 'enabled', type: 'checkbox' },
      value: true,
      onChange
    })

    expect(el.tagName).toBe('INPUT')
    expect(el.type).toBe('checkbox')
    expect(el.checked).toBe(true)
    expect(el.className).toContain('params-input-checkbox')
  })

  it('calls onChange when checkbox is toggled', () => {
    const onChange = vi.fn()
    const el = createCheckboxInput({
      param: { path: 'test.enabled', name: 'enabled', type: 'checkbox' },
      value: false,
      onChange
    })

    el.checked = true
    el.onchange()
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('createNumberInput', () => {
  it('creates a number input with container', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.count', name: 'count', type: 'number' },
      value: 42,
      onChange
    })

    expect(el.className).toContain('params-input-number-container')
    const input = el.querySelector('input')
    expect(input.type).toBe('number')
    expect(input.value).toBe('42')
  })

  it('respects min/max/step', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number', min: 0, max: 100, step: 0.5 },
      value: 50,
      onChange
    })

    const input = el.querySelector('input')
    expect(input.min).toBe('0')
    expect(input.max).toBe('100')
    expect(input.step).toBe('0.5')
  })

  it('shows range hint when min/max defined', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number', min: 0, max: 100 },
      value: 50,
      onChange
    })

    const hint = el.querySelector('.params-input-range-hint')
    expect(hint).not.toBeNull()
    expect(hint.textContent).toBe('[0-100]')
  })

  it('uses step=1 for int type', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.n', name: 'n', type: 'int' },
      value: 5,
      onChange
    })

    const input = el.querySelector('input')
    expect(input.step).toBe('1')
  })

  it('calls onChange with parsed number', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.x', name: 'x', type: 'number' },
      value: 10,
      onChange
    })

    const input = el.querySelector('input')
    input.value = '25.5'
    input.oninput()
    expect(onChange).toHaveBeenCalledWith(25.5)
  })

  it('calls onChange with parsed int for int type', () => {
    const onChange = vi.fn()
    const el = createNumberInput({
      param: { path: 'test.n', name: 'n', type: 'int' },
      value: 10,
      onChange
    })

    const input = el.querySelector('input')
    input.value = '25'
    input.oninput()
    expect(onChange).toHaveBeenCalledWith(25)
  })
})

describe('createSliderInput', () => {
  it('creates a slider with display', () => {
    const onChange = vi.fn()
    const el = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider', min: 0, max: 100 },
      value: 50,
      onChange
    })

    expect(el.className).toContain('params-input-slider-container')
    const slider = el.querySelector('input[type="range"]')
    expect(slider).not.toBeNull()
    expect(slider.value).toBe('50')
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')

    const display = el.querySelector('.params-input-slider-value')
    expect(display.textContent).toBe('50')
  })

  it('updates display on input', () => {
    const onChange = vi.fn()
    const el = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    const slider = el.querySelector('input[type="range"]')
    const display = el.querySelector('.params-input-slider-value')

    slider.value = '75'
    slider.oninput()

    expect(display.textContent).toBe('75')
  })

  it('calls onChange when live=true (default)', () => {
    const onChange = vi.fn()
    const el = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider' },
      value: 50,
      onChange
    })

    const slider = el.querySelector('input[type="range"]')
    slider.value = '75'
    slider.oninput()

    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('does not call onChange during drag when live=false', () => {
    const onChange = vi.fn()
    const el = createSliderInput({
      param: { path: 'test.volume', name: 'volume', type: 'slider', live: false },
      value: 50,
      onChange
    })

    const slider = el.querySelector('input[type="range"]')
    slider.value = '75'
    slider.oninput()

    expect(onChange).not.toHaveBeenCalled()

    // But calls on change (mouse release)
    slider.onchange()
    expect(onChange).toHaveBeenCalledWith(75)
  })
})

describe('createColorInput', () => {
  it('creates a color picker with button and hex display', () => {
    const onChange = vi.fn()
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    expect(el.className).toContain('params-input-color-container')

    // Color button shows current color
    const colorBtn = el.querySelector('.params-input-color-btn')
    expect(colorBtn).not.toBeNull()
    expect(colorBtn.style.backgroundColor).toBe('rgb(255, 0, 0)')

    // Hex value display
    const display = el.querySelector('.params-input-color-value')
    expect(display.textContent).toBe('#ff0000')

    // Hidden panel with palette
    const panel = el.querySelector('.params-input-color-panel')
    expect(panel).not.toBeNull()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(false)
  })

  it('shows palette with color swatches', () => {
    const onChange = vi.fn()
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const swatches = el.querySelectorAll('.params-input-color-swatch')
    expect(swatches.length).toBeGreaterThan(0)
  })

  it('allows custom palette', () => {
    const onChange = vi.fn()
    const customPalette = ['#111', '#222', '#333']
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color', palette: customPalette },
      value: '#111',
      onChange
    })

    const swatches = el.querySelectorAll('.params-input-color-swatch')
    expect(swatches.length).toBe(3)
  })

  it('calls onChange when swatch is clicked', () => {
    const onChange = vi.fn()
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const swatches = el.querySelectorAll('.params-input-color-swatch')
    swatches[0].click()

    expect(onChange).toHaveBeenCalled()
  })

  it('updates via custom color input', () => {
    const onChange = vi.fn()
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const customInput = el.querySelector('.params-input-color-custom-input')
    customInput.value = '#00ff00'
    customInput.oninput()

    expect(onChange).toHaveBeenCalledWith('#00ff00')
  })

  it('opens panel on button click', () => {
    const onChange = vi.fn()
    const el = createColorInput({
      param: { path: 'test.color', name: 'color', type: 'color' },
      value: '#ff0000',
      onChange
    })

    const colorBtn = el.querySelector('.params-input-color-btn')
    const panel = el.querySelector('.params-input-color-panel')

    colorBtn.click()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(true)

    colorBtn.click()
    expect(panel.classList.contains('params-input-color-panel--open')).toBe(false)
  })
})

describe('createChoiceInput', () => {
  it('creates a select with options', () => {
    const onChange = vi.fn()
    const el = createChoiceInput({
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

    expect(el.tagName).toBe('SELECT')
    expect(el.options.length).toBe(3)
    expect(el.options[1].value).toBe('medium')
    expect(el.options[1].textContent).toBe('Medium')
    expect(el.options[1].selected).toBe(true)
  })

  it('uses values as captions if no captions provided', () => {
    const onChange = vi.fn()
    const el = createChoiceInput({
      param: {
        path: 'test.size',
        name: 'size',
        type: 'choice',
        values: ['small', 'medium', 'large']
      },
      value: 'small',
      onChange
    })

    expect(el.options[0].textContent).toBe('small')
  })

  it('preserves numeric values', () => {
    const onChange = vi.fn()
    const el = createChoiceInput({
      param: {
        path: 'test.count',
        name: 'count',
        type: 'choice',
        values: [1, 2, 3]
      },
      value: 2,
      onChange
    })

    el.value = '3'
    el.onchange()
    expect(onChange).toHaveBeenCalledWith(3) // Number, not string
  })
})

describe('createRadioInput', () => {
  it('creates radio buttons for each value', () => {
    const onChange = vi.fn()
    const el = createRadioInput({
      param: {
        path: 'test.shape',
        name: 'shape',
        type: 'radio',
        values: ['circle', 'square', 'triangle']
      },
      value: 'square',
      onChange
    })

    expect(el.className).toContain('params-input-radio-container')
    const radios = el.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    expect(radios[1].checked).toBe(true)
    expect(radios[1].value).toBe('square')
  })

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn()
    const el = createRadioInput({
      param: {
        path: 'test.shape',
        name: 'shape',
        type: 'radio',
        values: ['circle', 'square', 'triangle']
      },
      value: 'circle',
      onChange
    })

    const radios = el.querySelectorAll('input[type="radio"]')
    radios[2].checked = true
    radios[2].onchange()

    expect(onChange).toHaveBeenCalledWith('triangle')
  })
})

describe('createTextInput', () => {
  it('creates a text input', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.name', name: 'name', type: 'text' },
      value: 'hello',
      onChange
    })

    expect(el.tagName).toBe('INPUT')
    expect(el.type).toBe('text')
    expect(el.value).toBe('hello')
  })

  it('supports email type', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.email', name: 'email', type: 'email' },
      value: 'test@example.com',
      onChange
    })

    expect(el.type).toBe('email')
  })

  it('supports url type', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.website', name: 'website', type: 'url' },
      value: 'https://example.com',
      onChange
    })

    expect(el.type).toBe('url')
  })

  it('supports password type', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.secret', name: 'secret', type: 'password' },
      value: 'secret123',
      onChange
    })

    expect(el.type).toBe('password')
  })

  it('respects size and maxLength', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.code', name: 'code', type: 'text', size: 5, maxLength: 10 },
      value: '',
      onChange
    })

    expect(el.size).toBe(5)
    expect(el.maxLength).toBe(10)
  })

  it('respects placeholder', () => {
    const onChange = vi.fn()
    const el = createTextInput({
      param: { path: 'test.name', name: 'name', type: 'text', placeholder: 'Enter name' },
      value: '',
      onChange
    })

    expect(el.placeholder).toBe('Enter name')
  })
})

describe('createDateInput', () => {
  it('creates a date input', () => {
    const onChange = vi.fn()
    const el = createDateInput({
      param: { path: 'test.date', name: 'date', type: 'date' },
      value: '2024-01-15',
      onChange
    })

    expect(el.tagName).toBe('INPUT')
    expect(el.type).toBe('date')
    expect(el.value).toBe('2024-01-15')
  })

  it('respects min/max dates', () => {
    const onChange = vi.fn()
    const el = createDateInput({
      param: { path: 'test.date', name: 'date', type: 'date', min: '2024-01-01', max: '2024-12-31' },
      value: '2024-06-15',
      onChange
    })

    expect(el.min).toBe('2024-01-01')
    expect(el.max).toBe('2024-12-31')
  })
})

describe('createInput factory', () => {
  it('creates checkbox for checkbox type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'checkbox' },
      value: true,
      onChange: vi.fn()
    })
    expect(el.type).toBe('checkbox')
  })

  it('creates number input for number type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'number' },
      value: 10,
      onChange: vi.fn()
    })
    expect(el.className).toContain('params-input-number-container')
  })

  it('creates number input for int type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'int' },
      value: 10,
      onChange: vi.fn()
    })
    const input = el.querySelector('input')
    expect(input.step).toBe('1')
  })

  it('creates slider for slider type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'slider' },
      value: 50,
      onChange: vi.fn()
    })
    expect(el.className).toContain('params-input-slider-container')
  })

  it('creates color picker for color type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'color' },
      value: '#ff0000',
      onChange: vi.fn()
    })
    expect(el.querySelector('input[type="color"]')).not.toBeNull()
  })

  it('creates select for choice type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'choice', values: ['a', 'b'] },
      value: 'a',
      onChange: vi.fn()
    })
    expect(el.tagName).toBe('SELECT')
  })

  it('creates radios for radio type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'radio', values: ['a', 'b'] },
      value: 'a',
      onChange: vi.fn()
    })
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(2)
  })

  it('creates date input for date type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'date' },
      value: '2024-01-15',
      onChange: vi.fn()
    })
    expect(el.type).toBe('date')
  })

  it('creates text input for email type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'email' },
      value: 'test@example.com',
      onChange: vi.fn()
    })
    expect(el.type).toBe('email')
  })

  it('creates text input for unknown type', () => {
    const el = createInput({
      param: { path: 'test.x', name: 'x', type: 'unknown' },
      value: 'test',
      onChange: vi.fn()
    })
    expect(el.type).toBe('text')
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
})
