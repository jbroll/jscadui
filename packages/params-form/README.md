# @jscadui/params

Reference implementation of a JSCAD params form in vanilla JS: renders
parameter definitions (sliders, choices, colors, etc.) into a DOM element and
wires up the reset/save/load/edit/link buttons.

```js
import { genParams } from '@jscadui/params'

genParams({
  params: parameterDefinitions,
  target: document.getElementById('params'),
  callback: (values) => rebuildModel(values),
})
```

Also exports the DOM helpers it is built on: `querySelector`, `forQS`,
`forEachInput`, `forEachGroup`, `forEachButton`.
