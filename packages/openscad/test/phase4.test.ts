import { describe, it, expect } from 'vitest'
import { scadToJscad } from '../src/index.js'

describe('Phase 4 Features', () => {
  describe('use statement', () => {
    it('imports modules from used file', () => {
      const files: Record<string, string> = {
        'library.scad': `
          module mybox(size) {
            cube(size);
          }
        `
      }

      const result = scadToJscad(`
        use <library.scad>
        mybox(10);
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      expect(result).toContain('cube')
      expect(result).toContain('size: 10')
    })

    it('imports functions from used file', () => {
      const files: Record<string, string> = {
        'math.scad': `
          function double(x) = x * 2;
        `
      }

      const result = scadToJscad(`
        use <math.scad>
        cube(double(5));
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      expect(result).toContain('size: 10')
    })

    it('does not include geometry from used file', () => {
      const files: Record<string, string> = {
        'shapes.scad': `
          cube(100);
          module mybox(size) {
            cube(size);
          }
        `
      }

      const result = scadToJscad(`
        use <shapes.scad>
        mybox(5);
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      // Should only have the 5-size cube, not the 100-size one
      expect(result).toContain('size: 5')
      expect(result).not.toContain('size: 100')
    })

    it('handles missing file gracefully', () => {
      const result = scadToJscad(`
        use <nonexistent.scad>
        cube(5);
      `, {
        includeHeader: false,
        fileResolver: () => undefined
      })

      expect(result).toContain('cube')
    })
  })

  describe('include statement', () => {
    it('includes geometry from included file', () => {
      const files: Record<string, string> = {
        'shapes.scad': `
          cube(100);
        `
      }

      const result = scadToJscad(`
        include <shapes.scad>
        cube(5);
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      // Should have both cubes
      expect(result).toContain('100')
      expect(result).toContain('5')
    })

    it('includes modules from included file', () => {
      const files: Record<string, string> = {
        'library.scad': `
          module mybox(size) {
            cube(size);
          }
        `
      }

      const result = scadToJscad(`
        include <library.scad>
        mybox(10);
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      expect(result).toContain('cube')
    })

    it('prevents circular includes', () => {
      const files: Record<string, string> = {
        'a.scad': `
          include <b.scad>
          cube(1);
        `,
        'b.scad': `
          include <a.scad>
          cube(2);
        `
      }

      // Should not hang or throw
      const result = scadToJscad(`
        include <a.scad>
        cube(3);
      `, {
        includeHeader: false,
        fileResolver: (path) => files[path]
      })

      expect(result).toContain('cube')
    })
  })

  describe('CLI features', () => {
    it('exports main translation functions', async () => {
      const mod = await import('../src/index.js')
      // Check that main exports exist
      expect(typeof mod.scadToJscad).toBe('function')
      expect(typeof mod.evaluate).toBe('function')
      expect(typeof mod.emit).toBe('function')
    })
  })

  describe('error handling', () => {
    it('provides location in error messages', () => {
      try {
        scadToJscad(`
          unknown_module();
        `)
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Undefined module')
        expect(err.message).toContain('unknown_module')
      }
    })

    it('provides helpful error for undefined variables', () => {
      try {
        scadToJscad(`
          cube(undefined_var);
        `)
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Undefined variable')
        expect(err.message).toContain('undefined_var')
      }
    })
  })

  describe('web compatibility', () => {
    it('generates valid JSCAD without file system access', () => {
      const result = scadToJscad(`
        difference() {
          cube(10, center=true);
          sphere(6);
        }
      `, { includeHeader: false })

      // Should work without any file system access
      expect(result).toContain('subtract')
      expect(result).toContain('cube')
      expect(result).toContain('sphere')
    })

    it('works with segment count option', () => {
      const result = scadToJscad(`
        sphere(5);
      `, {
        includeHeader: false,
        defaultSegments: 64
      })

      expect(result).toContain('segments: 64')
    })
  })
})
