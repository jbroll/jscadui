import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { isExcluded } from './exampleExclusions.js'

/** ALL.js, or a per-category grid such as ALL.printed.js. */
export const isGridFile = (name) => /^ALL(\.[^/]+)?\.js$/.test(name)

const modelName = (file) => file.replace(/\.(scad|js)$/, '')

/**
 * Generate a static manifest of the examples tree so the demo browser works on
 * any static host (prod Apache has directory autoindex off → 403). Maps each
 * directory's URL pathname to its { dirs, files }, mirroring directoryParser:
 * only .js/.scad files, 'lib' directories omitted.
 *
 * A directory with a categories.json ({ category: [model base names] }) also
 * gets one virtual subdirectory per category. Its files live in the real
 * directory, so the entry carries `href`: file name → URL relative to the
 * virtual directory. Each category's grid ALL.<category>.js is listed there as
 * ALL.js.
 *
 * @param {string} srcDir   examples source directory
 * @param {string} outFile  manifest.json path to write
 * @param {string} urlBase  URL path the examples are served under (e.g. '/examples')
 */
export function genExamplesManifest(srcDir, outFile, urlBase = '/examples') {
  const tree = buildExamplesManifest(srcDir, urlBase)
  writeFileSync(outFile, JSON.stringify(tree))
  return Object.keys(tree).length
}

export function buildExamplesManifest(srcDir, urlBase = '/examples') {
  const tree = {}
  const base = urlBase.replace(/\/$/, '')

  // Returns true if the directory (or a descendant) has any visible content.
  const walk = (absDir) => {
    const rel = relative(srcDir, absDir)
    const pathname = (rel ? `${base}/${rel}` : base) + '/'
    let dirs = []
    let files = []
    for (const e of readdirSync(absDir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'lib') continue
      const abs = join(absDir, e.name)
      // Hide non-model files/dirs (exclude.txt) and problematic models (skip.txt).
      if (!isGridFile(e.name) && isExcluded(abs, srcDir)) continue
      if (e.isDirectory()) { if (walk(abs)) dirs.push(e.name) }
      else if (e.name.endsWith('.js') || e.name.endsWith('.scad')) files.push(e.name)
    }
    dirs.sort(); files.sort()
    const categoriesFile = join(absDir, 'categories.json')
    if (existsSync(categoriesFile)) {
      const categories = JSON.parse(readFileSync(categoriesFile, 'utf8'))
      ;({ dirs, files } = addCategories(tree, pathname, dirs, files, categories))
    }
    if (!dirs.length && !files.length) return false
    tree[pathname] = { dirs, files }
    return true
  }

  walk(srcDir)
  return tree
}

function addCategories(tree, pathname, dirs, files, categories) {
  const grouped = new Set()
  const categoryDirs = []
  for (const [category, models] of Object.entries(categories)) {
    if (dirs.includes(category)) throw new Error(`category ${category} in ${pathname} shadows a real directory`)
    const grid = `ALL.${category}.js`
    if (files.includes(grid)) grouped.add(grid)
    const members = files.filter(f => !isGridFile(f) && models.includes(modelName(f)))
    if (!members.length) continue
    members.forEach(f => grouped.add(f))
    const listed = files.includes(grid) ? ['ALL.js', ...members] : members
    const href = Object.fromEntries(listed.map(f => [f, '../' + (f === 'ALL.js' ? grid : f)]))
    tree[`${pathname}${category}/`] = { dirs: [], files: listed, href }
    categoryDirs.push(category)
  }
  return { dirs: [...categoryDirs, ...dirs], files: files.filter(f => !grouped.has(f)) }
}
