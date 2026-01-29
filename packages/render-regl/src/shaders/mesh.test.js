import { describe, expect, it } from 'vitest'

import { meshVert, meshFrag, vColorVert, vColorFrag } from './mesh.js'

describe('mesh shaders', () => {
  describe('meshVert (uniform color vertex shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof meshVert).toBe('string')
      expect(meshVert.length).toBeGreaterThan(0)
    })

    it('should declare required uniforms', () => {
      expect(meshVert).toContain('uniform mat4 model')
      expect(meshVert).toContain('view')
      expect(meshVert).toContain('projection')
    })

    it('should declare required attributes', () => {
      expect(meshVert).toContain('attribute vec3 position')
      expect(meshVert).toContain('normal')
    })

    it('should declare required varyings', () => {
      expect(meshVert).toContain('varying vec3 surfaceNormal')
      expect(meshVert).toContain('surfacePosition')
    })

    it('should have main function', () => {
      expect(meshVert).toContain('void main()')
      expect(meshVert).toContain('gl_Position')
    })
  })

  describe('meshFrag (uniform color fragment shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof meshFrag).toBe('string')
      expect(meshFrag.length).toBeGreaterThan(0)
    })

    it('should declare lighting uniforms', () => {
      expect(meshFrag).toContain('uniform float ambientLightAmount')
      expect(meshFrag).toContain('uniform float diffuseLightAmount')
      expect(meshFrag).toContain('uniform vec3 eye')
    })

    it('should declare color uniform', () => {
      expect(meshFrag).toContain('uniform vec4 ucolor')
    })

    it('should compute ambient lighting', () => {
      expect(meshFrag).toContain('ambient')
      expect(meshFrag).toContain('ambientLightAmount')
    })

    it('should compute diffuse lighting', () => {
      expect(meshFrag).toContain('diffuse')
      expect(meshFrag).toContain('lightDir')
    })

    it('should output to gl_FragColor', () => {
      expect(meshFrag).toContain('gl_FragColor')
    })
  })

  describe('vColorVert (vertex color vertex shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof vColorVert).toBe('string')
      expect(vColorVert.length).toBeGreaterThan(0)
    })

    it('should declare color attribute', () => {
      expect(vColorVert).toContain('attribute vec4 color')
    })

    it('should declare vColor varying for fragment shader', () => {
      expect(vColorVert).toContain('varying vec4 vColor')
    })

    it('should pass color to varying', () => {
      expect(vColorVert).toContain('vColor = color')
    })

    it('should declare normal matrix uniform', () => {
      expect(vColorVert).toContain('unormal')
    })
  })

  describe('vColorFrag (vertex color fragment shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof vColorFrag).toBe('string')
      expect(vColorFrag.length).toBeGreaterThan(0)
    })

    it('should declare vColor varying', () => {
      expect(vColorFrag).toContain('varying vec4 vColor')
    })

    it('should declare vColorToggler uniform', () => {
      expect(vColorFrag).toContain('uniform float vColorToggler')
    })

    it('should support specular lighting', () => {
      expect(vColorFrag).toContain('uniform float specularLightAmount')
      expect(vColorFrag).toContain('specular')
    })

    it('should blend between vertex color and uniform color', () => {
      expect(vColorFrag).toContain('vColor * vColorToggler')
      expect(vColorFrag).toContain('ucolor * (1.0 - vColorToggler)')
    })
  })
})
