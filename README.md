[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Join us on Discord: https://discord.gg/6PB7qZ4HC7

# Packages

- [@jscadui/3mf-export](./file-format/3mf-export) [![npm](https://badge.fury.io/js/@jscadui%2F3mf-export.svg)](https://www.npmjs.com/package/@jscadui%2F3mf-export) - 3MF export (also used by manifold)
- [@jscadui/html-gizmo](./packages/html-gizmo) [![npm](https://badge.fury.io/js/@jscadui%2Fhtml-gizmo.svg)](https://www.npmjs.com/package/@jscadui%2Fhtml-gizmo) - Camera direction gizmo
- [@jscadui/orbit](./packages/orbit) [![npm](https://badge.fury.io/js/@jscadui%2Forbit.svg)](https://www.npmjs.com/package/@jscadui%2Forbit) - Orbit controls for multiple 3D engines
- [@jscadui/postmessage](./packages/postmessage) [![npm](https://badge.fury.io/js/@jscadui%2Fpostmessage.svg)](https://www.npmjs.com/package/@jscadui%2Fpostmessage) - postMessage utilities

# jscad.app

[apps/jscad-web](apps/jscad-web) powers [jscad.app](https://jscad.app), an improved version of [openjscad.xyz](https://openjscad.xyz).

Features:
- Run remote scripts with imports
- Use npm packages (via unpkg)
- ES6 modules and TypeScript support
- Worker instance preserved for caching between parameter changes

# Hierarchical Parameters

jscadui supports a hierarchical parameter system that allows complex models to define parameters inline within the code, organized in a tree structure. This system is **fully backwards compatible** with the traditional `getParameterDefinitions()` approach - legacy scripts are automatically promoted to work with the new system.

## Quick Example

```javascript
const wheel = (params) => {
  params._type = 'Wheel'

  // Parameters are defined inline with rich UI hints
  params.radius = { type: 'slider', default: 3, min: 1, max: 8, step: 0.5, label: 'Tire Radius' }
  params.color = { type: 'color', default: '#333333', label: 'Tire Color' }
  params.style = {
    type: 'choice',
    default: 'solid',
    values: ['solid', 'spoked', 'sport'],
    captions: ['Solid Disc', '5-Spoke', 'Sport'],
    label: 'Wheel Style'
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

| Type | Description | Default Step |
|------|-------------|--------------|
| `slider` | Range slider with live preview | 0.1 |
| `number` | Numeric spinbox | 0.1 |
| `int` | Integer spinbox | 1 |
| `color` | Color picker | - |
| `choice` | Dropdown select | - |
| `radio` | Radio button group | - |
| `checkbox` | Boolean toggle | - |
| `text` | Text input | - |
| `date` | Date picker | - |

## Defining Parameters

**Simple value (type inferred):**
```javascript
params.count = 5           // int, step=1
params.scale = 1.5         // number, step=0.1
params.enabled = true      // checkbox
params.name = 'default'    // text
```

**Definition object:**
```javascript
params.radius = {
  type: 'slider',
  default: 5,
  min: 1,
  max: 20,
  step: 0.5,
  label: 'Radius',
  live: true
}
```

**Common properties:** `type`, `default`, `label`, `min`, `max`, `step`

**Type-specific:** `values`/`captions` (choice, radio), `palette` (color), `placeholder`/`size`/`maxLength` (text), `live` (slider)

## Special Properties

- `_type` - Labels parts in the UI tree (e.g., `params._type = 'Wheel'`)
- `_class` - Links parts so changes propagate to all in the same class
- Parameters starting with `_` are hidden from the UI

```javascript
params.front.left._class = 'front-wheels'
params.front.right._class = 'front-wheels'
// Changing tire color on front.left automatically updates front.right
```

## Backwards Compatibility

The traditional `getParameterDefinitions()` approach continues to work. Legacy scripts are automatically detected and promoted to work with the proxy system:

```javascript
const getParameterDefinitions = () => [
  { name: 'radius', type: 'float', initial: 5, min: 1, max: 20, caption: 'Radius' },
  { name: 'height', type: 'slider', initial: 10, min: 1, max: 50, caption: 'Height' },
]

const main = (params) => {
  return cylinder({ radius: params.radius, height: params.height })
}

module.exports = { main, getParameterDefinitions }
```

Legacy type mappings:
- `float` → `number`
- `caption` → `label`
- `slider`, `radio`, `choice` types are preserved for proper UI rendering

# About jscadui

A jscad UI playground developed here and meant to be later contributed into jscad. This way it is not limited by the jscad release cycle.

- Supports multiple renderers: Three.js, Babylon.js, regl
- Can be integrated with React, Angular, Vue, Solid, or other frameworks
