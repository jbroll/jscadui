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

describe('createParamsTree collapse state', () => {
  const tree = () => buildParamTree([
    { path: 'part.size', name: 'size', parent: 'part', type: 'number', default: 1 },
    { path: 'part.h', name: 'h', parent: 'part', type: 'number', default: 2 },
  ])

  const make = (options = {}, values = {}) => {
    const target = document.createElement('div')
    const view = createParamsTree({ target, tree: tree(), values, onChange: () => {}, ...options })
    return { target, view }
  }

  it('reports the nodes the user expanded', () => {
    const { target, view } = make()
    expect(view.getExpandedPaths()).toEqual([])
    target.querySelector('.params-tree-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.getExpandedPaths()).toEqual(['part'])
  })

  it('starts with the expanded paths it carries, and collapses the rest', () => {
    const { target, view } = make({ expandedPaths: ['part'] })
    expect(view.getExpandedPaths()).toEqual(['part'])
    expect(target.querySelector('.params-tree-content--collapsed')).toBeNull()
  })

  it('drops a carried path the new tree no longer has', () => {
    const { view } = make({ expandedPaths: ['gone'] })
    expect(view.getExpandedPaths()).toEqual([])
  })

  it('reset restores the code defaults and collapses', () => {
    const { view } = make({ expandedPaths: ['part'] }, { 'part.size': 9, 'part.h': 7 })
    expect(view.reset()).toEqual({ 'part.size': 1, 'part.h': 2 })
    expect(view.getExpandedPaths()).toEqual([])
  })
})
