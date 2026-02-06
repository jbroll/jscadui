# OpenSCAD → JSCAD Translation: Implementation Plan

## 1. Objective

Create a tool that converts a defined subset of OpenSCAD into JSCAD such that:
- The generated JSCAD produces geometry equivalent to OpenSCAD output
- Translation is deterministic and repeatable
- Full OpenSCAD compatibility is not required

---

## 2. Technical Choices

### 2.1 Parser: `openscad-parser`

**Package:** [openscad-parser](https://github.com/alufers/openscad-parser) (MIT license)

**Rationale:**
- Actively maintained (last update Oct 2024)
- TypeScript-native with full type definitions
- Complete AST with visitor pattern support
- Handles error recovery for incomplete code
- Well-structured node types for statements and expressions

**AST Node Types Available:**

| Category | Nodes |
|----------|-------|
| Statements | `ModuleInstantiationStmt`, `ModuleDeclarationStmt`, `FunctionDeclarationStmt`, `BlockStmt`, `IfElseStatement`, `UseStmt`, `IncludeStmt`, `NoopStmt` |
| Expressions | `BinaryOpExpr`, `UnaryOpExpr`, `TernaryExpr`, `LiteralExpr`, `LookupExpr`, `VectorExpr`, `ArrayLookupExpr`, `RangeExpr`, `FunctionCallExpr`, `MemberLookupExpr`, `LetExpr`, `LcForExpr`, `LcIfExpr` |

### 2.2 Target: JSCAD Modeling API

```javascript
const jscad = require('@jscad/modeling')
// Namespaces: primitives, transforms, booleans, extrusions, hulls, expansions
```

---

## 3. Scope Definition (v0.1)

### 3.1 Supported Geometry

**3D Primitives:**
| OpenSCAD | JSCAD | Notes |
|----------|-------|-------|
| `cube([x,y,z])` | `cuboid({size:[x,y,z]})` | Handle `center` param |
| `cube(s)` | `cube({size:s})` | Scalar shorthand |
| `sphere(r=5)` | `sphere({radius:5})` | Map `$fn` → `segments` |
| `cylinder(h,r)` | `cylinder({height:h,radius:r})` | Handle `r1`,`r2` for cones |
| `cylinder(h,r1,r2)` | `cylinderElliptic({height,startRadius,endRadius})` | Tapered |
| `polyhedron(points,faces)` | `polyhedron({points,faces})` | Phase 2 |

**2D Primitives (Phase 2):**
| OpenSCAD | JSCAD |
|----------|-------|
| `square([x,y])` | `rectangle({size:[x,y]})` |
| `circle(r)` | `circle({radius:r})` |
| `polygon(points)` | `polygon({points})` |

### 3.2 Supported Transforms

| OpenSCAD | JSCAD | Notes |
|----------|-------|-------|
| `translate([x,y,z])` | `translate([x,y,z], geom)` | |
| `rotate([x,y,z])` | `rotateX/Y/Z(rad, geom)` | Convert degrees→radians |
| `rotate(a, [x,y,z])` | Axis-angle rotation | Use rotation matrix |
| `scale([x,y,z])` | `scale([x,y,z], geom)` | |
| `mirror([x,y,z])` | `mirror({normal:[x,y,z]}, geom)` | |
| `multmatrix(m)` | `transform(mat4, geom)` | Phase 2 |

### 3.3 Supported Boolean Operations

| OpenSCAD | JSCAD |
|----------|-------|
| `union()` | `union(...children)` |
| `difference()` | `subtract(first, ...rest)` |
| `intersection()` | `intersect(...children)` |
| `minkowski()` | Custom implementation or `expand` approximation |
| `hull()` | `hull(...children)` |

### 3.4 Supported Extrusions (Phase 2)

| OpenSCAD | JSCAD |
|----------|-------|
| `linear_extrude(height)` | `extrudeLinear({height}, geom2d)` |
| `rotate_extrude(angle)` | `extrudeRotate({angle}, geom2d)` |

### 3.5 Language Constructs

| Feature | Support |
|---------|---------|
| Blocks `{ ... }` | ✅ Full |
| Module definitions | ✅ Full |
| Module calls | ✅ Full |
| Function definitions | ✅ Full |
| Function calls | ✅ Full |
| Variables | ✅ Full |
| `for` loops | ✅ Full |
| `if`/`else` | ✅ Full |
| List comprehensions | ⚠️ Phase 2 |
| `let` expressions | ⚠️ Phase 2 |
| `include`/`use` | ⚠️ Phase 2 |

### 3.6 Special Variables

| OpenSCAD | JSCAD Mapping | Default |
|----------|---------------|---------|
| `$fn` | `segments` parameter | 32 |
| `$fa` | Ignored (use `$fn`) | - |
| `$fs` | Ignored (use `$fn`) | - |
| `$t` | Animation parameter | 0 |
| `$children` | `children.length` | - |

---

## 4. Geometry IR (Intermediate Representation)

### 4.1 TypeScript Type Definitions

```typescript
// Base node interface
interface IRNode {
  type: string;
  loc?: SourceLocation;
}

// Primitives
interface IRPrimitive extends IRNode {
  type: 'primitive';
  primitive: 'cube' | 'sphere' | 'cylinder' | 'polyhedron' |
             'square' | 'circle' | 'polygon';
  params: Record<string, IRValue>;
}

// Transforms
interface IRTransform extends IRNode {
  type: 'transform';
  transform: 'translate' | 'rotate' | 'scale' | 'mirror' | 'multmatrix';
  params: Record<string, IRValue>;
  children: IRNode[];
}

// Boolean operations
interface IRBoolean extends IRNode {
  type: 'boolean';
  operation: 'union' | 'difference' | 'intersection';
  children: IRNode[];
}

// Hull operation
interface IRHull extends IRNode {
  type: 'hull';
  children: IRNode[];
}

// Minkowski operation
interface IRMinkowski extends IRNode {
  type: 'minkowski';
  children: IRNode[];
}

// Extrusions
interface IRExtrusion extends IRNode {
  type: 'extrusion';
  operation: 'linear_extrude' | 'rotate_extrude';
  params: Record<string, IRValue>;
  children: IRNode[];
}

// Module definition (stored, not emitted directly)
interface IRModuleDef {
  name: string;
  params: IRParamDef[];
  body: IRNode[];
}

// Module call (resolved to children during evaluation)
interface IRModuleCall extends IRNode {
  type: 'module_call';
  name: string;
  args: Record<string, IRValue>;
  children: IRNode[];  // For modules that use children()
}

// Scope/Group (implicit union)
interface IRGroup extends IRNode {
  type: 'group';
  children: IRNode[];
}

// Color
interface IRColor extends IRNode {
  type: 'color';
  color: [number, number, number, number]; // RGBA 0-1
  children: IRNode[];
}

// Values
type IRValue =
  | number
  | boolean
  | string
  | IRValue[]
  | IRRange
  | undefined;

interface IRRange {
  type: 'range';
  start: number;
  end: number;
  step?: number;
}

interface IRParamDef {
  name: string;
  default?: IRValue;
}

interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}
```

### 4.2 IR Examples

**Input:**
```openscad
cube();
sphere();
```

**IR:**
```json
{
  "type": "group",
  "children": [
    { "type": "primitive", "primitive": "cube", "params": {} },
    { "type": "primitive", "primitive": "sphere", "params": {} }
  ]
}
```

**Input:**
```openscad
difference() {
  cube(10);
  translate([5,5,5]) sphere(3);
}
```

**IR:**
```json
{
  "type": "boolean",
  "operation": "difference",
  "children": [
    { "type": "primitive", "primitive": "cube", "params": { "size": 10 } },
    {
      "type": "transform",
      "transform": "translate",
      "params": { "v": [5, 5, 5] },
      "children": [
        { "type": "primitive", "primitive": "sphere", "params": { "radius": 3 } }
      ]
    }
  ]
}
```

---

## 5. Architecture

### 5.1 Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   OpenSCAD   │───▶│    Parser    │───▶│  Evaluator   │───▶│   Emitter    │
│    Source    │    │  (AST Gen)   │    │  (IR Gen)    │    │  (JSCAD)     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                    openscad-parser      Geometry IR         JSCAD Code
                         AST              (JSON)              (string)
```

### 5.2 Package Structure

```
packages/openscad/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                 # Public API exports
│   ├── translate.ts             # Main entry: scadToJscad(source) → string
│   │
│   ├── parser/
│   │   └── parse.ts             # Wraps openscad-parser
│   │
│   ├── evaluator/
│   │   ├── evaluate.ts          # AST → IR conversion
│   │   ├── scope.ts             # Variable/module scope management
│   │   ├── builtins.ts          # Built-in modules (cube, sphere, etc.)
│   │   └── expressions.ts       # Expression evaluation
│   │
│   ├── ir/
│   │   ├── types.ts             # IR TypeScript definitions
│   │   ├── optimize.ts          # IR optimizations (flatten unions, etc.)
│   │   └── validate.ts          # IR validation
│   │
│   ├── emitter/
│   │   ├── emit.ts              # IR → JSCAD code generation
│   │   ├── primitives.ts        # Primitive emission helpers
│   │   ├── transforms.ts        # Transform emission helpers
│   │   └── format.ts            # Code formatting/pretty-print
│   │
│   └── utils/
│       ├── angles.ts            # Degree/radian conversion
│       └── errors.ts            # Error types and handling
│
├── test/
│   ├── parser.test.ts
│   ├── evaluator.test.ts
│   ├── emitter.test.ts
│   ├── e2e.test.ts              # Full translation tests
│   └── fixtures/
│       ├── primitives/
│       │   ├── cube.scad
│       │   ├── cube.expected.js
│       │   └── ...
│       ├── transforms/
│       ├── booleans/
│       └── modules/
│
└── examples/
    ├── simple.scad
    └── complex.scad
```

### 5.3 Public API

```typescript
// Main translation function
export function scadToJscad(source: string, options?: TranslateOptions): string;

// Options
interface TranslateOptions {
  // Default segments for curves (maps to $fn)
  defaultSegments?: number;  // default: 32

  // Include source comments in output
  includeComments?: boolean; // default: false

  // Pretty-print output
  format?: boolean;          // default: true

  // Indent string
  indent?: string;           // default: '  '
}

// Parse only (returns IR)
export function parse(source: string): IRNode;

// Emit only (IR to JSCAD)
export function emit(ir: IRNode, options?: EmitOptions): string;

// Validation
export function validate(ir: IRNode): ValidationResult;
```

---

## 6. Translation Rules

### 6.1 Implicit Union

Sibling geometry statements are wrapped in a union:

```openscad
cube();
sphere();
```

→

```javascript
const { cube, sphere } = jscad.primitives
const { union } = jscad.booleans

const main = () => {
  return union(
    cube(),
    sphere()
  )
}
module.exports = { main }
```

### 6.2 Transform Scoping

Transforms wrap their children:

```openscad
translate([10, 0, 0]) {
  cube();
  sphere();
}
```

→

```javascript
translate([10, 0, 0],
  union(
    cube(),
    sphere()
  )
)
```

### 6.3 Boolean Operations

```openscad
difference() {
  cube(10);
  sphere(5);
}
```

→

```javascript
subtract(
  cube({ size: 10 }),
  sphere({ radius: 5 })
)
```

### 6.4 Rotation (Degrees to Radians)

```openscad
rotate([45, 0, 90]) cube();
```

→

```javascript
const { degToRad } = jscad.utils

rotateZ(degToRad(90),
  rotateX(degToRad(45),
    cube()
  )
)
```

### 6.5 Modules

```openscad
module box(size = 10) {
  cube(size);
}
box(20);
```

→

```javascript
const box = (size = 10) => {
  return cube({ size })
}

const main = () => {
  return box(20)
}
```

### 6.6 For Loops

```openscad
for (i = [0:4]) {
  translate([i * 10, 0, 0]) cube();
}
```

→

```javascript
union(
  ...Array.from({ length: 5 }, (_, i) =>
    translate([i * 10, 0, 0], cube())
  )
)
```

### 6.7 Conditionals

```openscad
if (x > 5) {
  cube();
} else {
  sphere();
}
```

→

```javascript
x > 5 ? cube() : sphere()
```

### 6.8 Children

```openscad
module double() {
  children();
  translate([10, 0, 0]) children();
}
double() cube();
```

→

```javascript
const double = (...children) => {
  return union(
    ...children,
    translate([10, 0, 0], ...children)
  )
}

const main = () => {
  return double(cube())
}
```

---

## 7. Implementation Phases

### Phase 1: Core (MVP)

1. **Parser integration** - Wrap openscad-parser, handle errors
2. **Basic evaluator** - Literals, vectors, arithmetic
3. **3D primitives** - cube, sphere, cylinder
4. **Transforms** - translate, rotate, scale, mirror
5. **Booleans** - union, difference, intersection
6. **Implicit union** - Group sibling geometry
7. **Basic emitter** - Generate valid JSCAD code
8. **Test harness** - Fixture-based testing

**Deliverable:** Translate simple .scad files with primitives, transforms, booleans.

### Phase 2: Language Features

1. **Variables** - Assignment and lookup
2. **Modules** - Definition and invocation
3. **Functions** - Definition and invocation
4. **For loops** - Range iteration
5. **If/else** - Conditional geometry
6. **children()** - Module children support
7. **Special variables** - $fn, $t

**Deliverable:** Translate parametric .scad files with modules.

### Phase 3: Extended Features

1. **2D primitives** - square, circle, polygon
2. **Extrusions** - linear_extrude, rotate_extrude
3. **Hull** - Convex hull operation
4. **Minkowski** - Sum operation
5. **Color** - color() modifier
6. **List comprehensions** - [for (...) ...]
7. **Let expressions** - let() { }

**Deliverable:** Translate complex .scad files with 2D and advanced features.

### Phase 4: Ecosystem

1. **include/use** - File imports
2. **MCAD library** - Common library stubs
3. **Error messages** - User-friendly diagnostics
4. **Source maps** - Debug support
5. **CLI tool** - `scad2jscad` command
6. **Web integration** - Works in browser

**Deliverable:** Production-ready translator.

---

## 8. Validation & Testing

### 8.1 Test Categories

| Category | Description |
|----------|-------------|
| Unit | Individual functions (parse, evaluate, emit) |
| Integration | Full translation pipeline |
| Fixture | Input .scad + expected .js output |
| Visual | Render comparison (manual) |

### 8.2 Fixture Format

```
test/fixtures/primitives/cube-centered.scad
test/fixtures/primitives/cube-centered.expected.js
```

### 8.3 Test Corpus (Phase 1)

- `cube.scad` - Basic cube
- `cube-size.scad` - Cube with size parameter
- `cube-centered.scad` - Cube with center=true
- `sphere.scad` - Basic sphere
- `sphere-fn.scad` - Sphere with $fn
- `cylinder.scad` - Basic cylinder
- `cylinder-cone.scad` - Cylinder with r1/r2
- `translate.scad` - Translation
- `rotate.scad` - Rotation (degrees)
- `scale.scad` - Scaling
- `mirror.scad` - Mirroring
- `union.scad` - Explicit union
- `difference.scad` - Difference operation
- `intersection.scad` - Intersection operation
- `implicit-union.scad` - Multiple primitives
- `nested-transforms.scad` - Nested translate/rotate

---

## 9. Error Handling

### 9.1 Error Types

```typescript
class TranslationError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public location?: SourceLocation
  ) {
    super(message);
  }
}

enum ErrorCode {
  PARSE_ERROR = 'PARSE_ERROR',
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
  UNDEFINED_VARIABLE = 'UNDEFINED_VARIABLE',
  UNDEFINED_MODULE = 'UNDEFINED_MODULE',
  TYPE_ERROR = 'TYPE_ERROR',
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
}
```

### 9.2 Graceful Degradation

- Unknown modules → Warning + skip (don't fail entire file)
- Unknown functions → Error with suggestion
- Unsupported features → Clear error with feature name

---

## 10. Dependencies

```json
{
  "dependencies": {
    "openscad-parser": "^0.6.3"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "@jscad/modeling": "^2.0.0"
  }
}
```

---

## 11. Success Criteria

### Phase 1 Complete When:
- [ ] 15+ test fixtures passing
- [ ] All 3D primitives working
- [ ] All transforms working
- [ ] All boolean operations working
- [ ] Generated JSCAD executes without errors

### Phase 2 Complete When:
- [ ] Modules with parameters working
- [ ] For loops working
- [ ] Conditionals working
- [ ] children() support working
- [ ] 30+ test fixtures passing

### Full Release When:
- [ ] 50+ test fixtures passing
- [ ] Real-world .scad files from Thingiverse translate
- [ ] Documentation complete
- [ ] CLI tool working
- [ ] Integrated with jscad-web app
