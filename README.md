[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
If you want to discuss jscad or jscadui you can also join us on discord: https://discord.gg/6PB7qZ4HC7


# usable bits

Most of the things are work in progres, but some parts are pretty ready to be used

- [file-format/3mf-export](./file-format/3mf-export) - [![npm version](https://badge.fury.io/js/@jscadui%2F3mf-export.svg)](https://www.npmjs.com/package/@jscadui%2F3mf-export) 3mf-export (also used by manifold)
- [packages/html-gizmo](./packages/html-gizmo) - [![npm version](https://badge.fury.io/js/@jscadui%2Fhtml-gizmo.svg)](https://www.npmjs.com/package/@jscadui%2Fhtml-gizmo) a gizmo to display current camera direction
- [packages/orbit](./packages/orbit) - [![npm version](https://badge.fury.io/js/@jscadui%2Forbit.svg)](https://www.npmjs.com/package/@jscadui%2Forbit) orbit controls for css and multiple 3d engines, also for use in jscad
- [packages/postmessage](./packages/postmessage) - [![npm version](https://badge.fury.io/js/@jscadui%2Fpostmessage.svg)](https://www.npmjs.com/package/@jscadui%2Fpostmessage) postMessage quality of life improvement

# jscad.app prototype
- [apps/jscad-web](apps/jscad-web) - code for  [jscad.app](https://jscad.app) . It is a nice demo and our attempt at making a an improved version of [openjscad.xyz](https://openjscad.xyz).
- other example apps are much work in progress, you can try them out but they may or may not even work

## Improvements
Things that work better in jscad.app than openjscad.xyz
 - [x] can run remote scripts that import stuff. works on [jscad.app](https://jscad.app/#https://raw.githubusercontent.com/jscad/OpenJSCAD.org/master/packages/examples/import/STLImport/index.js) but not on [openjscad.xyz](https://openjscad.xyz/#https://raw.githubusercontent.com/jscad/OpenJSCAD.org/master/packages/examples/import/STLImport/index.js)
 - [x] can run scripts that use npm packages (pulls the deps from unkpg)
 - [x] can run es6 modules code
 - [x] can run typescript
 - [x] can run mixed typescript js+require, js+import
 - [x] worker instance is preserved, so caching optimizations are possible between parameter changes

aim is also to simplify integrating worker in other projects

# Hierarchical Parameters

jscadui supports a new hierarchical parameter system that allows complex models to define parameters inline within the code, organized in a tree structure. This system is **fully backwards compatible** with the traditional `getParameterDefinitions()` approach.

## Quick Example

```javascript
const wheel = (params) => {
  params._type = 'Wheel'

  // Parameters are defined inline with rich UI hints
  params.radius = { type: 'slider', default: 3, min: 1, max: 8, step: 0.5, caption: 'Tire Radius' }
  params.color = { type: 'color', default: '#333333', caption: 'Tire Color' }
  params.style = {
    type: 'choice',
    default: 'solid',
    values: ['solid', 'spoked', 'sport'],
    captions: ['Solid Disc', '5-Spoke', 'Sport'],
    caption: 'Wheel Style'
  }

  // Use the values directly
  return cylinder({ radius: params.radius, height: 2 })
}

const main = (params) => {
  params._type = 'Car'

  // Link parts so changing one updates all in the group
  params.front.left._class = 'front-wheels'
  params.front.right._class = 'front-wheels'

  return [
    translate([-5, -4, 0], wheel(params.front.left)),
    translate([-5, 4, 0], wheel(params.front.right)),
  ]
}

module.exports = { main }
```

## Parameter Types

| Type | Description | Properties |
|------|-------------|------------|
| `slider` | Range slider with live preview | `min`, `max`, `step`, `live` |
| `number` | Numeric input with optional range | `min`, `max`, `step` |
| `int` | Integer input | `min`, `max`, `step` |
| `color` | Color picker with palette | `palette` (array of hex colors) |
| `choice` | Dropdown select | `values`, `captions` |
| `radio` | Radio button group | `values`, `captions` |
| `checkbox` | Boolean toggle | - |
| `text` | Text input | `size`, `maxLength`, `placeholder` |
| `date` | Date picker | `min`, `max` |
| `email`, `url`, `password` | Specialized text inputs | `size`, `maxLength`, `placeholder` |

## Defining Parameters

Parameters can be defined in two ways:

**Simple value (type inferred):**
```javascript
params.count = 5           // inferred as 'int'
params.scale = 1.5         // inferred as 'number'
params.enabled = true      // inferred as 'checkbox'
params.name = 'default'    // inferred as 'text'
```

**Definition object (explicit type and UI hints):**
```javascript
params.radius = {
  type: 'slider',
  default: 5,
  min: 1,
  max: 20,
  step: 0.5,
  caption: 'Radius',
  live: true  // update while dragging
}
```

## Class Linking

Parts can be linked so that changing a parameter on one updates all parts in the same class:

```javascript
// All wheels in 'front-wheels' class stay synchronized
params.front.left._class = 'front-wheels'
params.front.right._class = 'front-wheels'

// Rear wheels have their own class
params.rear.left._class = 'rear-wheels'
params.rear.right._class = 'rear-wheels'
```

When you change the tire color on `front.left`, it automatically updates `front.right` as well.

## Part Types

Use `_type` to label parts in the UI tree:

```javascript
const wheel = (params) => {
  params._type = 'Wheel'  // Shows as "Wheel" in the parameter tree
  // ...
}
```

## Hidden Parameters

Parameters starting with `_` are hidden from the UI but can be used for internal state:

```javascript
params._internalOffset = 5  // Not shown in UI
params.left._offset = -halfWidth  // Computed value, hidden
```

## Backwards Compatibility

The traditional `getParameterDefinitions()` approach continues to work:

```javascript
const getParameterDefinitions = () => [
  { name: 'radius', type: 'number', initial: 5, min: 1, max: 20, caption: 'Radius' },
  { name: 'height', type: 'number', initial: 10, min: 1, max: 50, caption: 'Height' },
]

const main = (params) => {
  return cylinder({ radius: params.radius, height: params.height })
}

module.exports = { main, getParameterDefinitions }
```

Both approaches can coexist in the same codebase.

## Package Structure

The hierarchical params system is split into three packages:

- **@jscadui/params-core** - Proxy system, type definitions, tree building, class linking logic
- **@jscadui/params-ui** - Input components (slider, color picker, etc.) and tree view
- **@jscadui/params-controller** - State management for params and class operations

# About jscadui

A jscad UI playground developed here and meant to be later contributed into jscad. This way this is not limited by jscad release cycle.
 - supports: Three.js Babylon.js regl
 - implements no-dep pure js [parameters form generator](./packages/params-form/) based on jscad parameter definitions
 - allow to be easily used within React, Angular, Vue, Solidj ... or whatever is popular at some point.

## Bring more options for debugging
 - `jscadDebugger(shapes|object)` - function that can be called at any point to see intermediate results from the script
 - it will also dump it in console, but more importantly also start a parallel instance of jscad that can be used to view
   any model provided via jscadDebugger calls
 - initial `async await` idea was abandoned as it complicates things greatly, and actual debugger in the browser can be used
   to pause the script and to step through the code.
 - A second instance of jscad can be used to display any shapes needed to be seen while debugging (original instance can be frozen by debugger)
 - the debugger instance of jscad can also be further enhanced to inspect the 3d model

## Some thoughts on how to allow fastest response

- initial render may be a simple preview with progressive enhancement in background.
- global precision should be possible so preview has lower precision
- output precision should be configurable so when exporting, recalculation can be done and prepare more precise model in background
- progressive enhancement may be allowed to go to the level of precision that is for export, thus reducing wait time for export
- progressive enhancement should be stopped and restarted on script or parameter change


## Some houghts on parallelizing background work

- Use of TypedArrays where possible is preferred to allow for sending data between thread with no cost
- it should be examined if regenerating model in the worker is fast enough, as sending TypedArray out removes access for the sender and coordinating who needs which data can be difficult.
- consider a hybrid approach of sending typed arrays data out, to be given back, or regenerated if needed in multiple places
- sets of boolean operations can be done in background
- Making long running operations like booleans interruptible would be ideal.
- calculating operation complexity in advance would be useful (based on precision that can affect the expected output size and amount of calculation)


##  Allowing for changes to be localized instead of recalculating everything

- to extent this can be automatic by marking output geometries with id so if it was already sent from worker to main thread sending can be skipped (and in the end likely also upload to GPU)
- much more is possible if developers are taught some best practices that allow for most performance


