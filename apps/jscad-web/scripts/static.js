// Shared by serve.js, the local launcher's static routes and its /api/fs reads.
import { extname, join, resolve, sep } from 'node:path'

export const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.jscad': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.scad': 'text/plain',
  '.md': 'text/markdown',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.stl': 'model/stl',
  '.obj': 'model/obj',
  '.3mf': 'model/3mf',
  '.dxf': 'image/vnd.dxf',
}

export const DEFAULT_MIME = 'application/octet-stream'

export const mimeOf = (file) => MIME[extname(file).toLowerCase()] ?? DEFAULT_MIME

/** The absolute path of rel under root, or null when it would leave root. */
export const safeJoin = (root, rel) => {
  const base = resolve(root)
  const p = resolve(join(base, rel))
  if (p !== base && !p.startsWith(base + sep)) return null
  return p
}
