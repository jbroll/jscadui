# Click-to-Source Feature Design Document

## Overview

Enable users to click on any geometry in the 3D viewport and navigate to the source code location where that geometry was constructed.

## Architecture

### Data Flow

```
User Script
    ↓ (Babel transform injects source locations as literals)
JSCAD Primitives with __source metadata
    ↓ (primitives attach metadata to CSG objects)
CSG Objects with sourceInfo property
    ↓ (format-jscad preserves metadata)
JscadMeshEntity with sourceInfo field
    ↓ (format-threejs copies to mesh)
Three.js Mesh with userData.sourceInfo
    ↓ (raycaster picks mesh on click)
Editor opens at file:line:column
```

### Components to Modify

**1. packages/transform-babel**
- New Babel plugin that visits CallExpression nodes
- Identifies JSCAD primitive calls (cube, sphere, cylinder, etc.)
- Injects `__source: {file, line, column}` into the options argument using AST node's existing `loc` property
- Registered alongside existing plugins in transform pipeline

**2. JSCAD Primitive Wrappers**
- Intercept or wrap primitive functions from @jscad/modeling
- Extract `__source` from options before passing to underlying primitive
- Attach sourceInfo to the returned CSG geometry object

**3. packages/format-common**
- Extend JscadMeshEntity type with optional `sourceInfo` field
- Type definition: `{file: string, line: number, column: number}`

**4. packages/format-jscad**
- Preserve sourceInfo from input CSG object onto output entity
- No structural changes needed, just pass-through

**5. packages/format-threejs**
- Copy entity's sourceInfo to Three.js mesh's userData property

**6. packages/render-threejs**
- Add raycaster-based click handler
- Emit event or callback with clicked mesh's sourceInfo
- Handle click vs drag disambiguation (orbit controls)

**7. apps/jscad-web**
- Handle source location events from renderer
- Integration point for editor navigation (Monaco, VS Code URI scheme, or custom)

## Primitives to Instrument

All geometry-creating functions from @jscad/modeling:
- primitives: cube, sphere, cylinder, geodesicSphere, ellipsoid, roundedCuboid, roundedCylinder, torus, polyhedron
- primitives 2D: circle, ellipse, rectangle, roundedRectangle, polygon, star
- extrusions: extrudeLinear, extrudeRotate, extrudeHelical
- booleans: union, subtract, intersect (optional - tracks operation site vs operand sites)

## Design Decisions

**Source Location Granularity**: Track primitive construction site, not boolean operation sites. Users typically want to find where shapes originate, not where they're combined.

**Instanced Geometry**: When identical geometries are instanced, all instances share the same sourceInfo. Clicking any instance navigates to the shared source.

**Nested Calls**: The innermost primitive call site is captured. Helper functions that wrap primitives will show the helper's call to the primitive, not the caller of the helper.

**Performance**: Zero runtime overhead for location capture - line/column are compile-time literals injected by Babel. Only cost is slightly larger transformed source.

## Open Questions

1. Should boolean operations (union/subtract/intersect) also track source locations?
2. How to handle geometries imported from external files (STL, etc.)?
3. Editor integration strategy - Monaco API, VS Code URI scheme, or pluggable callback?
