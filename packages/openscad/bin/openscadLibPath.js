import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { DEFAULT_LIBRARY_PREFIXES, REPO_ROOT } from './libraryPrefixes.js'

/**
 * Build (once) a directory mapping each upstream include root to its fetched
 * tree — `<shim>/BOSL2` → `<repo>/packages/openscad/test/corpus/bosl2/lib` —
 * so reference OpenSCAD resolves pristine `include <PREFIX/...>` paths via
 * OPENSCADPATH. Fetch-deps output stays byte-identical upstream.
 *
 * Lives under ~/.cache (not tmp): reference OpenSCAD is a Flatpak whose
 * sandbox sees home but not /tmp. Symlink creation can fail on Windows
 * without developer privilege; callers fall back gracefully.
 */
export function openscadShimDir(prefixes = DEFAULT_LIBRARY_PREFIXES, root = REPO_ROOT) {
  const dir = join(homedir(), '.cache', 'jscadui', 'openscad-libs')
  mkdirSync(dir, { recursive: true })
  for (const [prefix, dest] of Object.entries(prefixes)) {
    const target = resolve(root, dest)
    if (!existsSync(target)) continue
    const link = join(dir, prefix.replace(/\/$/, ''))
    try {
      if (existsSync(link)) {
        if (readlinkSync(link) === target) continue
        rmSync(link, { recursive: true, force: true })
      }
      symlinkSync(target, link, 'dir')
    } catch {
      // Leave the stale/missing link out; the reference fails as before.
    }
  }
  return dir
}

export function openscadPathEnv(libDir) {
  const paths = [openscadShimDir()]
  if (libDir) paths.push(resolve(libDir))
  return { ...process.env, OPENSCADPATH: paths.join(delimiter) }
}
