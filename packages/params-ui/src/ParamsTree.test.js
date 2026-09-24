/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { buildParamTree } from '@jscadui/params-core'
import { createParamsTree } from './ParamsTree.js'

describe('createParamsTree group headings', () => {
  it('renders a heading where the group label changes', () => {
    const discovered = [
      { path: 'loose', name: 'loose', parent: '', type: 'number', default: 1 },
      { path: 'w', name: 'w', parent: '', type: 'number', default: 5, group: 'Size' },
      { path: 'h', name: 'h', parent: '', type: 'number', default: 6, group: 'Size' },
      { path: 'round', name: 'round', parent: '', type: 'checkbox', default: true, group: 'Style' },
    ]
    const target = document.createElement('div')
    createParamsTree({ target, tree: buildParamTree(discovered), values: {}, onChange: () => {} })

    const order = [...target.querySelectorAll('.params-tree-group, .params-tree-param')]
      .map(el => el.classList.contains('params-tree-group') ? `[${el.textContent}]` : 'param')
    expect(order).toEqual(['param', '[Size]', 'param', 'param', '[Style]', 'param'])
  })
})
