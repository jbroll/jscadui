import { describe, expect, it } from 'vitest'

import { linesVert, linesFrag, vColorVert, vColorFrag } from './lines.js'

describe('lines shaders', () => {
  describe('linesVert (uniform color vertex shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof linesVert).toBe('string')
      expect(linesVert.length).toBeGreaterThan(0)
    })

    it('should declare required uniforms', () => {
      expect(linesVert).toContain('uniform mat4 model')
      expect(linesVert).toContain('view')
      expect(linesVert).toContain('projection')
    })

    it('should declare required attributes', () => {
      expect(linesVert).toContain('attribute vec3 position')
    })

    it('should have main function with gl_Position', () => {
      expect(linesVert).toContain('void main()')
      expect(linesVert).toContain('gl_Position')
    })
  })

  describe('linesFrag (flat color fragment shader)', () => {
    it('should be a non-empty string', () => {
      expect(typeof linesFrag).toBe('string')
      expect(linesFrag.length).toBeGreaterThan(0)
    })

    it('should declare color uniform', () => {
      expect(linesFrag).toContain('uniform vec4 ucolor')
    })

    it('should output flat color without lighting', () => {
      expect(linesFrag).toContain('gl_FragColor = ucolor')
    })

    it('should be simpler than mesh shader (no lighting calculations)', () => {
      // Lines shader should not have complex lighting
      expect(linesFrag).not.toContain('ambientLightAmount')
      expect(linesFrag).not.toContain('diffuseLightAmount')
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

    it('should declare vColor varying', () => {
      expect(vColorVert).toContain('varying vec4 vColor')
    })

    it('should pass color to varying', () => {
      expect(vColorVert).toContain('vColor = color')
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

    it('should support lighting for colored lines', () => {
      // Vertex color lines can have lighting for consistency
      expect(vColorFrag).toContain('ambient')
      expect(vColorFrag).toContain('diffuse')
    })
  })
})
