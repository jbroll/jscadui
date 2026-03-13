import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import type { FileResolver } from '../src/transpiler/context.js'

/**
 * Tests for Phase 1 include optimization
 * Files containing only functions/modules should use require() instead of bundling
 */

describe('include optimization - Phase 1', () => {
  describe('pure function files (should optimize)', () => {
    it('optimizes include with only functions', () => {
      const libSource = `
        function twice(x) = x * 2;
        function square(x) = x * x;
      `
      const mainSource = `
        include <lib.scad>
        cube(twice(10));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should generate require() statement, not bundle
      expect(result.code).toContain("require('/lib.scad')")
      expect(result.code).not.toContain('const twice_$f = (x) => x * 2')

      // Verify lib.scad is marked as optimizable
      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(true)
      expect(libFile?.hasVariables).toBe(false)
      expect(libFile?.hasTopLevelGeometry).toBe(false)
    })

    it('optimizes include with only modules', () => {
      const libSource = `
        module my_cube(size) { cube(size); }
        module my_sphere(r) { sphere(r); }
      `
      const mainSource = `
        include <lib.scad>
        my_cube(10);
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should use require()
      expect(result.code).toContain("require('/lib.scad')")

      // Verify optimization flags
      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(true)
      expect(libFile?.hasVariables).toBe(false)
      expect(libFile?.hasTopLevelGeometry).toBe(false)
    })

    it('optimizes include with mixed functions and modules', () => {
      const libSource = `
        function twice(x) = x * 2;
        module my_cube(size) { cube(size); }
        function square(x) = x * x;
      `
      const mainSource = `
        include <lib.scad>
        my_cube(twice(10));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should use require()
      expect(result.code).toContain("require('/lib.scad')")

      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(true)
    })
  })

  describe('files with variables (should NOT optimize)', () => {
    it('does not optimize include with variables', () => {
      const libSource = `
        PI = 3.14159;
        function area(r) = PI * r * r;
      `
      const mainSource = `
        include <lib.scad>
        cube(area(10));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should bundle, not use require()
      expect(result.code).not.toContain("require('/lib.scad')")
      expect(result.code).toContain('var PI = 3.14159')

      // Verify lib.scad is NOT optimizable
      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(false)
      expect(libFile?.hasVariables).toBe(true)
      expect(libFile?.hasTopLevelGeometry).toBe(false)
    })

    it('does not optimize include with only variables', () => {
      const libSource = `
        PI = 3.14159;
        INCH = 25.4;
      `
      const mainSource = `
        include <lib.scad>
        cube(PI * 10);
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should bundle
      expect(result.code).toContain('var PI = 3.14159')
      expect(result.code).toContain('var INCH = 25.4')

      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(false)
      expect(libFile?.hasVariables).toBe(true)
    })
  })

  describe('files with top-level geometry (should NOT optimize)', () => {
    it('does not optimize include with top-level geometry', () => {
      const libSource = `
        function twice(x) = x * 2;
        cube(10);  // Top-level geometry
      `
      const mainSource = `
        include <lib.scad>
        sphere(twice(5));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Should bundle because of top-level geometry
      expect(result.code).not.toContain("require('/lib.scad')")

      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(false)
      expect(libFile?.hasVariables).toBe(false)
      expect(libFile?.hasTopLevelGeometry).toBe(true)
    })
  })

  describe('transitive optimization', () => {
    it('optimizes entire include chain when all files are pure', () => {
      const lib1Source = `
        function twice(x) = x * 2;
      `
      const lib2Source = `
        include <lib1.scad>
        function quad(x) = twice(twice(x));
      `
      const mainSource = `
        include <lib2.scad>
        cube(quad(5));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib1.scad') return { path: '/lib1.scad', content: lib1Source }
        if (filename === 'lib2.scad') return { path: '/lib2.scad', content: lib2Source }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Both should use require()
      expect(result.code).toContain("require('/lib2.scad')")

      const lib2Code = result.files.get('/lib2.scad')?.code
      expect(lib2Code).toContain("require('/lib1.scad')")

      // All files should be optimizable
      expect(result.files.get('/lib1.scad')?.canOptimizeInclude).toBe(true)
      expect(result.files.get('/lib2.scad')?.canOptimizeInclude).toBe(true)
    })

    it('does not optimize chain when any file has variables', () => {
      const lib1Source = `
        PI = 3.14159;  // Has variable
        function area(r) = PI * r * r;
      `
      const lib2Source = `
        include <lib1.scad>
        function volume(r) = area(r) * r;
      `
      const mainSource = `
        include <lib2.scad>
        cube(volume(5));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib1.scad') return { path: '/lib1.scad', content: lib1Source }
        if (filename === 'lib2.scad') return { path: '/lib2.scad', content: lib2Source }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // lib1 should not be optimizable (has variables)
      expect(result.files.get('/lib1.scad')?.canOptimizeInclude).toBe(false)
      expect(result.files.get('/lib1.scad')?.hasVariables).toBe(true)

      // lib2 should also NOT be optimizable because it includes lib1
      // When lib2 includes lib1, lib1's constants get bundled into lib2's bundledParts
      // This makes lib2 non-optimizable as well (transitive non-optimization)
      expect(result.files.get('/lib2.scad')?.canOptimizeInclude).toBe(false)
    })
  })

  describe('mixed use and include', () => {
    it('handles both use and include in same file', () => {
      const pureLibSource = `
        function twice(x) = x * 2;
      `
      const constantsSource = `
        PI = 3.14159;
      `
      const mainSource = `
        use <pure.scad>
        include <constants.scad>
        cube(twice(PI));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'pure.scad') return { path: '/pure.scad', content: pureLibSource }
        if (filename === 'constants.scad') return { path: '/constants.scad', content: constantsSource }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // pure.scad should be required (use statement)
      expect(result.code).toContain("require('/pure.scad')")

      // constants.scad should be bundled (has variables)
      expect(result.code).toContain('var PI = 3.14159')

      // Verify optimization flags
      expect(result.files.get('/pure.scad')?.canOptimizeInclude).toBe(true)
      expect(result.files.get('/constants.scad')?.canOptimizeInclude).toBe(false)
    })

    it('optimizes pure includes even when use statements are present', () => {
      const useLibSource = `
        function helper(x) = x + 1;
      `
      const includeLibSource = `
        function twice(x) = x * 2;
      `
      const mainSource = `
        use <use-lib.scad>
        include <include-lib.scad>
        cube(helper(twice(5)));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'use-lib.scad') return { path: '/use-lib.scad', content: useLibSource }
        if (filename === 'include-lib.scad') return { path: '/include-lib.scad', content: includeLibSource }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Both should use require() (use naturally does, include is optimized)
      expect(result.code).toContain("require('/use-lib.scad')")
      expect(result.code).toContain("require('/include-lib.scad')")

      expect(result.files.get('/include-lib.scad')?.canOptimizeInclude).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles empty file', () => {
      const libSource = `
        // Just a comment, no code
      `
      const mainSource = `
        include <lib.scad>
        cube(10);
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') {
          return { path: '/lib.scad', content: libSource }
        }
        return undefined
      }

      const { ast } = parse(mainSource)
      const result = transpile(ast, {
        currentFile: '/main.scad',
        fileResolver,
      })

      // Empty file should be optimizable
      const libFile = result.files.get('/lib.scad')
      expect(libFile?.canOptimizeInclude).toBe(true)
      expect(libFile?.hasVariables).toBe(false)
      expect(libFile?.hasTopLevelGeometry).toBe(false)
    })

    it('multiple includes of same pure library share single copy', () => {
      const libSource = `
        function twice(x) = x * 2;
      `
      const file1Source = `
        include <lib.scad>
        cube(twice(5));
      `
      const file2Source = `
        include <lib.scad>
        sphere(twice(10));
      `

      const fileResolver: FileResolver = (filename) => {
        if (filename === 'lib.scad') return { path: '/lib.scad', content: libSource }
        return undefined
      }

      // Transpile both files with shared cache
      const sharedCache = new Map()

      const { ast: ast1 } = parse(file1Source)
      const result1 = transpile(ast1, {
        currentFile: '/file1.scad',
        fileResolver,
      }, sharedCache)

      const { ast: ast2 } = parse(file2Source)
      const result2 = transpile(ast2, {
        currentFile: '/file2.scad',
        fileResolver,
      }, sharedCache)

      // Both should use require() to same lib.scad
      expect(result1.code).toContain("require('/lib.scad')")
      expect(result2.code).toContain("require('/lib.scad')")

      // Neither should bundle the library code
      expect(result1.code).not.toContain('const twice_$f = (x) => x * 2')
      expect(result2.code).not.toContain('const twice_$f = (x) => x * 2')

      // lib.scad should be transpiled only once (cached)
      expect(result1.files.get('/lib.scad')).toBe(result2.files.get('/lib.scad'))
    })
  })
})
