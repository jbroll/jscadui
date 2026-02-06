import { describe, it, expect } from 'vitest'
import { scadToJscad, scadToIR } from '../src/index.js'

describe('Phase 3 Features', () => {
  describe('list comprehensions', () => {
    it('translates simple list comprehension', () => {
      const result = scadToJscad(`
        x = [for (i = [0:3]) i * 2];
        cube(x[2]);
      `, { includeHeader: false })
      expect(result).toContain('size: 4')
    })

    it('translates list comprehension with expression', () => {
      const result = scadToJscad(`
        points = [for (i = [0:2]) [i * 10, 0]];
        polygon(points);
      `, { includeHeader: false })
      expect(result).toContain('polygon')
    })

    it('translates nested list comprehension', () => {
      const result = scadToJscad(`
        grid = [for (x = [0:1]) for (y = [0:1]) [x, y]];
        cube(len(grid));
      `, { includeHeader: false })
      expect(result).toContain('size: 4')
    })

    it('translates list comprehension with if condition', () => {
      const result = scadToJscad(`
        evens = [for (i = [0:5]) if (i % 2 == 0) i];
        cube(len(evens));
      `, { includeHeader: false })
      expect(result).toContain('size: 3')
    })

    it('translates list comprehension in for loop', () => {
      const ir = scadToIR(`
        positions = [for (i = [0:2]) i * 5];
        for (p = positions) {
          translate([p, 0, 0]) cube(2);
        }
      `)
      expect(ir.type).toBe('group')
      expect((ir as any).children.length).toBe(3)
    })
  })

  describe('let expressions', () => {
    it('translates let in expression', () => {
      const result = scadToJscad(`
        size = let(x = 5, y = 10) x + y;
        cube(size);
      `, { includeHeader: false })
      expect(result).toContain('size: 15')
    })

    it('translates let with dependent variables', () => {
      const result = scadToJscad(`
        size = let(x = 5, y = x * 2) y;
        cube(size);
      `, { includeHeader: false })
      expect(result).toContain('size: 10')
    })

    it('translates let in function', () => {
      const result = scadToJscad(`
        function compute(n) = let(doubled = n * 2) doubled + 1;
        cube(compute(5));
      `, { includeHeader: false })
      expect(result).toContain('size: 11')
    })
  })

  describe('each keyword', () => {
    it('translates each to flatten arrays', () => {
      const result = scadToJscad(`
        a = [[1, 2], [3, 4]];
        flat = [each a[0], each a[1]];
        cube(len(flat));
      `, { includeHeader: false })
      expect(result).toContain('size: 4')
    })
  })

  describe('assert and echo', () => {
    it('ignores assert statements', () => {
      const result = scadToJscad(`
        assert(true, "should pass");
        cube(5);
      `, { includeHeader: false })
      expect(result).toContain('cube')
    })

    it('ignores echo in list comprehension', () => {
      const result = scadToJscad(`
        cube(5);
        echo("test");
      `, { includeHeader: false })
      expect(result).toContain('cube')
    })
  })

  describe('advanced for loops', () => {
    it('handles for with multiple variables', () => {
      const ir = scadToIR(`
        for (x = [0:1], y = [0:1]) {
          translate([x * 10, y * 10, 0]) cube(5);
        }
      `)
      expect(ir.type).toBe('group')
      expect((ir as any).children.length).toBe(4)
    })

    it('handles intersection_for', () => {
      const result = scadToJscad(`
        intersection_for(i = [0:2]) {
          rotate([0, 0, i * 45]) cube(10, center = true);
        }
      `, { includeHeader: false })
      expect(result).toContain('intersect')
    })
  })

  describe('string operations', () => {
    it('handles string concatenation', () => {
      const result = scadToJscad(`
        s = str("a", "b", "c");
        cube(len(s));
      `, { includeHeader: false })
      expect(result).toContain('size: 3')
    })

    it('handles chr function', () => {
      const result = scadToJscad(`
        c = chr(65);
        cube(len(c));
      `, { includeHeader: false })
      expect(result).toContain('size: 1')
    })

    it('handles ord function', () => {
      const result = scadToJscad(`
        n = ord("A");
        cube(n / 13);
      `, { includeHeader: false })
      expect(result).toContain('size: 5')
    })
  })

  describe('search function', () => {
    it('handles search in list', () => {
      const result = scadToJscad(`
        idx = search(3, [1, 2, 3, 4]);
        cube(idx[0] + 1);
      `, { includeHeader: false })
      expect(result).toContain('size: 3')
    })
  })

  describe('lookup function', () => {
    it('handles lookup interpolation', () => {
      const result = scadToJscad(`
        table = [[0, 0], [10, 100]];
        v = lookup(5, table);
        cube(v / 10);
      `, { includeHeader: false })
      expect(result).toContain('size: 5')
    })
  })
})
