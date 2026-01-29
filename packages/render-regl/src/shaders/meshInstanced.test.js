import { describe, expect, it } from 'vitest'

import {
  instancedMeshVert,
  instancedMeshFrag,
  instancedVColorVert,
  instancedVColorFrag
} from './meshInstanced.js'

describe('meshInstanced shaders', () => {
  describe('instancedMeshVert', () => {
    it('should be a string', () => {
      expect(typeof instancedMeshVert).toBe('string')
    })

    it('should contain position and normal attributes', () => {
      // May be combined: attribute vec3 position, normal;
      expect(instancedMeshVert).toContain('position')
      expect(instancedMeshVert).toContain('normal')
      expect(instancedMeshVert).toMatch(/attribute\s+vec3/)
    })

    it('should contain instance matrix attributes', () => {
      expect(instancedMeshVert).toMatch(/attribute\s+vec4\s+instanceMatrix0/)
      expect(instancedMeshVert).toMatch(/attribute\s+vec4\s+instanceMatrix1/)
      expect(instancedMeshVert).toMatch(/attribute\s+vec4\s+instanceMatrix2/)
      expect(instancedMeshVert).toMatch(/attribute\s+vec4\s+instanceMatrix3/)
    })

    it('should reconstruct instance model matrix', () => {
      expect(instancedMeshVert).toContain('mat4 instanceModel = mat4(')
    })

    it('should contain view and projection uniforms', () => {
      // May be combined: uniform mat4 view, projection;
      expect(instancedMeshVert).toContain('view')
      expect(instancedMeshVert).toContain('projection')
      expect(instancedMeshVert).toMatch(/uniform\s+mat4/)
    })

    it('should contain lighting uniforms', () => {
      expect(instancedMeshVert).toMatch(/uniform\s+vec3\s+lightDirection/)
    })

    it('should output varyings for fragment shader', () => {
      expect(instancedMeshVert).toMatch(/varying\s+vec3\s+vNormal/)
      expect(instancedMeshVert).toMatch(/varying\s+vec3\s+vLightDir/)
      expect(instancedMeshVert).toMatch(/varying\s+vec3\s+vViewDir/)
    })

    it('should set gl_Position', () => {
      expect(instancedMeshVert).toContain('gl_Position')
    })
  })

  describe('instancedMeshFrag', () => {
    it('should be a string', () => {
      expect(typeof instancedMeshFrag).toBe('string')
    })

    it('should contain color uniform', () => {
      expect(instancedMeshFrag).toMatch(/uniform\s+vec4\s+color/)
    })

    it('should contain lighting uniforms', () => {
      expect(instancedMeshFrag).toMatch(/uniform\s+vec3\s+lightColor/)
      // May be combined: uniform float ambientAmount, diffuseAmount, specularAmount, shininess;
      expect(instancedMeshFrag).toContain('ambientAmount')
      expect(instancedMeshFrag).toContain('diffuseAmount')
      expect(instancedMeshFrag).toContain('specularAmount')
      expect(instancedMeshFrag).toContain('shininess')
    })

    it('should contain varyings from vertex shader', () => {
      expect(instancedMeshFrag).toMatch(/varying\s+vec3\s+vNormal/)
      expect(instancedMeshFrag).toMatch(/varying\s+vec3\s+vLightDir/)
      expect(instancedMeshFrag).toMatch(/varying\s+vec3\s+vViewDir/)
    })

    it('should compute ambient lighting', () => {
      expect(instancedMeshFrag).toContain('ambient')
    })

    it('should compute diffuse lighting', () => {
      expect(instancedMeshFrag).toContain('diffuse')
    })

    it('should compute specular lighting with Blinn-Phong', () => {
      expect(instancedMeshFrag).toContain('halfDir')
      expect(instancedMeshFrag).toContain('specular')
    })

    it('should set gl_FragColor', () => {
      expect(instancedMeshFrag).toContain('gl_FragColor')
    })
  })

  describe('instancedVColorVert', () => {
    it('should be a string', () => {
      expect(typeof instancedVColorVert).toBe('string')
    })

    it('should contain vcolor attribute', () => {
      expect(instancedVColorVert).toMatch(/attribute\s+vec4\s+vcolor/)
    })

    it('should contain instance matrix attributes', () => {
      expect(instancedVColorVert).toMatch(/attribute\s+vec4\s+instanceMatrix0/)
      expect(instancedVColorVert).toMatch(/attribute\s+vec4\s+instanceMatrix1/)
      expect(instancedVColorVert).toMatch(/attribute\s+vec4\s+instanceMatrix2/)
      expect(instancedVColorVert).toMatch(/attribute\s+vec4\s+instanceMatrix3/)
    })

    it('should output vColor varying', () => {
      expect(instancedVColorVert).toMatch(/varying\s+vec4\s+vColor/)
    })

    it('should pass through vertex color', () => {
      expect(instancedVColorVert).toContain('vColor = vcolor')
    })
  })

  describe('instancedVColorFrag', () => {
    it('should be a string', () => {
      expect(typeof instancedVColorFrag).toBe('string')
    })

    it('should NOT contain color uniform', () => {
      expect(instancedVColorFrag).not.toMatch(/uniform\s+vec4\s+color/)
    })

    it('should contain vColor varying', () => {
      expect(instancedVColorFrag).toMatch(/varying\s+vec4\s+vColor/)
    })

    it('should use vColor for lighting calculations', () => {
      expect(instancedVColorFrag).toContain('vColor.rgb')
    })

    it('should set gl_FragColor with vColor alpha', () => {
      expect(instancedVColorFrag).toContain('vColor.a')
    })
  })
})
