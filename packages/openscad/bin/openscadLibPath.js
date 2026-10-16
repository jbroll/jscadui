import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { DEFAULT_LIBRARY_PREFIXES, REPO_ROOT } from './libraryPrefixes.js'

/**
 * Build (once) a directory mapping each upstream include root to its fetched
 * tree — `<shim>/BOSL2` → `<repo>/packages/openscad/test/corpus/bosl2/lib` —
 * so reference OpenSCAD resolves pristine `include <PREFIX/...>` paths via
 * OPENSCADPATH. Fetch-deps output stays byte-identical upstream.
 *
 * Lives inside the repo worktree (`.openscad-libs/`, gitignored,
 * runtime-created): reference OpenSCAD is a Flatpak whose sandbox visibility
 * outside the opened tree cannot be assumed (home- and tmp-based locations
 * both failed), while the worktree itself is provably visible — OpenSCAD
 * opens the model files there. Nothing scans the repo root for models, so
 * the symlinks never leak into corpora or grids.
 */
export function openscadShimDir(prefixes = DEFAULT_LIBRARY_PREFIXES, root = REPO_ROOT) {
  const dir = join(root, '.openscad-libs')
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
