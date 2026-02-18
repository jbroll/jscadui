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

Must be called once before any `text2d()` calls, passing your JSCAD modeling instance.

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

Built-in font names resolve to Google Fonts CDN URLs:

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
resolveFont('Liberation Sans')  // → 'https://fonts.gstatic.com/...'
resolveFont('Liberation Sans:style=Bold')  // → bold variant URL
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
