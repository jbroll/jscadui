#!/usr/bin/env node
/**
 * fetch-sources.js — Check out the source repos that file: dependencies use
 *
 * Reads scripts/deps/sources.json. For each source, makes .deps-cache/<name>
 * a checkout of <url> at the pinned <commit>. Run it before `npm install`:
 * package.json files reference e.g. .deps-cache/OpenJSCAD.org/packages/modeling.
 *
 *   missing              → blobless clone, detached at the pin
 *   directory we cloned  → moved to the pin if HEAD differs (refuses if dirty)
 *   symlink              → left alone; a dev checkout linked in for live
 *                          editing. Reports its HEAD against the pin.
 *
 * To work on a source locally:
 *   ln -s ~/src/OpenJSCAD.org .deps-cache/OpenJSCAD.org
 *
 * Usage:
 *   node scripts/fetch-sources.js [--update] [--name=<name>]
 *
 *   --update       Move each pin to the tip of its ref and write it back
 *   --name=<name>  Process only this source
 */

import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'scripts', 'deps', 'sources.json')
const CACHE_DIR = join(ROOT, '.deps-cache')

const argv = process.argv.slice(2)
const UPDATE = argv.includes('--update')
const NAME = argv.find(a => a.startsWith('--name='))?.split('=')[1]

const git = (dir, ...args) =>
  execFileSync('git', dir ? ['-C', dir, ...args] : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function head(dir) {
  try { return git(dir, 'rev-parse', '--verify', 'HEAD^{commit}') } catch { return null }
}

function hasCommit(dir, sha) {
  try { git(dir, 'cat-file', '-e', `${sha}^{commit}`); return true } catch { return false }
}

// Kept outside the checkout (never inside it) so the checkout can stay clean
// for the next pin move regardless of what the build wrote there.
const buildHash = (build) => createHash('sha1').update(JSON.stringify(build)).digest('hex').slice(0, 8)
const markerPath = (name) => join(CACHE_DIR, `.${name}.built`)

function readMarker(name) {
  const p = markerPath(name)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
}

// realpath resolves a symlinked invocation (e.g. scripts/setup-worktree.sh)
// to the same path import.meta.url reports, so the guard fires there too.
export const isMainModule = (argv1, moduleUrl) => {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

// Pure, no fs/git access, so the decision logic is unit-testable without a
// real checkout: exported for scripts/deps/fetch-sources.test.js.
export const markerValue = (target, build) => `${target}:${buildHash(build)}`
export const needsBuild = (markerContent, target, build) => markerContent !== markerValue(target, build)

// Marker at the current HEAD means the dirt is our own build's leftovers,
// not someone's edit, so it's safe to discard automatically.
export const isOwnBuildDirt = (markerContent, currentHead) =>
  markerContent != null && currentHead != null && markerContent.startsWith(`${currentHead}:`)

function buildIfNeeded(dir, src, target) {
  if (!src.build) return
  if (!needsBuild(readMarker(src.name), target, src.build)) {
    console.log('  build up to date')
    return
  }
  console.log(`  building (${src.build.join(' && ')})…`)
  for (const cmd of src.build) {
    execFileSync('/bin/sh', ['-c', cmd], { cwd: dir, stdio: 'inherit' })
  }
  // Discard whatever the build left (tracked edits, stray untracked files) so
  // the checkout stays clean for the next fetch or pin move; never -x.
  git(dir, 'checkout', '--quiet', '--', '.')
  git(dir, 'clean', '--quiet', '-fd')
  writeFileSync(markerPath(src.name), markerValue(target, src.build) + '\n')
}

function fetchSource(src) {
  const dir = join(CACHE_DIR, src.name)
  console.log(`${src.name}:`)

  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
    const sha = head(dir)
    const note = sha === src.commit ? 'at pin' : `HEAD ${sha?.slice(0, 8)}, pin ${src.commit.slice(0, 8)} — not changed`
    console.log(`  linked → ${realpathSync(dir)} (${note})`)
    if (src.build) console.log('  build skipped: linked checkout must be built by its owner')
    return src.commit
  }

  const fresh = !existsSync(dir)
  if (fresh) {
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log(`  cloning ${src.url}…`)
    git(null, 'clone', '--quiet', '--filter=blob:none', '--no-checkout', src.url, dir)
  }

  // A --no-checkout clone has an empty index, which status reports as changes.
  let dirty = !fresh && git(dir, 'status', '--porcelain') !== ''
  if (dirty && src.build && isOwnBuildDirt(readMarker(src.name), head(dir))) {
    console.log(`  discarding ${src.name}'s own uncommitted build output`)
    git(dir, 'checkout', '--quiet', '--', '.')
    git(dir, 'clean', '--quiet', '-fd')
    dirty = false
  }
  if (dirty) {
    throw new Error(`${dir} has local changes; commit, stash or remove them, or symlink a dev checkout instead`)
  }

  let target = src.commit
  if (UPDATE) {
    git(dir, 'fetch', '--quiet', 'origin', src.ref)
    target = git(dir, 'rev-parse', 'FETCH_HEAD')
  } else if (!hasCommit(dir, target)) {
    git(dir, 'fetch', '--quiet', 'origin')
  }

  if (!fresh && head(dir) === target) {
    console.log(`  at pin ${target.slice(0, 8)}`)
    buildIfNeeded(dir, src, target)
    return target
  }
  git(dir, 'checkout', '--quiet', '--detach', target)
  console.log(`  checked out ${target.slice(0, 8)}`)
  buildIfNeeded(dir, src, target)
  return target
}

// Guarded so scripts/deps/fetch-sources.test.js can import the pure helpers
// above without running the whole fetch as an import side effect.
if (isMainModule(process.argv[1], import.meta.url)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  let changed = false
  for (const src of manifest.sources) {
    if (NAME && src.name !== NAME) continue
    let sha
    try {
      sha = fetchSource(src)
    } catch (err) {
      console.error(`\nfatal: ${src.name}: ${err.stderr?.trim() || err.message}`)
      process.exit(1)
    }
    if (UPDATE && sha !== src.commit) {
      console.log(`  pin ${src.commit.slice(0, 8)} → ${sha.slice(0, 8)}`)
      src.commit = sha
      changed = true
    }
  }
  if (changed) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
}
