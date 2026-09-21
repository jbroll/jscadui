import { test } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('OpenSCAD (.scad) file loading', () => {
  test('loads cube.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/cube.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads sphere.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/sphere.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads cylinder.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/cylinder.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads linear-extrude.scad with OpenSCAD-specific functions', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/linear-extrude.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors (this tests that linear_extrude from OpenSCAD works)
    await assertNoError(page)
  })
})
