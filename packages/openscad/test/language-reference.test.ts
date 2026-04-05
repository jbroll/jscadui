import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Comprehensive unit tests based on OpenSCAD Language Reference
 * https://openscad.org/documentation.html#language-reference
 *
 * Each test verifies that the transpiler correctly handles documented OpenSCAD features.
 */

// Helper to transpile a single expression/statement
function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code.trim()
}

// ============================================================================
// SYNTAX & DECLARATIONS
// ============================================================================

describe('Syntax & Declarations', () => {
  describe('Variable Assignment', () => {
    it('assigns simple values', () => {
      // 'var' is a reserved word in JS, so it gets prefixed with _
      expect(transpileCode('x = 42;')).toContain('var x = 42')
    })

    it('assigns expressions', () => {
      const code = transpileCode('var = 1 + 2;')
      expect(code).toContain('j$.vadd(1, 2)')
    })
  })

  describe('Conditional Operator (Ternary)', () => {
    it('handles basic ternary with OpenSCAD truthiness', () => {
      const code = transpileCode('x = cond ? 1 : 2;')
      // Uses j$.isTruthy() for OpenSCAD semantics (empty arrays are falsy)
      expect(code).toContain('j$.isTruthy(cond)')
      expect(code).toContain('? 1 : 2)')
    })

    it('handles nested ternary with OpenSCAD truthiness', () => {
      const code = transpileCode('x = a ? 1 : b ? 2 : 3;')
      // Both conditions are wrapped with isTruthy
      expect(code).toContain('j$.isTruthy(a)')
      expect(code).toContain('j$.isTruthy(b)')
    })
  })

  describe('Function Literals', () => {
    it('handles function literal assignment', () => {
      const code = transpileCode('f = function(x) x * 2;')
      // Function literals transpile to arrow functions
      expect(code).toContain('var f = (x) =>')
    })

    it('handles function literal with multiple params', () => {
      const code = transpileCode('f = function(x, y) x + y;')
      expect(code).toContain('x')
      expect(code).toContain('y')
    })
  })

  describe('Module Definition', () => {
    it('defines simple module', () => {
      const code = transpileCode('module mymod() { cube(10); }')
      expect(code).toContain('mymod_$m')
      expect(code).toContain('j$.cube')
    })

    it('defines module with parameters', () => {
      const code = transpileCode('module box(size=10) { cube(size); }')
      expect(code).toContain('size')
    })

    it('defines module with default parameters', () => {
      const code = transpileCode('module box(x=1, y=2, z=3) { cube([x,y,z]); }')
      // Defaults are applied via resolveParams helper
      expect(code).toContain('j$.resolveParams(')
      expect(code).toMatch(/resolveParams\(\[x, y, z\], \[1, 2, 3\]\)/)
    })
  })

  describe('Function Definition', () => {
    it('defines simple function', () => {
      const code = transpileCode('function double(x) = x * 2;')
      expect(code).toContain('double_$f')
      expect(code).toContain('return')
    })

    it('defines function with default parameters', () => {
      const code = transpileCode('function add(a=0, b=0) = a + b;')
      expect(code).toContain('a = 0')
      expect(code).toContain('b = 0')
    })

    it('allows recursive functions', () => {
      const code = transpileCode('function fact(n) = n <= 1 ? 1 : n * fact(n-1);')
      expect(code).toContain('fact_$f')
      // Recursive call should also use _$f suffix
      expect(code).toMatch(/fact_\$f\(.*\)/)
    })
  })
})

// ============================================================================
// CONSTANTS
// ============================================================================

describe('Constants', () => {
  it('handles undef', () => {
    expect(transpileCode('x = undef;')).toContain('undefined')
  })

  it('handles PI', () => {
    const code = transpileCode('x = PI;')
    // PI is provided by runtime (j$.PI = Math.PI)
    expect(code).toContain('j$.PI')
  })
})

// ============================================================================
// OPERATORS
// ============================================================================

describe('Operators', () => {
  describe('Arithmetic Operators', () => {
    it('handles + (addition/concatenation)', () => {
      expect(transpileCode('x = a + b;')).toContain('j$.vadd(a, b)')
    })

    it('handles - (subtraction)', () => {
      expect(transpileCode('x = a - b;')).toContain('j$.vsub(a, b)')
    })

    it('handles * (multiplication)', () => {
      expect(transpileCode('x = a * b;')).toContain('j$.vmul(a, b)')
    })

    it('handles / (division)', () => {
      expect(transpileCode('x = a / b;')).toContain('j$.vdiv(a, b)')
    })

    it('handles % (modulo)', () => {
      expect(transpileCode('x = a % b;')).toContain('(a % b)')
    })

    it('handles ^ (exponent/power)', () => {
      const code = transpileCode('x = 2 ^ 3;')
      // Uses modern JS exponent operator **
      expect(code).toContain('(2 ** 3)')
    })

    it('handles unary minus', () => {
      expect(transpileCode('x = -5;')).toContain('-5')
    })
  })

  describe('Relational Operators', () => {
    it('handles < (less than)', () => {
      expect(transpileCode('x = a < b;')).toContain('(a < b)')
    })

    it('handles <= (less than or equal)', () => {
      expect(transpileCode('x = a <= b;')).toContain('(a <= b)')
    })

    it('handles == (equality)', () => {
      expect(transpileCode('x = a == b;')).toContain('j$.eq(a, b)')
    })

    it('handles != (inequality)', () => {
      expect(transpileCode('x = a != b;')).toContain('!j$.eq(a, b)')
    })

    it('handles >= (greater than or equal)', () => {
      expect(transpileCode('x = a >= b;')).toContain('(a >= b)')
    })

    it('handles > (greater than)', () => {
      expect(transpileCode('x = a > b;')).toContain('(a > b)')
    })
  })

  describe('Logical Operators', () => {
    it('handles && (logical AND) with OpenSCAD truthiness', () => {
      // OpenSCAD: && returns true/false; both operands wrapped in isTruthy
      const code = transpileCode('x = a && b;')
      expect(code).toContain('j$.isTruthy(a)')
      expect(code).toContain('j$.isTruthy(b)')
      expect(code).toContain('&&')
    })

    it('handles || (logical OR) with OpenSCAD truthiness', () => {
      // OpenSCAD: || returns true/false; both operands wrapped in isTruthy
      const code = transpileCode('x = a || b;')
      expect(code).toContain('j$.isTruthy(a)')
      expect(code).toContain('j$.isTruthy(b)')
      expect(code).toContain('||')
    })

    it('handles ! (logical NOT) with OpenSCAD truthiness', () => {
      // Uses j$.isTruthy for OpenSCAD semantics (empty arrays are falsy)
      expect(transpileCode('x = !a;')).toContain('!j$.isTruthy(a)')
    })
  })
})

// ============================================================================
// SPECIAL VARIABLES
// ============================================================================

describe('Special Variables', () => {
  it('handles $fn (number of segments)', () => {
    const code = transpileCode('circle(r=10, $fn=32);')
    expect(code).toContain('32')
  })

  it('handles $fa (minimum angle)', () => {
    const code = transpileCode('sphere(r=10, $fa=1);')
    expect(code).toContain('$fa')
  })

  it('handles $fs (minimum size)', () => {
    const code = transpileCode('sphere(r=10, $fs=0.1);')
    expect(code).toContain('$fs')
  })

  it('handles $children in module', () => {
    const code = transpileCode('module wrapper() { echo($children); }')
    // $children becomes _children.length
    expect(code).toContain('_children.length')
  })
})

// ============================================================================
// 2D PRIMITIVES
// ============================================================================

describe('2D Primitives', () => {
  it('generates circle', () => {
    const code = transpileCode('circle(r=10);')
    expect(code).toContain('j$.circle')
  })

  it('generates circle with diameter', () => {
    const code = transpileCode('circle(d=20);')
    expect(code).toContain('j$.circle')
  })

  it('generates square', () => {
    const code = transpileCode('square(10);')
    expect(code).toContain('j$.square')
  })

  it('generates square with size array', () => {
    const code = transpileCode('square([10, 20]);')
    expect(code).toContain('[10, 20]')
  })

  it('generates centered square', () => {
    const code = transpileCode('square(10, center=true);')
    expect(code).toContain('true')
  })

  it('generates polygon with points', () => {
    const code = transpileCode('polygon(points=[[0,0], [10,0], [5,10]]);')
    expect(code).toContain('j$.polygon')
    expect(code).toContain('[[0, 0], [10, 0], [5, 10]]')
  })

  it('generates polygon with paths', () => {
    const code = transpileCode('polygon(points=[[0,0], [10,0], [5,10]], paths=[[0,1,2]]);')
    expect(code).toContain('paths')
  })
})

// ============================================================================
// 3D PRIMITIVES
// ============================================================================

describe('3D Primitives', () => {
  it('generates sphere', () => {
    const code = transpileCode('sphere(r=10);')
    expect(code).toContain('j$.sphere')
  })

  it('generates sphere with diameter', () => {
    const code = transpileCode('sphere(d=20);')
    expect(code).toContain('j$.sphere')
  })

  it('generates cube', () => {
    const code = transpileCode('cube(10);')
    expect(code).toContain('j$.cube')
  })

  it('generates cube with size array', () => {
    const code = transpileCode('cube([10, 20, 30]);')
    expect(code).toContain('[10, 20, 30]')
  })

  it('generates centered cube', () => {
    const code = transpileCode('cube(10, center=true);')
    expect(code).toContain('true')
  })

  it('generates cylinder', () => {
    const code = transpileCode('cylinder(h=20, r=10);')
    expect(code).toContain('j$.cylinder')
  })

  it('generates cylinder with r1 and r2 (cone)', () => {
    const code = transpileCode('cylinder(h=20, r1=10, r2=5);')
    expect(code).toContain('j$.cylinder')
  })

  it('generates cylinder with diameter', () => {
    const code = transpileCode('cylinder(h=20, d=20);')
    expect(code).toContain('j$.cylinder')
  })

  it('generates polyhedron', () => {
    const code = transpileCode(`
      polyhedron(
        points=[[0,0,0], [10,0,0], [5,10,0], [5,5,10]],
        faces=[[0,1,2], [0,1,3], [1,2,3], [2,0,3]]
      );
    `)
    expect(code).toContain('j$.polyhedron')
  })
})

// ============================================================================
// TRANSFORMATIONS
// ============================================================================

describe('Transformations', () => {
  it('generates translate', () => {
    const code = transpileCode('translate([10, 20, 30]) cube(5);')
    expect(code).toContain('translate')
    expect(code).toContain('[10, 20, 30]')
  })

  it('generates rotate with vector', () => {
    const code = transpileCode('rotate([45, 0, 0]) cube(5);')
    expect(code).toContain('j$.rotate')
    expect(code).toContain('[45, 0, 0]')
  })

  it('generates rotate with angle and axis', () => {
    const code = transpileCode('rotate(45, [0, 0, 1]) cube(5);')
    expect(code).toContain('j$.rotate')
  })

  it('generates scale', () => {
    const code = transpileCode('scale([2, 2, 2]) cube(5);')
    expect(code).toContain('scale')
  })

  it('generates resize', () => {
    const code = transpileCode('resize([10, 0, 0]) cube(5);')
    expect(code).toContain('resize')
  })

  it('generates mirror', () => {
    const code = transpileCode('mirror([1, 0, 0]) cube(5);')
    expect(code).toContain('mirror')
  })

  it('generates multmatrix', () => {
    const code = transpileCode('multmatrix([[1,0,0,10],[0,1,0,20],[0,0,1,30],[0,0,0,1]]) cube(5);')
    expect(code).toContain('multmatrix')
  })

  it('generates color', () => {
    const code = transpileCode('color("red") cube(5);')
    expect(code).toContain('color')
    expect(code).toContain('red')
  })

  it('generates color with RGB', () => {
    const code = transpileCode('color([1, 0, 0]) cube(5);')
    expect(code).toContain('color')
  })

  it('generates offset (for 2D)', () => {
    const code = transpileCode('offset(r=5) square(10);')
    expect(code).toContain('offset')
  })

  it('generates hull', () => {
    const code = transpileCode('hull() { sphere(5); translate([10,0,0]) sphere(5); }')
    expect(code).toContain('hull')
  })

  it('generates minkowski', () => {
    const code = transpileCode('minkowski() { cube(10); sphere(2); }')
    expect(code).toContain('minkowski')
  })
})

// ============================================================================
// BOOLEAN OPERATIONS
// ============================================================================

describe('Boolean Operations', () => {
  it('generates union', () => {
    const code = transpileCode('union() { cube(5); sphere(3); }')
    expect(code).toContain('union')
  })

  it('generates difference', () => {
    const code = transpileCode('difference() { cube(10); sphere(5); }')
    expect(code).toContain('subtract')
  })

  it('generates intersection', () => {
    const code = transpileCode('intersection() { cube(10); sphere(8); }')
    expect(code).toContain('intersect')
  })
})

// ============================================================================
// LISTS & INDEXING
// ============================================================================

describe('Lists & Indexing', () => {
  it('creates list literals', () => {
    const code = transpileCode('x = [1, 2, 3];')
    expect(code).toContain('[1, 2, 3]')
  })

  it('handles list indexing', () => {
    const code = transpileCode('x = list[2];')
    expect(code).toContain('list?.[2]')
  })

  it('handles nested list indexing', () => {
    const code = transpileCode('x = matrix[0][1];')
    expect(code).toContain('matrix?.[0]?.[1]')
  })

  it('handles dot notation for vectors (x, y, z)', () => {
    const code = transpileCode('x = vec.x;')
    // .x/.y/.z access first/second/third element; optional chaining so undef.x = undef
    expect(code).toContain('vec?.[0]')
  })

  it('handles dot notation y', () => {
    const code = transpileCode('x = vec.y;')
    expect(code).toContain('vec?.[1]')
  })

  it('handles dot notation z', () => {
    const code = transpileCode('x = vec.z;')
    expect(code).toContain('vec?.[2]')
  })
})

// ============================================================================
// LIST COMPREHENSIONS
// ============================================================================

describe('List Comprehensions', () => {
  describe('for loops', () => {
    it('handles simple for comprehension', () => {
      const code = transpileCode('x = [for (i = [0:5]) i];')
      expect(code).toContain('j$.range(0, 5, 1)')
      expect(code).toContain('.map')
    })

    it('handles for with list', () => {
      const code = transpileCode('x = [for (i = [1, 2, 3]) i * 2];')
      expect(code).toContain('.map')
    })

    it('handles nested for loops (flattening)', () => {
      const code = transpileCode('x = [for (i = [0:2]) for (j = [0:2]) [i, j]];')
      expect(code).toContain('flatMap')
    })

    it('handles C-style for loop', () => {
      const code = transpileCode('x = [for (i = 0; i < 5; i = i + 1) i];')
      expect(code).toContain('while')
    })
  })

  describe('each keyword', () => {
    it('handles each for flattening', () => {
      const code = transpileCode('x = [for (i = [[1,2], [3,4]]) each i];')
      expect(code).toContain('flatMap')
    })
  })

  describe('if filtering', () => {
    it('handles if filter in comprehension', () => {
      const code = transpileCode('x = [for (i = [0:10]) if (i > 5) i];')
      expect(code).toContain('.filter')
    })
  })

  describe('let in comprehensions', () => {
    it('handles let bindings', () => {
      const code = transpileCode('x = [for (i = [0:5]) let(doubled = i * 2) doubled];')
      expect(code).toContain('const')
    })
  })
})

// ============================================================================
// FLOW CONTROL
// ============================================================================

describe('Flow Control', () => {
  describe('for (module context)', () => {
    it('generates for loop with geometry', () => {
      const code = transpileCode('for (i = [0:3]) translate([i*10, 0, 0]) cube(5);')
      expect(code).toContain('j$.range(0, 3, 1)')
      expect(code).toContain('.map')
    })
  })

  describe('intersection_for', () => {
    it('generates intersection_for as j$.intersection of iterated bodies', () => {
      const code = transpileCode('intersection_for(i = [0:3]) rotate([0, 0, i*45]) cube(10);')
      // Must use j$.intersection, not intersection_for_$m (which would be a bug)
      expect(code).toContain('j$.intersect(')
      expect(code).not.toContain('intersection_for_$m')
      // Loop variable must appear in the map callback
      expect(code).toContain('j$.iter(')
    })
  })

  describe('if statement', () => {
    it('handles if statement', () => {
      const code = transpileCode('if (x > 0) cube(10);')
      expect(code).toContain('x > 0')
    })

    it('handles if-else statement', () => {
      const code = transpileCode('if (x > 0) cube(10); else sphere(5);')
      expect(code).toContain('j$.cube')
      expect(code).toContain('j$.sphere')
    })
  })

  describe('let statement', () => {
    it('handles let in expressions', () => {
      const code = transpileCode('x = let(a = 5) a * 2;')
      expect(code).toContain('const')
      expect(code).toContain('return')
    })

    it('handles let with dependent bindings', () => {
      const code = transpileCode('x = let(a = 1, b = a + 1) b;')
      expect(code).toContain('const')
    })
  })
})

// ============================================================================
// TYPE TESTING FUNCTIONS
// ============================================================================

describe('Type Testing Functions', () => {
  it('handles is_undef', () => {
    const code = transpileCode('x = is_undef(val);')
    expect(code).toMatch(/val\s*===?\s*undefined|typeof.*undefined/)
  })

  it('handles is_bool', () => {
    const code = transpileCode('x = is_bool(val);')
    expect(code).toContain('typeof')
    expect(code).toContain('boolean')
  })

  it('handles is_num', () => {
    const code = transpileCode('x = is_num(val);')
    expect(code).toContain('typeof')
    expect(code).toContain('number')
  })

  it('handles is_string', () => {
    const code = transpileCode('x = is_string(val);')
    expect(code).toContain('typeof')
    expect(code).toContain('string')
  })

  it('handles is_list', () => {
    const code = transpileCode('x = is_list(val);')
    expect(code).toContain('Array.isArray')
  })

  it('handles is_function', () => {
    const code = transpileCode('x = is_function(val);')
    expect(code).toContain('typeof')
    expect(code).toContain('function')
  })
})

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

describe('Utility Functions', () => {
  it('handles echo', () => {
    const code = transpileCode('echo("hello");')
    expect(code).toContain('console.log')
  })

  it('handles echo with multiple args', () => {
    const code = transpileCode('echo("x=", x, "y=", y);')
    expect(code).toContain('console.log')
  })

  it('handles assert', () => {
    const code = transpileCode('assert(x > 0, "x must be positive");')
    expect(code).toContain('assert')
  })

  it('handles children() with no args', () => {
    const code = transpileCode('module wrapper() { children(); }')
    expect(code).toContain('_children')
  })

  it('handles children(i)', () => {
    const code = transpileCode('module wrapper() { children(0); }')
    expect(code).toContain('_children[0]')
  })
})

// ============================================================================
// STRING FUNCTIONS
// ============================================================================

describe('String Functions', () => {
  it('handles str()', () => {
    const code = transpileCode('x = str("value: ", 42);')
    expect(code).toContain('j$.str')
  })

  it('handles chr()', () => {
    const code = transpileCode('x = chr(65);')
    // chr() provided by runtime
    expect(code).toContain('j$.chr(65)')
  })

  it('handles ord()', () => {
    const code = transpileCode('x = ord("A");')
    // ord() provided by runtime
    expect(code).toContain('j$.ord')
  })
})

// ============================================================================
// MATHEMATICAL FUNCTIONS
// ============================================================================

describe('Mathematical Functions', () => {
  describe('Basic Math', () => {
    it('handles abs', () => {
      expect(transpileCode('x = abs(-5);')).toContain('Math.abs')
    })

    it('handles sign', () => {
      expect(transpileCode('x = sign(-5);')).toContain('Math.sign')
    })

    it('handles sqrt', () => {
      expect(transpileCode('x = sqrt(16);')).toContain('Math.sqrt')
    })

    it('handles pow', () => {
      expect(transpileCode('x = pow(2, 3);')).toContain('Math.pow')
    })

    it('handles exp', () => {
      expect(transpileCode('x = exp(1);')).toContain('Math.exp')
    })

    it('handles ln', () => {
      expect(transpileCode('x = ln(10);')).toContain('Math.log')
    })

    it('handles log (base 10)', () => {
      // OpenSCAD log() is log base 10, ln() is natural log
      const code = transpileCode('x = log(10);')
      expect(code).toContain('Math.log10')
    })
  })

  describe('Trigonometric', () => {
    it('handles sin (degrees)', () => {
      const code = transpileCode('x = sin(90);')
      expect(code).toContain('sinDeg')
    })

    it('handles cos (degrees)', () => {
      const code = transpileCode('x = cos(0);')
      expect(code).toContain('cosDeg')
    })

    it('handles tan (degrees)', () => {
      const code = transpileCode('x = tan(45);')
      expect(code).toContain('tanDeg')
    })

    it('handles asin (returns degrees)', () => {
      const code = transpileCode('x = asin(1);')
      expect(code).toContain('Math.asin')
    })

    it('handles acos (returns degrees)', () => {
      const code = transpileCode('x = acos(0);')
      expect(code).toContain('Math.acos')
    })

    it('handles atan (returns degrees)', () => {
      const code = transpileCode('x = atan(1);')
      expect(code).toContain('Math.atan')
    })

    it('handles atan2 (returns degrees)', () => {
      const code = transpileCode('x = atan2(1, 1);')
      expect(code).toContain('Math.atan2')
    })
  })

  describe('Rounding', () => {
    it('handles floor', () => {
      expect(transpileCode('x = floor(3.7);')).toContain('Math.floor')
    })

    it('handles round', () => {
      expect(transpileCode('x = round(3.5);')).toContain('Math.round')
    })

    it('handles ceil', () => {
      expect(transpileCode('x = ceil(3.2);')).toContain('Math.ceil')
    })
  })

  describe('List/Vector Operations', () => {
    it('handles len', () => {
      const code = transpileCode('x = len([1,2,3]);')
      expect(code).toContain('?.length')
    })

    it('len uses optional chaining so len(undef) returns undef, not TypeError', () => {
      // In OpenSCAD, len(undef) == undef. In JS, undefined.length throws.
      // Must use ?. to avoid TypeError in patterns like: let(n=hashmap_get(...)) len(n)
      const code = transpileCode('x = len([1,2,3]);')
      expect(code).toContain('?.length')
      expect(code).not.toMatch(/\)\s*\.length/)
    })

    it('handles concat', () => {
      expect(transpileCode('x = concat([1], [2]);')).toContain('concat')
    })

    it('handles min', () => {
      const code = transpileCode('x = min(1, 2, 3);')
      expect(code).toContain('j$.min')
    })

    it('handles max', () => {
      const code = transpileCode('x = max(1, 2, 3);')
      expect(code).toContain('j$.max')
    })

    it('handles norm (vector magnitude)', () => {
      const code = transpileCode('x = norm([3, 4]);')
      expect(code).toContain('j$.norm')
    })

    it('handles cross (cross product)', () => {
      const code = transpileCode('x = cross([1,0,0], [0,1,0]);')
      expect(code).toContain('j$.cross')
    })
  })

  describe('Search and Lookup', () => {
    it('handles search', () => {
      const code = transpileCode('x = search("a", ["a", "b", "c"]);')
      expect(code).toContain('j$.search')
    })

    it('handles lookup', () => {
      const code = transpileCode('x = lookup(1.5, [[0, 0], [1, 10], [2, 20]]);')
      expect(code).toContain('j$.lookup')
    })
  })

  describe('Random', () => {
    it('handles rands', () => {
      const code = transpileCode('x = rands(0, 10, 5);')
      expect(code).toContain('j$.rands')
    })
  })
})

// ============================================================================
// EXTRUSIONS
// ============================================================================

describe('Extrusions', () => {
  it('generates linear_extrude', () => {
    const code = transpileCode('linear_extrude(height=10) circle(r=5);')
    expect(code).toContain('j$.linearExtrude')
  })

  it('generates linear_extrude with twist', () => {
    const code = transpileCode('linear_extrude(height=10, twist=90) square(5);')
    expect(code).toContain('twist')
  })

  it('generates rotate_extrude', () => {
    const code = transpileCode('rotate_extrude() translate([10, 0]) circle(r=2);')
    expect(code).toContain('j$.rotateExtrude')
  })

  it('generates rotate_extrude with angle', () => {
    const code = transpileCode('rotate_extrude(angle=180) translate([10, 0]) circle(r=2);')
    expect(code).toContain('j$.rotateExtrude')
  })
})

// ============================================================================
// INCLUDE/USE STATEMENTS
// ============================================================================

describe('Include/Use Statements', () => {
  it('handles include statement', () => {
    // Just verify it parses without error
    const { errors } = parse('include <other.scad>')
    expect(errors).toHaveLength(0)
    // Note: actual include resolution requires fileResolver
  })

  it('handles use statement', () => {
    const { errors } = parse('use <library.scad>')
    expect(errors).toHaveLength(0)
  })
})

// ============================================================================
// MODIFIER CHARACTERS
// ============================================================================

describe('Modifier Characters', () => {
  it('handles * (disable)', () => {
    // * prefix disables the subtree (renders nothing)
    const { errors } = parse('*cube(10);')
    expect(errors).toHaveLength(0)
  })

  it('handles ! (show only)', () => {
    const { errors } = parse('!cube(10);')
    expect(errors).toHaveLength(0)
  })

  it('handles # (debug/highlight)', () => {
    const { errors } = parse('#cube(10);')
    expect(errors).toHaveLength(0)
  })

  it('handles % (transparent/background)', () => {
    const { errors } = parse('%cube(10);')
    expect(errors).toHaveLength(0)
  })
})
