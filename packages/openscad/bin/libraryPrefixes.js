import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Repo root (packages/openscad/bin → root). */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..')

/**
 * Upstream include roots that resolve into the local fetched tree, as
 * repo-relative destinations. Lets fetched `.scad` files keep their upstream
 * `include <PREFIX/...>` paths instead of fetch-deps include-rewriting patches.
 */
export const DEFAULT_LIBRARY_PREFIXES = {
  'BOSL2/': 'packages/openscad/test/corpus/bosl2/lib/',
  'BOSL/': 'packages/openscad/test/corpus/bosl/lib/',
  'MCAD/': 'apps/jscad-web/examples/openscad/mcad/',
  'list-comprehension-demos/': 'apps/jscad-web/examples/openscad/list-comprehension-demos/',
}

/**
 * Resolve `filename` through the longest matching library prefix, if any.
 * Prefix values may be absolute or repo-relative. Returns the absolute target
 * path when the mapped file exists, else undefined. Pure: takes `root`
 * explicitly so tests need no repo checkout layout.
 */
export function resolveLibraryPrefix(filename, prefixes = DEFAULT_LIBRARY_PREFIXES, root = REPO_ROOT) {
  const entries = Object.entries(prefixes).sort((a, b) => b[0].length - a[0].length)
  for (const [prefix, dest] of entries) {
    if (!filename.startsWith(prefix)) continue
    const target = resolve(root, dest, filename.slice(prefix.length))
    if (existsSync(target)) return target
  }
  return undefined
}
