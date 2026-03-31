#!/usr/bin/env node
/**
 * fetch-deps.js — Fetch external OpenSCAD dependencies
 *
 * Reads scripts/deps/manifest.json.  For each dep it:
 *   1. Clones the upstream git repo to a local cache (.deps-cache/<name>/)
 *   2. For each mapping: copies files from srcDir → destDir inside the dest tree
 *   3. Applies unified-diff patch files
 *
 * Generated deps (no URL) run a script instead of a git clone.
 * After all deps are fetched, organize-corpus.js is run to build the examples dir.
 *
 * Usage:
 *   node scripts/fetch-deps.js [options]
 *
 * Options:
 *   --update        Re-fetch repos, write pinned SHAs back to manifest
 *   --dep=<name>    Process only this named dependency
 *   --if-missing    Skip dest dirs that already contain files
 *   --no-organize   Skip the final organize-corpus step
 *   --dry-run       Print actions without writing any files
 */

import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync,
} from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'deps', 'manifest.json')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv       = process.argv.slice(2)
const DRY_RUN    = argv.includes('--dry-run')
const UPDATE     = argv.includes('--update')
const IF_MISSING = argv.includes('--if-missing')
const NO_ORGANIZE = argv.includes('--no-organize')
const DEP_FILTER  = argv.find(a => a.startsWith('--dep='))?.split('=')[1]

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (err) {
  die(`Cannot read manifest: ${err.message}`)
}

const CACHE_DIR = join(ROOT, manifest.cacheDir ?? '.deps-cache')

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function die(msg) {
  console.error(`\nfatal: ${msg}`)
  process.exit(1)
}

function exec(cmd, opts = {}) {
  if (DRY_RUN && !opts.readOnly) {
    console.log(`    [dry] ${cmd}`)
    return ''
  }
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim()
  } catch (err) {
    throw new Error(`${cmd}\n${err.stderr?.trim() || err.message}`)
  }
}

function dirHasFiles(absPath) {
  return existsSync(absPath) && readdirSync(absPath).length > 0
}

function ensureDir(absPath) {
  if (!DRY_RUN) mkdirSync(absPath, { recursive: true })
}

// ---------------------------------------------------------------------------
// Glob matching — handles: *.ext  **/*.ext  subdir/*.ext  subdir/**
// Only used on the filename/relPath within a single srcDir listing.
// ---------------------------------------------------------------------------
function matchGlob(name, pattern) {
  const esc = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const rx = esc(pattern)
    .replace(/\*\*/g, 'GLOBSTAR')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/GLOBSTAR/g, '.*')
  return new RegExp(`^${rx}$`).test(name)
}

// relPath is the full path relative to srcDir (may include subdirs).
// fileName is just the basename, used for skipFiles matching.
function fileWanted(relPath, fileName, include, exclude, skipFiles) {
  if ((skipFiles ?? []).includes(fileName)) return false
  const inc = include.some(p => matchGlob(relPath, p))
  if (!inc) return false
  return !exclude.some(p => matchGlob(relPath, p))
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------
function cloneOrFetch(dep, cacheDir) {
  const pinned = dep.commit || null

  if (existsSync(cacheDir)) {
    if (!UPDATE) {
      if (pinned) {
        const current = headSHA(cacheDir)
        if (current !== pinned) {
          console.warn(`  warn: cache is at ${current.slice(0, 8)}, manifest pins ${pinned.slice(0, 8)}`)
          console.warn(`  run npm run fetch-deps:update to re-checkout pinned commit`)
        }
      }
      console.log(`  cache hit: ${cacheDir}`)
      return
    }
    console.log(`  updating…`)
    if (pinned) {
      exec(`git -C ${q(cacheDir)} fetch origin`)
      exec(`git -C ${q(cacheDir)} checkout ${q(pinned)}`)
    } else {
      exec(`git -C ${q(cacheDir)} fetch --depth=1 origin ${q(dep.ref)}`)
      exec(`git -C ${q(cacheDir)} checkout FETCH_HEAD`)
    }
  } else {
    ensureDir(CACHE_DIR)
    if (pinned) {
      console.log(`  cloning ${dep.url} (pinned @ ${pinned.slice(0, 8)})…`)
      // blobless clone (no depth) so we can checkout a specific commit
      exec(`git clone --filter=blob:none ${q(dep.url)} ${q(cacheDir)}`)
      exec(`git -C ${q(cacheDir)} checkout ${q(pinned)}`)
    } else {
      console.log(`  cloning ${dep.url} @ ${dep.ref}…`)
      exec(
        `git clone --filter=blob:none --depth=1 ` +
        `--branch ${q(dep.ref)} ${q(dep.url)} ${q(cacheDir)}`
      )
    }
  }
}

function q(s) { return JSON.stringify(s) }

function headSHA(cacheDir) {
  if (DRY_RUN) return '(dry-run)'
  return exec(`git -C ${q(cacheDir)} rev-parse HEAD`, { readOnly: true })
}

/**
 * List files in a subdirectory of the cloned repo.
 * srcDir = '' or '.' means the repo root; otherwise a subdirectory path.
 * Returns file names relative to that srcDir (flat, no subdirs).
 * Uses git ls-files to respect .gitignore and stay efficient.
 */
function listFiles(cacheDir, srcDir) {
  if (DRY_RUN) return []
  const normalized = (!srcDir || srcDir === '.') ? '' : srcDir.replace(/\/$/, '')
  const target = normalized ? join(cacheDir, normalized) : cacheDir

  if (!existsSync(target)) {
    console.warn(`  warn: srcDir not found in repo: ${srcDir || '.'}`)
    return []
  }

  // Use git ls-files scoped to the subdirectory, then make paths relative to it
  const lsTarget = normalized || '.'
  const raw = exec(
    `git -C ${q(cacheDir)} ls-files -- ${q(lsTarget)}`,
    { readOnly: true }
  )
  if (!raw) return []

  return raw.split('\n').filter(Boolean).map(p => {
    // strip the srcDir prefix so we get a path relative to srcDir
    const prefix = normalized ? normalized + '/' : ''
    return prefix ? p.replace(prefix, '') : p
  })
}

// ---------------------------------------------------------------------------
// Copy one mapping from a cloned repo into the dest tree
// ---------------------------------------------------------------------------
function applyMapping(cacheDir, mapping) {
  const { srcDir, destDir, include, exclude, skipFiles } = mapping
  const destAbs = join(ROOT, destDir)

  if (IF_MISSING && dirHasFiles(destAbs)) {
    console.log(`  skip mapping ${srcDir || '.'} → ${destDir} (already populated)`)
    return
  }

  const srcNorm = (!srcDir || srcDir === '.') ? '' : srcDir.replace(/\/$/, '')
  const srcAbs  = srcNorm ? join(cacheDir, srcNorm) : cacheDir

  const files = listFiles(cacheDir, srcDir)
  let count = 0

  for (const name of files) {
    // name is relative to srcDir, may include subdirectory components
    const fileName = basename(name)
    if (!fileWanted(name, fileName, include ?? ['*'], exclude ?? [], skipFiles ?? [])) continue

    const src  = join(srcAbs, name)
    const dest = join(destAbs, name)

    console.log(`  copy  ${srcDir || '.'}/${name}  →  ${destDir}/${name}`)
    if (!DRY_RUN) {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
    }
    count++
  }

  console.log(`  ${count} file(s) copied from ${srcDir || '.'} → ${destDir}`)
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------
function applyPatches(patches) {
  for (const patch of patches ?? []) {
    const patchFile = join(ROOT, patch.patchFile)
    if (!existsSync(patchFile)) {
      console.warn(`  warn: patch file not found: ${patch.patchFile}`)
      continue
    }
    const desc = patch.description ? ` — ${patch.description}` : ''
    console.log(`  patch${desc}`)
    if (DRY_RUN) {
      console.log(`    [dry] patch --forward --no-backup-if-mismatch -p1 -i ${patch.patchFile}`)
      continue
    }
    const result = spawnSync(
      'patch',
      ['--forward', '--no-backup-if-mismatch', '-p1', '-i', patchFile],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }
    )
    if (result.status === 0) continue
    const out = (result.stdout || '') + (result.stderr || '')
    if (out.includes('Skipping patch')) {
      console.log('    already applied')
      continue
    }
    throw new Error(`patch failed (${patch.patchFile}):\n${out}`)
  }
}

// ---------------------------------------------------------------------------
// Process a fetched dep (has a URL)
// ---------------------------------------------------------------------------
function processFetchedDep(dep) {
  const cacheDir = join(CACHE_DIR, dep.name)

  cloneOrFetch(dep, cacheDir)

  const sha = headSHA(cacheDir)
  console.log(`  HEAD: ${sha}`)
  if (UPDATE && !DRY_RUN) dep.commit = sha

  for (const mapping of dep.mappings ?? []) {
    applyMapping(cacheDir, mapping)
  }

  applyPatches(dep.patches)
}

// ---------------------------------------------------------------------------
// Process a generated dep (runs a script)
// ---------------------------------------------------------------------------
function processGeneratedDep(dep) {
  console.log(`  running: ${dep.script}`)

  if (!DRY_RUN) {
    const cwd = dep.cwd ? join(ROOT, dep.cwd) : ROOT
    const result = spawnSync(process.execPath, [join(ROOT, dep.script)], {
      cwd,
      stdio: 'inherit',
    })
    if (result.status !== 0) throw new Error(`Script exited with ${result.status}`)
  }

  applyPatches(dep.patches)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('fetch-deps: OpenSCAD external dependency installer')
if (DRY_RUN) console.log('DRY RUN — no files will be written\n')

const allDeps = manifest.deps.filter(d => !DEP_FILTER || d.name === DEP_FILTER)
if (!allDeps.length) die(`No dep found matching --dep=${DEP_FILTER}`)

// Process fetched deps first, then generated (which may depend on fetched output)
const fetchedDeps   = allDeps.filter(d => !d.generated)
const generatedDeps = allDeps.filter(d =>  d.generated)

for (const dep of fetchedDeps) {
  console.log(`\n── ${dep.name}: ${dep.description ?? ''}`)
  try { processFetchedDep(dep) } catch (err) { die(err.message) }
}

for (const dep of generatedDeps) {
  console.log(`\n── ${dep.name}: ${dep.description ?? ''} (generated)`)
  try { processGeneratedDep(dep) } catch (err) { die(err.message) }
}

// Organize corpus → examples/
if (!NO_ORGANIZE && !DEP_FILTER && manifest.organize) {
  const { script, args: scriptArgs = [] } = manifest.organize
  console.log(`\n── organize: ${manifest.organize.description ?? ''}`)
  if (DRY_RUN) {
    console.log(`  [dry] would run: node ${script} ${scriptArgs.join(' ')}`)
  } else {
    const result = spawnSync(process.execPath, [join(ROOT, script), ...scriptArgs], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    if (result.status !== 0) die(`organize script failed`)
  }
}

// Persist pinned SHAs when --update was used
if (UPDATE && !DRY_RUN) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('\nManifest updated with pinned commits.')
}

console.log('\nDone.')
