import { test } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('OpenSCAD (.scad) file loading', () => {
  test('loads cube.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/01-cube.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads sphere.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/03-sphere.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads cylinder.scad via hash navigation', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/04-cylinder.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors
    await assertNoError(page)
  })

  test('loads linear-extrude.scad with OpenSCAD-specific functions', async ({ page }) => {
    await page.goto('/#/examples/openscad/01-basics/10-linear-extrude.scad')
    await dismissWelcome(page)

    // Wait for model to render
    await waitForRender(page)

    // Assert no errors (this tests that linear_extrude from OpenSCAD works)
    await assertNoError(page)
  })
})
