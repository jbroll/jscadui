import { describe, expect, it } from 'vitest'
import { checksClean, notSavedNotice, withSaveState } from '../src/saveState.js'

const CLEAN = { ok: true, empty: false, watertight: true, manifold: true, insideOut: false, selfIntersecting: false }

describe('save state', () => {
  it('says nothing about a saved model', () => {
    expect(withSaveState({ ok: true }, false, { evals: 3, clean: true })).toEqual({ ok: true })
  })

  it('counts the evals since the last save', () => {
    expect(notSavedNotice({ evals: 1 })).toBe('not saved (1 eval since the last save); call writeModel to keep it')
    expect(withSaveState({ ok: true }, true, { evals: 3 }).notSaved).toBe('not saved (3 evals since the last save); call writeModel to keep it')
    expect(notSavedNotice()).toBe('not saved; call writeModel to keep it')
  })

  it('tells the model to save now when a check comes back clean', () => {
    expect(notSavedNotice({ evals: 2, clean: true })).toBe('checks clean and not saved (2 evals since the last save): save it now with writeModel, then refine')
  })

  it('reads a check clean only when nothing is wrong with the solid', () => {
    expect(checksClean(CLEAN)).toBe(true)
    expect(checksClean({ ...CLEAN, selfIntersecting: null })).toBe(true)
    expect(checksClean({ ...CLEAN, fitsBed: true })).toBe(true)
    for (const bad of [{ watertight: false }, { manifold: false }, { insideOut: true }, { selfIntersecting: true }, { fitsBed: false }, { empty: true }, { ok: false }]) {
      expect(checksClean({ ...CLEAN, ...bad })).toBe(false)
    }
    expect(checksClean({ ok: true, empty: false, closed: true, watertight: null, manifold: null })).toBe(false)
  })
})
