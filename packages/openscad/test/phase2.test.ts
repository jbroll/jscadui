import { describe, it, expect } from 'vitest'
import { scadToJscad, scadToIR } from '../src/index.js'

describe('Phase 2 Features', () => {
  describe('user-defined functions', () => {
    it('translates simple function', () => {
      const result = scadToJscad(`
        function double(x) = x * 2;
        cube(double(5));
      `, { includeHeader: false })
      expect(result).toContain('size: 10')
    })

    it('translates function with default parameter', () => {
      const result = scadToJscad(`
        function scale_val(x, factor = 2) = x * factor;
        cube(scale_val(5));
      `, { includeHeader: false })
      expect(result).toContain('size: 10')
    })

    it('translates function with multiple parameters', () => {
      const result = scadToJscad(`
        function add(a, b, c) = a + b + c;
        cube(add(1, 2, 3));
      `, { includeHeader: false })
      expect(result).toContain('size: 6')
    })

    it('translates recursive function', () => {
      const result = scadToJscad(`
        function factorial(n) = n <= 1 ? 1 : n * factorial(n - 1);
        cube(factorial(4));
      `, { includeHeader: false })
      expect(result).toContain('size: 24')
    })
  })

  describe('children() support', () => {
    it('translates module with children()', () => {
      const result = scadToJscad(`
        module double_it() {
          children();
          translate([20, 0, 0]) children();
        }
        double_it() cube(5);
      `, { includeHeader: false })
      expect(result).toContain('cube')
      expect(result).toContain('translate([20, 0, 0]')
    })

    it('translates module with children(i)', () => {
      const result = scadToJscad(`
        module first_child() {
          children(0);
        }
        first_child() {
          cube(5);
          sphere(3);
        }
      `, { includeHeader: false })
      expect(result).toContain('cube')
    })

    it('translates module with $children', () => {
      const ir = scadToIR(`
        module show_count() {
          if ($children > 0) {
            children();
          }
        }
        show_count() cube(5);
      `)
      expect(ir.type).not.toBe('empty')
    })
  })

  describe('2D primitives', () => {
    it('translates square()', () => {
      const result = scadToJscad('square(10);', { includeHeader: false })
      expect(result).toContain('rectangle')
    })

    it('translates square with size vector', () => {
      const result = scadToJscad('square([10, 20]);', { includeHeader: false })
      expect(result).toContain('rectangle')
      expect(result).toContain('10')
      expect(result).toContain('20')
    })

    it('translates circle()', () => {
      const result = scadToJscad('circle(5);', { includeHeader: false })
      expect(result).toContain('circle')
      expect(result).toContain('radius: 5')
    })

    it('translates polygon()', () => {
      const result = scadToJscad('polygon([[0,0], [10,0], [5,10]]);', { includeHeader: false })
      expect(result).toContain('polygon')
    })
  })

  describe('extrusions', () => {
    it('translates linear_extrude()', () => {
      const result = scadToJscad('linear_extrude(10) square(5);', { includeHeader: false })
      expect(result).toContain('extrudeLinear')
      expect(result).toContain('height: 10')
    })

    it('translates linear_extrude with twist', () => {
      const result = scadToJscad('linear_extrude(height=10, twist=90) square(5);', { includeHeader: false })
      expect(result).toContain('extrudeLinear')
      expect(result).toContain('twist')
    })

    it('translates rotate_extrude()', () => {
      const result = scadToJscad('rotate_extrude() translate([10, 0]) circle(2);', { includeHeader: false })
      expect(result).toContain('extrudeRotate')
    })
  })

  describe('hull operation', () => {
    it('translates hull()', () => {
      const result = scadToJscad(`
        hull() {
          cube(5);
          translate([10, 0, 0]) sphere(3);
        }
      `, { includeHeader: false })
      expect(result).toContain('hull(')
    })
  })

  describe('color support', () => {
    it('translates color with RGB array', () => {
      const result = scadToJscad('color([1, 0, 0]) cube(5);', { includeHeader: false })
      expect(result).toContain('colorize')
      expect(result).toContain('1, 0, 0')
    })

    it('translates color with named color', () => {
      const result = scadToJscad('color("red") cube(5);', { includeHeader: false })
      expect(result).toContain('colorize')
    })

    it('translates color with alpha', () => {
      const result = scadToJscad('color([1, 0, 0, 0.5]) cube(5);', { includeHeader: false })
      expect(result).toContain('colorize')
      expect(result).toContain('0.5')
    })
  })

  describe('special variables', () => {
    it('respects $fn for sphere segments', () => {
      const result = scadToJscad('$fn = 16; sphere(5);', { includeHeader: false })
      expect(result).toContain('segments: 16')
    })

    it('respects $fn for cylinder segments', () => {
      const result = scadToJscad('$fn = 8; cylinder(h=10, r=5);', { includeHeader: false })
      expect(result).toContain('segments: 8')
    })
  })

  describe('nested modules with children', () => {
    it('handles nested module calls with children', () => {
      const result = scadToJscad(`
        module wrapper() {
          translate([5, 0, 0]) children();
        }
        module outer() {
          wrapper() children();
        }
        outer() cube(3);
      `, { includeHeader: false })
      expect(result).toContain('translate([5, 0, 0]')
      expect(result).toContain('cube')
    })
  })
})
