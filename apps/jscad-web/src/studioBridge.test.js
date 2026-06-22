import { afterEach, expect, test, vi } from 'vitest'
import { installStudioBridge } from './studioBridge.js'

afterEach(() => { delete globalThis.jscadStudio })

const makeCtrl = () => {
  const params = { size: 10, depth: 4 }
  return {
    setParam: vi.fn((path, value) => { params[path] = value; return [path] }),
    getState: () => ({ params: { ...params } }),
    _params: params,
  }
}

test('installs window.jscadStudio with ready flag and getParams', () => {
  const ctrl = makeCtrl()
  installStudioBridge({ paramsCtrl: ctrl, runModel: vi.fn(async () => {}), getParams: () => ctrl.getState().params })
  expect(globalThis.jscadStudio.ready).toBe(true)
  expect(globalThis.jscadStudio.getParams()).toEqual({ size: 10, depth: 4 })
})

test('setParams applies each entry via setParam then runs ONE model update', async () => {
  const ctrl = makeCtrl()
  const runModel = vi.fn(async () => {})
  installStudioBridge({ paramsCtrl: ctrl, runModel, getParams: () => ctrl.getState().params })
  const result = await globalThis.jscadStudio.setParams({ size: 25, depth: 8 })
  expect(ctrl.setParam).toHaveBeenCalledWith('size', 25)
  expect(ctrl.setParam).toHaveBeenCalledWith('depth', 8)
  expect(runModel).toHaveBeenCalledTimes(1)
  expect(result).toEqual({ size: 25, depth: 8 })
})
