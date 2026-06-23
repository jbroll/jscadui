import { readdirSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { isExcluded } from './exampleExclusions.js'

/**
 * Generate a static manifest of the examples tree so the demo browser works on
 * any static host (prod Apache has directory autoindex off → 403). Maps each
 * directory's URL pathname to its { dirs, files }, mirroring directoryParser:
 * only .js/.scad files, 'lib' directories omitted.
 *
 * @param {string} srcDir   examples source directory
 * @param {string} outFile  manifest.json path to write
 * @param {string} urlBase  URL path the examples are served under (e.g. '/examples')
 */
export function genExamplesManifest(srcDir, outFile, urlBase = '/examples') {
  const tree = {}
  const base = urlBase.replace(/\/$/, '')

  // Returns true if the directory (or a descendant) has any visible content.
  const walk = (absDir) => {
    const rel = relative(srcDir, absDir)
    const pathname = (rel ? `${base}/${rel}` : base) + '/'
    const dirs = []
    const files = []
    for (const e of readdirSync(absDir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'lib') continue
      const abs = join(absDir, e.name)
      // Hide non-model files/dirs (exclude.txt) and problematic models (skip.txt).
      if (e.name !== 'ALL.js' && isExcluded(abs, srcDir)) continue
      if (e.isDirectory()) { if (walk(abs)) dirs.push(e.name) }
      else if (e.name.endsWith('.js') || e.name.endsWith('.scad')) files.push(e.name)
    }
    if (!dirs.length && !files.length) return false
    dirs.sort(); files.sort()
    tree[pathname] = { dirs, files }
    return true
  }

  walk(srcDir)
  writeFileSync(outFile, JSON.stringify(tree))
  return Object.keys(tree).length
}
