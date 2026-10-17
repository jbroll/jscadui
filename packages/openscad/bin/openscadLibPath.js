import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { DEFAULT_LIBRARY_PREFIXES, REPO_ROOT } from './libraryPrefixes.js'

/**
 * Build (once) a directory mapping each upstream include root to its fetched
 * tree — `<shim>/BOSL2/...` mirroring `<repo>/packages/openscad/test/corpus/bosl2/lib/...` —
 * so reference OpenSCAD resolves pristine `include <PREFIX/...>` paths via
 * OPENSCADPATH. Fetch-deps output stays byte-identical upstream.
 *
 * Lives inside the repo worktree (`.openscad-libs/`, gitignored,
 * runtime-created): reference OpenSCAD is a Flatpak whose sandbox visibility
 * outside the opened tree cannot be assumed, while the worktree itself is
 * provably visible — OpenSCAD opens the model files there. Nothing scans the
 * repo root for models, so the mirrored files never leak into corpora/grids.
 *
 * Plain copies, not symlinks: sandbox symlink-following cannot be assumed.
 * Refreshed when a prefix source is newer than its mirror.
 */
export function openscadShimDir(prefixes = DEFAULT_LIBRARY_PREFIXES, root = REPO_ROOT) {
  const dir = join(root, '.openscad-libs')
  mkdirSync(dir, { recursive: true })
  // Freshness marker: source dir mtimes per prefix. Parallel harness workers
  // all read the same marker; only a stale/missing one triggers a refresh,
  // so the steady state is a stat per file, not a 5MB copy.
  const marker = join(dir, '.fresh.json')
  let fresh = null
  try { fresh = JSON.parse(readFileSync(marker, 'utf8')) } catch { /* rebuild */ }
  const stamp = {}
  let stale = !fresh
  for (const [prefix, dest] of Object.entries(prefixes)) {
    const target = resolve(root, dest)
    try {
      stamp[prefix] = statSync(target).mtimeMs
    } catch {
      stamp[prefix] = -1
    }
    if (fresh?.[prefix] !== stamp[prefix]) stale = true
  }
  if (!stale) return dir
  const staging = `${dir}.staging-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const [prefix, dest] of Object.entries(prefixes)) {
    const target = resolve(root, dest)
    if (!existsSync(target)) {
      console.warn(`openscad-libs shim: missing source for '${prefix}': ${target}`)
      continue
    }
    const link = join(staging, prefix.replace(/\/$/, ''))
    try {
      cpSync(target, link, { recursive: true })
    } catch (e) {
      console.warn(`openscad-libs shim: cannot mirror '${prefix}': ${e.message}`)
    }
  }
  // Atomic swap: concurrent workers never see a half-written shim.
  // (renameSync across the same filesystem is atomic; staging is beside dir.)
  try {
    rmSync(dir, { recursive: true, force: true })
    renameSync(staging, dir)
    writeFileSync(join(dir, '.fresh.json'), JSON.stringify(stamp))
  } catch (e) {
    console.warn(`openscad-libs shim: swap failed: ${e.message}`)
  }
  return dir
}

export function openscadPathEnv(libDir) {
  // Suite lib dir first: exactly the pre-shim behavior for suite-relative
  // includes; the shim only adds upstream-root resolution after it.
  const paths = []
  if (libDir) paths.push(resolve(libDir))
  paths.push(openscadShimDir())
  return { ...process.env, OPENSCADPATH: paths.join(delimiter) }
}
