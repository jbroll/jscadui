import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, join } from 'path'

/**
 * Content-hash JS/CSS bundles so the 1-year-cached assets bust on every change
 * and deploys actually reach returning browsers. index.html stays unhashed
 * (served no-cache) and is rewritten to point at the hashed entry files.
 *
 * The reference graph is shallow and acyclic, so one pass in dependency order
 * propagates hashes: leaf bundles in `assets`, then each of `entries` in order
 * (each may reference the leaves and earlier entries), then index.html. A
 * change in any leaf flows up into the entries' hashes, so index.html (always
 * fresh) points at a fully-current graph.
 *
 * @param {string} outDir directory holding index.html
 * @param {object} graph
 * @param {string} graph.assets subdirectory of outDir whose .js files are the leaves
 * @param {string[]} graph.entries paths relative to outDir, hashed after the leaves in this order
 * @param {string[]} graph.htmlRefs entry basenames rewritten in index.html
 * @param {string[]} [graph.exclude] basenames in `assets` left out of the leaf pass
 * @returns {Record<string, string>} logical basename to hashed basename
 */
export function hashAssetGraph(outDir, { assets, entries, htmlRefs, exclude = [] }) {
  const assetDir = join(outDir, assets)
  const map = {}
  const h8 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 8)

  // Rewrite refs to already-hashed deps (longest first to avoid partial matches),
  // then hash the (rewritten) content and rename the file.
  const hashFile = (dir, name) => {
    const p = join(dir, name)
    if (!existsSync(p)) return
    let s = readFileSync(p, 'utf8')
    for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
      if (s.includes(from)) s = s.split(from).join(map[from])
    }
    const hashed = name.replace(/\.(js|css)$/, (_, ext) => `.${h8(s)}.${ext}`)
    writeFileSync(p, s)
    renameSync(p, join(dir, hashed))
    map[name] = hashed
  }

  for (const f of readdirSync(assetDir)) {
    if (f.endsWith('.js') && !exclude.includes(f)) hashFile(assetDir, f)
  }
  for (const entry of entries) hashFile(join(outDir, dirname(entry)), basename(entry))

  const idx = join(outDir, 'index.html')
  if (existsSync(idx)) {
    let html = readFileSync(idx, 'utf8')
    for (const from of htmlRefs) {
      if (map[from]) html = html.split(from).join(map[from])
    }
    writeFileSync(idx, html)
  }

  console.log(`hashed ${Object.keys(map).length} assets`)
  return map
}
