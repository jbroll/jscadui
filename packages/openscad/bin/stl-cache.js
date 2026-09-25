#!/usr/bin/env node
/**
 * OpenSCAD STL reference cache.
 *
 * Caches reference STLs to skip flatpak re-renders.
 * Cache validity is per-library: invalidated when the library's lib/ dir or the
 * OpenSCAD version changes. Stored in ~/.cache/jscadui/openscad-stl/ so it
 * persists across CI worktrees.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

const STL_CACHE_ROOT = join(homedir(), '.cache', 'jscadui', 'openscad-stl')

/** Hash all .scad files in a directory tree (sorted, deterministic). */
export function hashDirectory(dir) {
  const hash = createHash('sha256')
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.scad')) hash.update(readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex').slice(0, 16)
}

/** Extract library name from a scad path (.../examples/openscad/<lib>/...). */
export function getLibraryName(scadPath) {
  const m = scadPath.match(/[/\\]examples[/\\]openscad[/\\]([^/\\]+)/)
  return m ? m[1] : null
}

/** Stable cache path for a given source file and $fn value. */
export function stlCachePath(originalScadPath, fn, libName, preview = false) {
  const marker = `examples/openscad/${libName}/`
  const idx = originalScadPath.replace(/\\/g, '/').indexOf(marker)
  if (idx < 0) return null
  const rel = originalScadPath.slice(idx + marker.length)
  const suffix = (fn > 0 ? `.fn${fn}` : '') + (preview ? '.preview' : '') + '.stl'
  return join(STL_CACHE_ROOT, libName, rel + suffix)
}

export function failedCachePath(originalScadPath, fn, libName, preview = false) {
  const p = stlCachePath(originalScadPath, fn, libName, preview)
  return p ? p.replace(/\.stl$/, '.failed') : null
}

/**
 * Content hash of a source file for cache validation.
 * Model STLs are cached by path, but generated test files change content at
 * stable paths — the hash tells a fresh render from a stale hit.
 */
function srcHash(originalScadPath, fn, preview) {
  const hash = createHash('sha256')
  hash.update(readFileSync(originalScadPath))
  hash.update(`|fn=${fn}|preview=${preview ? 1 : 0}`)
  return hash.digest('hex')
}

/**
 * Tag appended to the source hash of a failure sentinel. Bump it when the
 * harness changes in a way that can turn a recorded failure into a success
 * (e.g. 2: paths with spaces used to reach openscad unquoted), so old
 * failures are re-rendered once instead of replayed. Cached successes keep.
 */
const FAILURE_EPOCH = '|failed-v2'

/** Sidecar file recording which source content a cached entry was rendered from. */
function srcHashPath(stlPath) {
  return `${stlPath}.src-hash`
}

function storedSrcHash(stlPath) {
  const p = srcHashPath(stlPath)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
}

/**
 * Manages the OpenSCAD STL cache for a single test run.
 * Libraries are validated lazily on first access.
 *
 * Each library gets its own hash file (.deps-cache/openscad-stl/<lib>/.hash)
 * so parallel test runners don't race on a shared meta file.
 */
export class StlCache {
  constructor(openscadVersion = '') {
    this._openscadVersion = openscadVersion
    this._validated = {}     // libName → boolean
    this._hits = 0
    this._misses = 0
    this._failedHits = 0
    this._dirtyLibs = new Set()  // libs whose hash file needs writing
    this._hashes = {}        // libName → computed hash
  }

  _hashFilePath(libName) {
    return join(STL_CACHE_ROOT, libName, '.hash')
  }

  _readStoredHash(libName) {
    const p = this._hashFilePath(libName)
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
  }

  /** Validate a library's cache (compute hash, compare, invalidate if changed). */
  _validate(libName, originalScadPath) {
    if (libName in this._validated) return this._validated[libName]

    // Find the library root from the scad path
    const marker = `examples/openscad/${libName}`
    const norm = originalScadPath.replace(/\\/g, '/')
    const idx = norm.indexOf(marker)
    if (idx < 0) { this._validated[libName] = false; return false }
    const libRoot = originalScadPath.slice(0, idx + marker.length)

    // Hash lib/ dir if it exists, else hash the library root itself
    const libDir = join(libRoot, 'lib')
    const hashTarget = existsSync(libDir) ? libDir : libRoot
    const hash = `${hashDirectory(hashTarget)} ${this._openscadVersion}`.trim()
    this._hashes[libName] = hash
    this._dirtyLibs.add(libName)

    const stored = this._readStoredHash(libName)
    if (stored !== hash) {
      // Library changed — purge its cached STLs (but keep the dir for new cache)
      const libCacheDir = join(STL_CACHE_ROOT, libName)
      if (existsSync(libCacheDir)) {
        rmSync(libCacheDir, { recursive: true })
        process.stderr.write(`[stl-cache] invalidated ${libName} (lib or OpenSCAD version changed)\n`)
      }
    }
    this._validated[libName] = true
    return true
  }

  /**
   * Check the cache for a source file.
   * Returns null (miss), { failed: true } (known failure), or { stlPath } (hit).
   * Entries are validated against the current source content: a cached render
   * (or failure) for different content is a miss, not a hit.
   */
  check(originalScadPath, fn, preview = false) {
    const libName = getLibraryName(originalScadPath)
    if (!libName || !this._validate(libName, originalScadPath)) return null

    let current
    try {
      current = srcHash(originalScadPath, fn, preview)
    } catch {
      return null
    }

    const cached = stlCachePath(originalScadPath, fn, libName, preview)
    const failed = failedCachePath(originalScadPath, fn, libName, preview)
    if (failed && existsSync(failed)) {
      if (cached && storedSrcHash(cached) === current + FAILURE_EPOCH) {
        this._failedHits++
        return { failed: readFileSync(failed, 'utf8').split('\n')[0] || 'failed' }
      }
      this._misses++
      return null
    }

    if (cached && existsSync(cached)) {
      if (storedSrcHash(cached) === current) {
        this._hits++
        return { stlPath: cached }
      }
      this._misses++
      return null
    }

    this._misses++
    return null
  }

  /** Save a successful render to cache. */
  saveHit(originalScadPath, generatedStlPath, fn, preview = false) {
    const libName = getLibraryName(originalScadPath)
    if (!libName) return
    const dest = stlCachePath(originalScadPath, fn, libName, preview)
    if (!dest) return
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(generatedStlPath, dest)
    writeFileSync(srcHashPath(dest), srcHash(originalScadPath, fn, preview))
    // A success supersedes any recorded failure for this model.
    const failed = failedCachePath(originalScadPath, fn, libName, preview)
    if (failed && existsSync(failed)) rmSync(failed, { force: true })
  }

  /** Save a failed render sentinel to cache. */
  saveFailed(originalScadPath, fn, errorMsg, preview = false) {
    const libName = getLibraryName(originalScadPath)
    if (!libName) return
    const dest = failedCachePath(originalScadPath, fn, libName, preview)
    if (!dest) return
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, errorMsg || 'failed')
    const cached = stlCachePath(originalScadPath, fn, libName, preview)
    if (cached) writeFileSync(srcHashPath(cached), srcHash(originalScadPath, fn, preview) + FAILURE_EPOCH)
  }

  /** Persist per-library hash files. Safe to call from parallel processes. */
  flush() {
    for (const libName of this._dirtyLibs) {
      const hashFile = this._hashFilePath(libName)
      mkdirSync(dirname(hashFile), { recursive: true })
      writeFileSync(hashFile, this._hashes[libName])
    }
  }

  stats() {
    return { hits: this._hits, misses: this._misses, failedHits: this._failedHits }
  }
}
