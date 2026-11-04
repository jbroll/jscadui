import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { dismissWelcome, waitForRender } from './helpers.js'

const MAIN = "const { cuboid } = require('@jscad/modeling').primitives\nconst main = (params) => {\n  params.length = { type: 'slider', default: 20, min: 5, max: 80, step: 1 }\n  return cuboid({ size: [10, params.length, 2] })\n}\nmodule.exports = { main }\n"

const lengthInput = (page) => page.locator('#paramsTreeContainer input[data-param-path="length"]')

const setLength = async (page, value) => {
  await lengthInput(page).fill(String(value))
  await lengthInput(page).press('Enter')
  await waitForRender(page)
}

const exportedLength = async (page) => {
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.selectOption('#export-format', 'project')
  await page.locator('#export-button').click()
  const entries = unzipSync(readFileSync(await (await download).path()))
  const stl = entries[Object.keys(entries).find((path) => path.startsWith('stl/'))]
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  let min = Infinity
  let max = -Infinity
  for (let t = 0; t < view.getUint32(80, true); t++) {
    for (let v = 0; v < 3; v++) {
      const y = view.getFloat32(84 + t * 50 + 12 + v * 12 + 4, true)
      min = Math.min(min, y)
      max = Math.max(max, y)
    }
  }
  return { length: max - min, params: JSON.parse(strFromU8(entries['params.json'])) }
}

test('Save writes params.json, Restore and Reset return to it and to the defaults, and opening the project applies it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)
  await page.locator('#editor-header .project-new').click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.vertices)).toBe('0')
  const content = page.locator('.cm-content')
  await content.click()
  await page.keyboard.insertText(MAIN)
  await content.press('Shift+Enter')
  await waitForRender(page)
  await page.locator('#paramsHeader button', { hasText: 'Expand' }).click()
  await expect(page.locator('#params-restore')).toBeDisabled()

  await setLength(page, 40)
  await page.locator('#params-save').click()
  await expect(page.locator('#editor-files .file-node[data-path="/params.json"]')).toBeAttached()
  await expect(page.locator('#params-restore')).toBeEnabled()

  await setLength(page, 30)
  await page.locator('#params-restore').click()
  await expect(lengthInput(page)).toHaveValue('40')
  await page.locator('#params-reset').click()
  await expect(lengthInput(page)).toHaveValue('20')

  await page.reload()
  await dismissWelcome(page)
  await waitForRender(page)
  await expect(lengthInput(page)).toHaveValue('40')
  const exported = await exportedLength(page)
  expect(exported.params).toEqual({ length: 40 })
  expect(exported.length).toBeCloseTo(40, 2)
})
