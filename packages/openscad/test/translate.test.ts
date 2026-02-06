import { describe, it, expect } from 'vitest'
import { scadToJscad, scadToIR } from '../src/index.js'

describe('scadToJscad', () => {
  describe('primitives', () => {
    it('translates cube()', () => {
      const result = scadToJscad('cube();', { includeHeader: false })
      expect(result).toContain('cube(')
    })

    it('translates cube with size', () => {
      const result = scadToJscad('cube(10);', { includeHeader: false })
      expect(result).toContain('cube({ size: 10 })')
    })

    it('translates cube with vector size', () => {
      const result = scadToJscad('cube([10, 20, 30]);', { includeHeader: false })
      expect(result).toContain('cuboid({ size: [10, 20, 30] })')
    })

    it('translates centered cube', () => {
      const result = scadToJscad('cube(10, center=true);', { includeHeader: false })
      expect(result).toContain('cube({ size: 10 })')
      expect(result).not.toContain('translate')
    })

    it('translates sphere()', () => {
      const result = scadToJscad('sphere(5);', { includeHeader: false })
      expect(result).toContain('sphere({ radius: 5')
    })

    it('translates sphere with diameter', () => {
      const result = scadToJscad('sphere(d=10);', { includeHeader: false })
      expect(result).toContain('sphere({ radius: 5')
    })

    it('translates cylinder()', () => {
      const result = scadToJscad('cylinder(h=10, r=5);', { includeHeader: false })
      expect(result).toContain('cylinder({ height: 10, radius: 5')
    })

    it('translates cone (cylinder with r1/r2)', () => {
      const result = scadToJscad('cylinder(h=10, r1=5, r2=0);', { includeHeader: false })
      expect(result).toContain('cylinderElliptic')
      expect(result).toContain('startRadius: [5, 5]')
      expect(result).toContain('endRadius: [0, 0]')
    })
  })

  describe('transforms', () => {
    it('translates translate()', () => {
      const result = scadToJscad('translate([10, 20, 30]) cube();', { includeHeader: false })
      expect(result).toContain('translate([10, 20, 30]')
    })

    it('translates rotate() with vector', () => {
      const result = scadToJscad('rotate([45, 0, 0]) cube();', { includeHeader: false })
      expect(result).toContain('rotateX')
    })

    it('translates rotate() with single angle', () => {
      const result = scadToJscad('rotate(90) cube();', { includeHeader: false })
      expect(result).toContain('rotateZ')
    })

    it('translates scale()', () => {
      const result = scadToJscad('scale([2, 2, 2]) cube();', { includeHeader: false })
      expect(result).toContain('scale([2, 2, 2]')
    })

    it('translates mirror()', () => {
      const result = scadToJscad('mirror([1, 0, 0]) cube();', { includeHeader: false })
      expect(result).toContain('mirror({ normal: [1, 0, 0] }')
    })

    it('translates nested transforms', () => {
      const result = scadToJscad('translate([10, 0, 0]) rotate([0, 0, 45]) cube();', { includeHeader: false })
      expect(result).toContain('translate')
      expect(result).toContain('rotateZ')
    })
  })

  describe('boolean operations', () => {
    it('translates union()', () => {
      const result = scadToJscad('union() { cube(); sphere(); }', { includeHeader: false })
      expect(result).toContain('union(')
    })

    it('translates difference()', () => {
      const result = scadToJscad('difference() { cube(10); sphere(5); }', { includeHeader: false })
      expect(result).toContain('subtract(')
    })

    it('translates intersection()', () => {
      const result = scadToJscad('intersection() { cube(10); sphere(8); }', { includeHeader: false })
      expect(result).toContain('intersect(')
    })

    it('translates implicit union (sibling primitives)', () => {
      const result = scadToJscad('cube(); sphere();', { includeHeader: false })
      expect(result).toContain('union(')
    })
  })

  describe('modules', () => {
    it('translates simple module', () => {
      const result = scadToJscad(`
        module mybox() {
          cube(10);
        }
        mybox();
      `, { includeHeader: false })
      expect(result).toContain('cube')
    })

    it('translates module with parameters', () => {
      const result = scadToJscad(`
        module mybox(size = 10) {
          cube(size);
        }
        mybox(20);
      `, { includeHeader: false })
      expect(result).toContain('cube({ size: 20 })')
    })

    it('translates module with named parameters', () => {
      const result = scadToJscad(`
        module mybox(width = 10, height = 20) {
          cube([width, width, height]);
        }
        mybox(height=30, width=15);
      `, { includeHeader: false })
      expect(result).toContain('15')
      expect(result).toContain('30')
    })
  })

  describe('control flow', () => {
    it('translates if statement', () => {
      const ir = scadToIR(`
        x = 10;
        if (x > 5) {
          cube();
        }
      `)
      expect(ir.type).toBe('primitive')
    })

    it('translates if-else statement', () => {
      const ir = scadToIR(`
        x = 3;
        if (x > 5) {
          cube();
        } else {
          sphere();
        }
      `)
      expect(ir.type).toBe('primitive')
      expect((ir as any).primitive).toBe('sphere')
    })

    it('translates for loop', () => {
      const result = scadToJscad(`
        for (i = [0:2]) {
          translate([i * 10, 0, 0]) cube();
        }
      `, { includeHeader: false })
      expect(result).toContain('union(')
      expect(result).toContain('translate([0, 0, 0]')
      expect(result).toContain('translate([10, 0, 0]')
      expect(result).toContain('translate([20, 0, 0]')
    })
  })

  describe('expressions', () => {
    it('evaluates arithmetic', () => {
      const result = scadToJscad('cube(5 + 5);', { includeHeader: false })
      expect(result).toContain('size: 10')
    })

    it('evaluates variables', () => {
      const result = scadToJscad(`
        size = 15;
        cube(size);
      `, { includeHeader: false })
      expect(result).toContain('size: 15')
    })

    it('evaluates vector operations', () => {
      const result = scadToJscad(`
        v = [1, 2, 3] * 2;
        translate(v) cube();
      `, { includeHeader: false })
      expect(result).toContain('translate([2, 4, 6]')
    })

    it('evaluates ternary expressions', () => {
      const result = scadToJscad(`
        x = true;
        size = x ? 10 : 20;
        cube(size);
      `, { includeHeader: false })
      expect(result).toContain('size: 10')
    })
  })

  describe('full module output', () => {
    it('includes proper JSCAD header', () => {
      const result = scadToJscad('cube();')
      expect(result).toContain("require('@jscad/modeling')")
      expect(result).toContain('const main = ()')
      expect(result).toContain('module.exports = { main }')
    })

    it('includes correct imports', () => {
      const result = scadToJscad('difference() { cube(10); sphere(5); }')
      expect(result).toContain('primitives')
      expect(result).toContain('booleans')
      expect(result).toContain('subtract')
    })
  })
})
