import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

/**
 * Content-hash JS/CSS bundles so the 1-year-cached assets bust on every change
 * and deploys actually reach returning browsers. index.html stays unhashed
 * (served no-cache) and is rewritten to point at the hashed entry files.
 *
 * Reference graph is shallow and acyclic, so a topological pass propagates hashes:
 *   leaf bundles → worker (importScripts) → main.js (bundle URLs) → index.html.
 * Hashing in dependency order means a change in any leaf flows up into main.js's
 * hash, so index.html (always fresh) points at a fully-current graph.
 */
export function hashAssets(outDir) {
  const buildDir = join(outDir, 'build')
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

  // 1. Leaf bundles (everything in build/ except the worker, which imports leaves).
  for (const f of readdirSync(buildDir)) {
    if (f.endsWith('.js') && f !== 'bundle.worker.js') hashFile(buildDir, f)
  }
  // 2. Worker (importScripts the hashed transform-babel + openscad bundles).
  hashFile(buildDir, 'bundle.worker.js')
  // 3. main.css (leaf, referenced only by index.html).
  hashFile(outDir, 'main.css')
  // 4. main.js (references every hashed bundle, incl. the worker).
  hashFile(outDir, 'main.js')

  // 5. index.html — rewrite to hashed entries; do NOT hash (served no-cache).
  const idx = join(outDir, 'index.html')
  if (existsSync(idx)) {
    let html = readFileSync(idx, 'utf8')
    for (const from of ['main.js', 'main.css']) {
      if (map[from]) html = html.split(from).join(map[from])
    }
    writeFileSync(idx, html)
  }

  console.log(`hashed ${Object.keys(map).length} assets`)
}
