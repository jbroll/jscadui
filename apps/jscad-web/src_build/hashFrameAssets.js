import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

/**
 * Content-hash JS bundles so the 1-year-cached assets bust on every change
 * and deploys actually reach returning browsers. index.html stays unhashed
 * (served no-cache) and is rewritten to point at the hashed entry file.
 *
 * Same topological order as the app: leaf bundles → worker
 * (importScripts the hashed leaves) → frame.js (bundle URLs + worker URL) →
 * index.html. Hashing in dependency order means a change in any leaf flows
 * up into frame.js's hash, so index.html (always fresh) points at a
 * fully-current graph.
 */
export function hashFrameAssets(outDir) {
  const buildDir = join(outDir, 'assets')
  const map = {}  // logical basename → hashed basename
  const h8 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 8)

  // Rewrite refs to already-hashed deps (longest first to avoid partial matches),
  // then hash the (rewritten) content and rename the file.
  const hashFile = (dir, name) => {
    const p = join(dir, name)
    if (!existsSync(p)) return null
    let s = readFileSync(p, 'utf8')
    for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
      if (s.includes(from)) s = s.split(from).join(map[from])
    }
    const hashed = name.replace(/\.(js|css)$/, (_, ext) => `.${h8(s)}.${ext}`)
    writeFileSync(p, s)
    renameSync(p, join(dir, hashed))
    map[name] = hashed
    return hashed
  }

  // 1. Leaf bundles (everything in assets/ except the worker, which imports leaves).
  for (const f of readdirSync(buildDir)) {
    if (f.endsWith('.js') && f !== 'bundle.frame-worker.js') hashFile(buildDir, f)
  }
  // 2. Worker (importScripts the hashed transform-babel + openscad bundles).
  hashFile(buildDir, 'bundle.frame-worker.js')
  // 3. frame.js (references every hashed bundle, incl. the worker).
  hashFile(outDir, 'frame.js')

  // 4. index.html — rewrite to hashed entry; do NOT hash (served no-cache).
  const idx = join(outDir, 'index.html')
  if (existsSync(idx)) {
    let html = readFileSync(idx, 'utf8')
    if (map['frame.js']) html = html.split('frame.js').join(map['frame.js'])
    writeFileSync(idx, html)
  }

  console.log(`hashed ${Object.keys(map).length} assets`)
}
