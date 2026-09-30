# @jscadui/jscad-text

Text rendering for JSCAD with OpenSCAD-compatible semantics. Produces filled 2D geometry (`geom2`) that can be extruded, offset, and used in boolean operations.

## Features

- **Hershey stroke font** — built-in, no network needed, strokes expanded to filled outlines
- **TTF/OTF fonts** — loaded via opentype.js; synchronous in Web Workers (sync XHR) and Node.js (readFileSync), or from ArrayBuffer/Uint8Array directly
- **OpenSCAD `text()` parameter parity** — `size`, `font`, `halign`, `valign`, `spacing`, `direction`
- **Kerning** — applied for TTF fonts
- **Multi-line text** — `\n` splits lines, controlled by `lineSpacing`
- **Font map** — resolve font names like `"Liberation Sans"` or `"Roboto:style=Bold"` to CDN URLs

## Installation

```bash
npm install @jscadui/jscad-text
```

Requires `@jscad/modeling` as a peer dependency.

## Quick start

```javascript
import jscad from '@jscad/modeling'
import { init, text2d } from '@jscadui/jscad-text'

init(jscad)

// Hershey font (default) — synchronous, no network needed
const geom = text2d('Hello', { size: 10 })

// TTF font from file path (Node.js) — synchronous via readFileSync
const geom = text2d('Hello', { font: '/usr/share/fonts/TTF/DejaVuSans.ttf', size: 10 })

// TTF font from URL (browser Web Worker) — synchronous via sync XHR
const geom = text2d('Hello', { font: 'https://example.com/Font.ttf', size: 10 })

// TTF font from ArrayBuffer — always synchronous
const geom = text2d('Hello', { font: someArrayBuffer, size: 10 })

// Extrude to 3D
const solid = jscad.extrusions.extrudeLinear({ height: 5 }, geom)
```

## API

### `init(jscad)`

Must be called once before any `text2d()` calls, passing your JSCAD modeling
instance. Model code run by the jscad-web frame or the agent-loop eval needs
none: they call it with the `@jscad/modeling` they serve, and a model's own
call is harmless.

### `text2d(text, options?)`  /  `text2d(options)`

Returns a `geom2` (or `null` for empty text).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `text` | `string` | `''` | Text to render (or first argument) |
| `size` | `number` | `10` | Cap height in user units |
| `font` | `string \| ArrayBuffer \| Uint8Array` | — | Font specifier (see below). Omit for Hershey. |
| `halign` | `'left' \| 'center' \| 'right'` | `'left'` | Horizontal alignment |
| `valign` | `'baseline' \| 'top' \| 'center' \| 'bottom'` | `'baseline'` | Vertical alignment |
| `spacing` | `number` | `1` | Character spacing multiplier |
| `direction` | `'ltr' \| 'rtl'` | `'ltr'` | Text direction |
| `$fn` | `number` | `32` | Bézier tessellation quality (TTF only) |
| `strokeWidth` | `number` | `size * 0.12` | Hershey stroke width |

### `text2dAsync(text, options?)`

Async version — useful for Node.js HTTP URLs which cannot be loaded synchronously. Pre-loads the font via `fetch` or `fs.readFile`, caches it, then renders synchronously.

```javascript
// Node.js HTTP URL — must use async path
const geom = await text2dAsync('Hello', {
  font: 'https://example.com/Font.ttf',
  size: 10,
})
```

### `registerFontFile(bytes)`

Parses a TTF/OTF file (`Uint8Array` or `ArrayBuffer`) once and adds it to the font map under `Family` and `Family:style=Style`, taken from the font's own English names (typographic family and subfamily when present). A registered font replaces a built-in entry of the same name. Returns the keys it registered.

```javascript
registerFontFile(bytes)  // → ['Liberation Sans', 'Liberation Sans:style=Regular']
text2d('Hi', { font: 'Liberation Sans:style=Regular' })
```

### `saveState()`, `restoreState(state)`, `reset()`

For a host that runs one model after another in the same module instance.
`reset()` forgets `init` and every font registered at run time, leaving the
static font map; `saveState()` and `restoreState()` keep and put back what a
model set up. Parsed fonts stay cached across them. The jscad-web frame and
the agent-loop eval reset and then `init` before each model load, so every
model starts from the same state whatever ran before it.

## Font specifier

The `font` option accepts:

| Value | Behavior |
|-------|----------|
| Omitted / `undefined` | Use Hershey simplex (built-in) |
| Font name string | Looked up in font map (e.g. `"Liberation Sans"`, `"Roboto:style=Bold"`) |
| URL string (`http://`, `https://`, `file://`) | Loaded directly; sync XHR in browser workers, async in Node.js |
| File path string | `opentype.loadSync()` → `readFileSync` (Node.js only) |
| `ArrayBuffer` / `Buffer` / `Uint8Array` | Parsed directly (always synchronous) |

## Font map

Built-in font names (`STATIC_FONT_MAP`) resolve to jsDelivr URLs of pinned
TypoPRO npm packages (`@typopro/dtp-liberation@3.7.5`, `dtp-roboto`,
`dtp-noto`, ...). In Node, `Liberation Sans` resolves to the bundled
`src/fonts/data/LiberationSans-Regular.ttf`. An unknown name throws, listing
each family with its styles (`fontList`).

```javascript
import { resolveFont, registerFonts, listFonts } from '@jscadui/jscad-text'

// List available font families
listFonts()
// → ['Liberation Sans', 'Roboto', 'Noto Sans', 'Open Sans', ...]

// Register custom fonts
registerFonts({
  'My Font': 'https://example.com/MyFont.ttf',
  'My Font:style=Bold': 'https://example.com/MyFont-Bold.ttf',
})

// Resolve name → URL
resolveFont('Liberation Sans:style=Bold')
// → 'https://cdn.jsdelivr.net/npm/@typopro/dtp-liberation@3.7.5/TypoPRO-LiberationSans-Bold.ttf'
```

Node cannot load a URL synchronously, so `@jscadui/jscad-text/fontCache`
registers local copies of the map's URLs:

```javascript
import { registerInstalledFonts, ensureLiberationFonts } from '@jscadui/jscad-text/fontCache'

// Every map font, from the @typopro packages in node_modules (no network)
registerInstalledFonts(import.meta.url)  // → { registered: [...urls], missing: [] }

// The Liberation fonts only, downloaded once to ~/.cache/jscadui/fonts/
await ensureLiberationFonts()
```

## Font loading in detail

```
Browser Web Worker + URL  →  sync XHR (xhr.open(url, false))   — synchronous
Browser Web Worker + path →  sync XHR (treated as URL)          — synchronous
Node.js + file path       →  opentype.loadSync() / readFileSync  — synchronous
Node.js + HTTP URL        →  must use text2dAsync() or fontLoader.load(url) first
ArrayBuffer / Uint8Array  →  opentype.parse() directly           — synchronous
```

## Low-level API

```javascript
import { fontLoader, TTFFont, TTFLoader, computeValignOffset } from '@jscadui/jscad-text'

// Pre-load a font (useful for Node.js HTTP URLs)
const font = await fontLoader.load('https://example.com/Font.ttf')

// Load synchronously (file path or ArrayBuffer)
const font = fontLoader.loadSync('/path/to/font.ttf')

// Font metrics and layout
const layout = font.layoutText('Hello', { size: 10, halign: 'center', $fn: 32 })
```
