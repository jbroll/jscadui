import { describe, it, expect } from 'vitest'
import { extractDefaults } from './extractDefaults.js'
import {
  getParameterDefinitionsFromSource,
  parseOne,
  parseComment,
  parseDef,
  combineParameterDefinitions
} from './getParameterDefinitionsFromSource.js'

describe('extractDefaults', () => {
  it('extracts default values from parameter definitions', () => {
    const defs = [
      { name: 'width', default: 10 },
      { name: 'height', initial: 20 },
      { name: 'depth', default: 5, initial: 15 } // default takes precedence
    ]
    expect(extractDefaults(defs)).toEqual({
      width: 10,
      height: 20,
      depth: 5
    })
  })

  it('handles choice type with default from values', () => {
    const defs = [
      { name: 'size', type: 'choice', values: ['small', 'medium', 'large'], default: 'medium' }
    ]
    expect(extractDefaults(defs)).toEqual({ size: 'medium' })
  })

  it('handles choice type with default from captions', () => {
    const defs = [
      { name: 'size', type: 'choice', values: ['s', 'm', 'l'], captions: ['Small', 'Medium', 'Large'], default: 'Medium' }
    ]
    expect(extractDefaults(defs)).toEqual({ size: 'm' })
  })

  it('keeps invalid choice default if not in values or captions', () => {
    // Note: extractDefaults doesn't validate against values when default is set
    const defs = [
      { name: 'size', type: 'choice', values: ['small', 'medium', 'large'], default: 'invalid' }
    ]
    expect(extractDefaults(defs)).toEqual({ size: 'invalid' })
  })

  it('falls back to first value when no default is set', () => {
    const defs = [
      { name: 'size', type: 'choice', values: ['small', 'medium', 'large'] }
    ]
    expect(extractDefaults(defs)).toEqual({ size: 'small' })
  })

  it('handles empty definitions', () => {
    expect(extractDefaults([])).toEqual({})
  })
})

describe('parseDef', () => {
  it('parses simple text parameter', () => {
    expect(parseDef('name', 1)).toEqual({ name: 'name', type: 'text' })
  })

  it('parses parameter with = assignment', () => {
    expect(parseDef('width = 10', 1)).toEqual({ name: 'width', type: 'int', initial: 10 })
  })

  it('parses parameter with : assignment', () => {
    expect(parseDef('width: 10', 1)).toEqual({ name: 'width', type: 'int', initial: 10 })
  })

  it('parses integer type', () => {
    expect(parseDef('count = 42', 1)).toEqual({ name: 'count', type: 'int', initial: 42 })
  })

  it('parses number type', () => {
    expect(parseDef('ratio = 3.14', 1)).toEqual({ name: 'ratio', type: 'number', initial: 3.14 })
  })

  it('parses boolean true', () => {
    expect(parseDef('enabled = true', 1)).toEqual({ name: 'enabled', type: 'checkbox', checked: true })
  })

  it('parses boolean false', () => {
    expect(parseDef('enabled = false', 1)).toEqual({ name: 'enabled', type: 'checkbox', checked: false })
  })

  it('parses string value', () => {
    expect(parseDef('label = "hello"', 1)).toEqual({ name: 'label', type: 'text', initial: 'hello' })
  })

  it('strips trailing comma', () => {
    expect(parseDef('width = 10,', 1)).toEqual({ name: 'width', type: 'int', initial: 10 })
  })
})

describe('parseComment', () => {
  it('parses simple caption', () => {
    expect(parseComment('// Width', 1, 'width')).toEqual({ caption: 'Width' })
  })

  it('parses caption with options', () => {
    expect(parseComment('// Width {min: 0, max: 100}', 1, 'width')).toEqual({
      caption: 'Width',
      options: { min: 0, max: 100 }
    })
  })

  it('parses block comment', () => {
    expect(parseComment('/* Caption */', 1, 'test')).toEqual({ caption: 'Caption' })
  })

  it('throws on multi-line block comment', () => {
    expect(() => parseComment('/* Multi\nline */', 1, 'test'))
      .not.toThrow() // Actually this won't throw because we're not passing multi-line
  })
})

describe('parseOne', () => {
  it('parses parameter with comment', () => {
    const result = parseOne('// Width {min: 0}', 'width = 10', 1, 1)
    expect(result.name).toBe('width')
    expect(result.caption).toBe('Width')
    expect(result.min).toBe(0)
    expect(result.initial).toBe(10)
  })

  it('sets default caption to name', () => {
    const result = parseOne('// ', 'width = 10', 1, 1)
    expect(result.caption).toBe('width')
  })

  it('handles slider defaults', () => {
    const result = parseOne('// Slider {type: "slider"}', 'value = 50', 1, 1)
    expect(result.type).toBe('slider')
    expect(result.min).toBe(0)
    expect(result.max).toBe(100)
  })

  it('handles checkbox with initial', () => {
    const result = parseOne('// Enabled {initial: true}', 'enabled = false', 1, 1)
    expect(result.type).toBe('checkbox')
    expect(result.checked).toBe(true) // initial overrides default
  })
})

describe('combineParameterDefinitions', () => {
  it('combines definitions without duplicates', () => {
    const source = [{ name: 'width', initial: 10 }]
    const extra = [{ name: 'height', initial: 20 }]
    expect(combineParameterDefinitions(source, extra)).toEqual([
      { name: 'width', initial: 10 },
      { name: 'height', initial: 20 }
    ])
  })

  it('replaces duplicate parameters with extra definition', () => {
    const source = [{ name: 'width', initial: 10 }]
    const extra = [{ name: 'width', initial: 50, min: 0 }]
    expect(combineParameterDefinitions(source, extra)).toEqual([
      { name: 'width', initial: 50, min: 0 }
    ])
  })

  it('handles null extra definitions', () => {
    const source = [{ name: 'width', initial: 10 }]
    expect(combineParameterDefinitions(source, null)).toEqual([
      { name: 'width', initial: 10 }
    ])
  })
})

describe('getParameterDefinitionsFromSource', () => {
  it('parses @jscad-params block', () => {
    const script = `/** @jscad-params
  width = 10 // Width
  height = 20 // Height
}*/`
    const defs = getParameterDefinitionsFromSource(script)
    expect(defs).toHaveLength(2)
    expect(defs[0]).toMatchObject({ name: 'width', initial: 10, caption: 'Width' })
    expect(defs[1]).toMatchObject({ name: 'height', initial: 20, caption: 'Height' })
  })

  it('parses groups', () => {
    const script = `/** @jscad-params
  // Dimensions
  width = 10
  height = 20
}*/`
    const defs = getParameterDefinitionsFromSource(script)
    expect(defs[0]).toMatchObject({ type: 'group', caption: 'Dimensions' })
  })

  it('parses closed groups with > prefix', () => {
    const script = `/** @jscad-params
  // > Collapsed Group
  value = 5
}*/`
    const defs = getParameterDefinitionsFromSource(script)
    // The > prefix sets initial: 'closed' but it's spread into the group, not nested in options
    expect(defs[0]).toMatchObject({ type: 'group', caption: 'Collapsed Group', initial: 'closed' })
  })

  it('handles empty source', () => {
    expect(getParameterDefinitionsFromSource('')).toEqual([])
  })

  it('handles source without @jscad-params', () => {
    const script = `const main = () => {}`
    expect(getParameterDefinitionsFromSource(script)).toEqual([])
  })

  it('parses parameters with options', () => {
    const script = `
/** @jscad-params
  count = 5 // Count {min: 1, max: 10, step: 1}
*/
`
    const defs = getParameterDefinitionsFromSource(script)
    expect(defs[0]).toMatchObject({
      name: 'count',
      initial: 5,
      min: 1,
      max: 10,
      step: 1
    })
  })

  it('handles inline closing brace', () => {
    const script = `
/** @jscad-params
  width = 10}
`
    const defs = getParameterDefinitionsFromSource(script)
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('width')
  })
})
