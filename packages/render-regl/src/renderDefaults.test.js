import { describe, expect, it } from 'vitest'

import renderDefaults from './renderDefaults.js'

describe('renderDefaults', () => {
  describe('background', () => {
    it('should be white with full opacity', () => {
      expect(renderDefaults.background).toEqual([1, 1, 1, 1])
    })
  })

  describe('meshColor', () => {
    it('should be JSCAD blue', () => {
      expect(renderDefaults.meshColor).toEqual([0, 0.6, 1, 1])
    })

    it('should have 4 components (RGBA)', () => {
      expect(renderDefaults.meshColor.length).toBe(4)
    })
  })

  describe('lightColor', () => {
    it('should be white', () => {
      expect(renderDefaults.lightColor).toEqual([1, 1, 1, 1])
    })
  })

  describe('lightDirection', () => {
    it('should be a 3-component vector', () => {
      expect(renderDefaults.lightDirection.length).toBe(3)
    })

    it('should point somewhat toward viewer', () => {
      // Z component should be positive (toward camera)
      expect(renderDefaults.lightDirection[2]).toBeGreaterThan(0)
    })

    it('should have expected values matching Three.js light at (50,0,100)', () => {
      // Three.js directional light at (50, 0, 100) relative to camera
      // Normalized: roughly (0.45, 0, 0.9)
      expect(renderDefaults.lightDirection).toEqual([0.45, 0.0, 0.9])
    })
  })

  describe('lightPosition', () => {
    it('should be a 3-component vector', () => {
      expect(renderDefaults.lightPosition.length).toBe(3)
    })

    it('should have expected values', () => {
      expect(renderDefaults.lightPosition).toEqual([100, 200, 100])
    })
  })

  describe('lighting amounts', () => {
    it('should have ambient light at 45%', () => {
      // Matches Three.js AmbientLight 0.5 * 0xeeeeee color
      expect(renderDefaults.ambientLightAmount).toBe(0.45)
    })

    it('should have diffuse light at 65%', () => {
      // Matches Three.js DirectionalLight 0.7 * 0xeeeef4 color
      expect(renderDefaults.diffuseLightAmount).toBe(0.65)
    })

    it('should have specular light at 16%', () => {
      expect(renderDefaults.specularLightAmount).toBe(0.16)
    })

    it('should have lighting amounts sum to reasonable value', () => {
      const total = renderDefaults.ambientLightAmount +
        renderDefaults.diffuseLightAmount +
        renderDefaults.specularLightAmount
      // Total should be reasonable (not too bright, not too dark)
      expect(total).toBeGreaterThan(0.5)
      expect(total).toBeLessThan(2.0)
    })
  })

  describe('materialShininess', () => {
    it('should be a positive number', () => {
      expect(renderDefaults.materialShininess).toBeGreaterThan(0)
    })

    it('should have expected value', () => {
      expect(renderDefaults.materialShininess).toBe(8.0)
    })
  })

  describe('consistency with Three.js renderer', () => {
    it('should match Three.js lighting setup', () => {
      // These values were tuned to match Three.js visual output
      // Ambient: 0.45 (matches Three.js AmbientLight 0.5 * 0xeeeeee)
      // Diffuse: 0.65 (matches Three.js DirectionalLight 0.7 * 0xeeeef4)
      expect(renderDefaults.ambientLightAmount).toBe(0.45)
      expect(renderDefaults.diffuseLightAmount).toBe(0.65)
    })
  })
})
