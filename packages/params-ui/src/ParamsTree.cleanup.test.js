import { describe, it, expect } from 'vitest'
import { createParamsTree } from './ParamsTree.js'

const tree = (extraParams = []) => ({
  path: '',
  params: [
    { path: 'tint', name: 'tint', type: 'color', default: '#ff0000' },
    { path: '_class', name: '_class', type: 'text', default: 'a' },
    ...extraParams,
  ],
  children: {},
})

const view = (target, t = tree()) => createParamsTree({
  target,
  tree: t,
  values: { tint: '#ff0000', _class: 'a' },
  types: new Map(),
  classes: new Map(),
  codeClasses: new Map(),
  onChange: () => {},
})

const spyOnDocumentListeners = () => {
  const added = []
  const removed = []
  const rawAdd = document.addEventListener.bind(document)
  const rawRemove = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    added.push([type, listener])
    rawAdd(type, listener, options)
  }
  document.removeEventListener = (type, listener, options) => {
    removed.push([type, listener])
    rawRemove(type, listener, options)
  }
  return { added, removed, restore: () => { document.addEventListener = rawAdd; document.removeEventListener = rawRemove } }
}

describe('params tree document listeners', () => {
  it('removes color and class listeners on re-render instead of accumulating them', () => {
    const { added, removed, restore } = spyOnDocumentListeners()
    try {
      const target = document.createElement('div')
      document.body.appendChild(target)
      const treeView = view(target)
      expect(added.length).toBe(4)

      treeView.update({ tree: tree([{ path: 'extra', name: 'extra', type: 'checkbox', default: false }]) })
      expect(added.length).toBe(8)
      expect(removed.length).toBe(4)
      for (const entry of removed) {
        expect(added).toContainEqual(entry)
      }
      treeView.destroy()
      expect(removed.length).toBe(8)
    } finally {
      restore()
    }
  })

  it('leaves no listeners behind after destroy', () => {
    const { added, removed, restore } = spyOnDocumentListeners()
    try {
      const target = document.createElement('div')
      document.body.appendChild(target)
      view(target).destroy()
      expect(removed.length).toBe(added.length)
      expect(added.length).toBe(4)
    } finally {
      restore()
    }
  })
})
