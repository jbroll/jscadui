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

function fetchSource(src) {
  const dir = join(CACHE_DIR, src.name)
  console.log(`${src.name}:`)

  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
    const sha = head(dir)
    const note = sha === src.commit ? 'at pin' : `HEAD ${sha?.slice(0, 8)}, pin ${src.commit.slice(0, 8)} — not changed`
    console.log(`  linked → ${realpathSync(dir)} (${note})`)
    return src.commit
  }

  const fresh = !existsSync(dir)
  if (fresh) {
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log(`  cloning ${src.url}…`)
    git(null, 'clone', '--quiet', '--filter=blob:none', '--no-checkout', src.url, dir)
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
    return target
  }
  // A --no-checkout clone has an empty index, which status reports as changes.
  if (!fresh && git(dir, 'status', '--porcelain')) {
    throw new Error(`${dir} has local changes; commit, stash or remove them, or symlink a dev checkout instead`)
  }
  git(dir, 'checkout', '--quiet', '--detach', target)
  console.log(`  checked out ${target.slice(0, 8)}`)
  return target
}

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
