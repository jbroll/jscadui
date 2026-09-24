/**
 * Convert a Customizer schema to JSCAD parameter definitions
 * (the `getParameterDefinitions()` format, see format-common/parameterDefinition.d.ts).
 *
 * Vectors have no JSCAD equivalent; each component becomes its own definition
 * named `name[i]`, and the transpiled main() reassembles the vector.
 */

import type { CustomizerParameter, CustomizerSchema, CustomizerWidget } from './extract.js'

export interface JscadParameterDefinition {
  name: string
  type: string
  caption?: string
  initial?: unknown
  checked?: boolean
  min?: number
  max?: number
  step?: number
  values?: unknown[]
  captions?: string[]
  maxLength?: number
}

/** Definition name for component `index` of vector parameter `name` */
export const vectorComponentName = (name: string, index: number): string => `${name}[${index}]`

export function toJscadParameterDefinitions(schema: CustomizerSchema): JscadParameterDefinition[] {
  const defs: JscadParameterDefinition[] = []
  let group: string | undefined

  for (const param of schema.parameters) {
    if (param.group !== group) {
      group = param.group
      defs.push({ name: `_group_${defs.length}`, type: 'group', caption: group })
    }
    const caption = param.description ?? param.name

    if (param.type === 'vector') {
      const values = param.default as number[]
      values.forEach((v, i) => {
        defs.push(numberDefinition(vectorComponentName(param.name, i), `${caption} [${i}]`, v, param.widget))
      })
    } else if (param.type === 'boolean') {
      defs.push({ name: param.name, type: 'checkbox', caption, checked: param.default as boolean, initial: param.default })
    } else if (param.widget.kind === 'dropdown') {
      const { options } = param.widget
      const def: JscadParameterDefinition = {
        name: param.name,
        type: 'choice',
        caption,
        values: options.map(o => o.value),
        initial: param.default,
      }
      if (options.some(o => o.label !== undefined)) {
        def.captions = options.map(o => o.label ?? String(o.value))
      }
      defs.push(def)
    } else if (param.type === 'number') {
      defs.push(numberDefinition(param.name, caption, param.default as number, param.widget))
    } else {
      const def: JscadParameterDefinition = { name: param.name, type: 'text', caption, initial: param.default }
      if (param.widget.kind === 'text' && param.widget.maxLength !== undefined) def.maxLength = param.widget.maxLength
      defs.push(def)
    }
  }
  return defs
}

function numberDefinition(name: string, caption: string, value: number, widget: CustomizerWidget): JscadParameterDefinition {
  if (widget.kind === 'slider') {
    return {
      name,
      type: 'slider',
      caption,
      initial: value,
      min: widget.min,
      max: widget.max,
      step: widget.step ?? defaultStep(value, widget.min, widget.max),
    }
  }
  const step = widget.kind === 'spinbox' && widget.step !== undefined ? widget.step : defaultStep(value)
  return { name, type: 'number', caption, initial: value, step }
}

/** Step derived from the most decimal places among the given numbers (1 for integers) */
function defaultStep(...values: number[]): number {
  const decimals = Math.max(0, ...values.map(v => {
    const s = String(v)
    if (s.includes('e')) return 0
    const dot = s.indexOf('.')
    return dot < 0 ? 0 : s.length - dot - 1
  }))
  return decimals === 0 ? 1 : Number((10 ** -decimals).toFixed(decimals))
}

export type { CustomizerParameter }
