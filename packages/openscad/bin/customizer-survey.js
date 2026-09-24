#!/usr/bin/env node
/**
 * Survey OpenSCAD libraries for files that can become parameterized parts.
 *
 * Each top-level directory under a root is treated as one library. Every .scad
 * file is transpiled (not rendered) and classified:
 *
 *   parameterized  top-level geometry and >= 1 Customizer parameter
 *   model          top-level geometry, no Customizer parameters
 *   library        no top-level geometry, or listed in an exclude.txt
 *                  (library sources, not standalone models)
 *   skipped        listed in a skip.txt (known to fail the comparison suite)
 *   unresolved     an include/use target was not found
 *   error          parse or transpile failure
 *
 * Usage:
 *   npm run fetch-deps   # (repo root) library sources and generated examples are not in git
 *   npm run build        # bin tools import ../esm
 *   node bin/customizer-survey.js [options] [root...]
 *
 * Options:
 *   --json          Print the full per-file result as JSON
 *   --list          List parameterized files with their parameter counts
 *   -I <dir>        Extra include directory (repeatable), searched after the
 *                   file's directory and the library root
 *
 * Default root: apps/jscad-web/examples/openscad
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../esm/parser/parse.js'
import { transpile } from '../esm/transpiler/transpile.js'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(here, '../../../apps/jscad-web/examples/openscad')
const CATEGORIES = ['parameterized', 'model', 'library', 'skipped', 'unresolved', 'error']
const BUCKETS = [[1, 1], [2, 3], [4, 7], [8, 15], [16, 31], [32, Infinity]]

function parseArgs(argv) {
  const opts = { json: false, list: false, includes: [], roots: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--list') opts.list = true
    else if (a === '-I') opts.includes.push(resolve(argv[++i]))
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    } else opts.roots.push(resolve(a))
  }
  if (opts.roots.length === 0) opts.roots.push(DEFAULT_ROOT)
  return opts
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.scad')) out.push(p)
  }
  return out
}

/** skip.txt / exclude.txt patterns scoped to their directory (same rules as test-harness.js) */
function loadDirPatterns(root, filename) {
  const scoped = []
  const visit = dir => {
    const f = join(dir, filename)
    if (existsSync(f)) {
      const patterns = readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      if (patterns.length) scoped.push({ dir, patterns })
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) visit(join(dir, e.name))
    }
  }
  visit(root)
  return scoped
}

function matchesDirPatterns(file, scoped) {
  for (const { dir, patterns } of scoped) {
    if (!file.startsWith(dir + '/')) continue
    const rel = relative(dir, file)
    const name = rel.split('/').pop()
    for (const p of patterns) {
      const anchored = p.startsWith('/')
      const raw = anchored ? p.slice(1) : p
      const pattern = raw.endsWith('/') ? raw + '*' : raw
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp('^' + (anchored
        ? escaped.replace(/\*\*/g, '.*').replace(/(?<!\*)\*(?!\*)/g, '[^/]*')
        : escaped.replace(/\*/g, '.*')) + '$')
      if (re.test(rel) || (!anchored && re.test(name))) return true
    }
  }
  return false
}

function surveyFile(file, libRoot, includes) {
  const fileResolver = (name, from) => {
    for (const base of [dirname(from ?? file), libRoot, ...includes]) {
      const p = resolve(base, name)
      if (existsSync(p) && statSync(p).isFile()) return { path: p, content: readFileSync(p, 'utf8') }
    }
    return undefined
  }
  try {
    const { ast, errors: parseErrors } = parse(readFileSync(file, 'utf8'), file)
    if (!ast) return { category: 'error', error: parseErrors[0]?.message ?? 'parse failed' }
    const result = transpile(ast, { fileResolver, currentFile: file, customizer: true })
    const fatal = result.errors.find(e => e.code === 'FILE_NOT_FOUND' || e.code === 'PARSE_ERROR')
    if (fatal) return { category: fatal.code === 'FILE_NOT_FOUND' ? 'unresolved' : 'error', error: fatal.message }
    const schema = result.customizer
    const kinds = {}
    for (const v of schema?.variables ?? []) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1
    const widgets = {}
    for (const p of schema?.parameters ?? []) {
      const w = p.type === 'vector' ? `vector-${p.widget.kind}` : p.widget.kind
      widgets[w] = (widgets[w] ?? 0) + 1
    }
    const hasGeometry = result.files.get(file)?.hasTopLevelGeometry ?? /\breturn\b(?! undefined)/.test(result.code)
    const parameters = schema?.parameters.length ?? 0
    return {
      category: !hasGeometry ? 'library' : parameters > 0 ? 'parameterized' : 'model',
      parameters,
      groups: schema?.groups.filter(g => g !== 'Parameters').length ?? 0,
      kinds,
      widgets,
    }
  } catch (e) {
    return { category: 'error', error: String(e?.message ?? e).split('\n')[0] }
  }
}

function libraryOf(root, file) {
  const first = relative(root, file).split('/')[0]
  return first.endsWith('.scad') ? '.' : first
}

function survey(opts) {
  const files = []
  for (const root of opts.roots) {
    const skips = loadDirPatterns(root, 'skip.txt')
    const excludes = loadDirPatterns(root, 'exclude.txt')
    for (const file of walk(root).sort()) {
      const library = libraryOf(root, file)
      const libRoot = library === '.' ? root : join(root, library)
      const skipped = matchesDirPatterns(file, skips)
      const r = surveyFile(file, libRoot, opts.includes)
      if (matchesDirPatterns(file, excludes) && r.category !== 'error' && r.category !== 'unresolved') {
        r.category = 'library'
      }
      // Report skip status separately so a known-failing file with parameters is visible
      files.push({
        root: relative(process.cwd(), root) || '.',
        library,
        file: library === '.' ? relative(root, file) : relative(join(root, library), file),
        ...r,
        category: skipped && r.category !== 'library' ? 'skipped' : r.category,
        ...(skipped ? { skipList: true, wouldBe: r.category } : {}),
      })
    }
  }
  return files
}

const pad = (s, n) => String(s).padStart(n)
const padEnd = (s, n) => String(s).padEnd(n)

function report(files, opts) {
  const libs = new Map()
  for (const f of files) {
    const key = `${f.root}/${f.library}`
    if (!libs.has(key)) libs.set(key, [])
    libs.get(key).push(f)
  }
  const width = Math.max(10, ...[...libs.keys()].map(k => k.length))

  console.log('Files by category')
  console.log(`${padEnd('library', width)} ${pad('files', 6)} ${CATEGORIES.map(c => pad(c, c.length + 1)).join('')}  param%`)
  const row = (name, fs) => {
    const counts = CATEGORIES.map(c => fs.filter(f => f.category === c).length)
    const models = counts[0] + counts[1]
    const pct = models ? `${Math.round(100 * counts[0] / models)}%` : '-'
    console.log(`${padEnd(name, width)} ${pad(fs.length, 6)} ${counts.map((n, i) => pad(n, CATEGORIES[i].length + 1)).join('')}  ${pad(pct, 6)}`)
  }
  for (const [name, fs] of libs) row(name, fs)
  row('TOTAL', files)
  console.log('param% = parameterized / (parameterized + model)\n')

  const param = files.filter(f => f.category === 'parameterized')
  const skippedWithParams = files.filter(f => f.skipList && f.parameters > 0).length
  console.log(`Parameters per parameterized file (${param.length} files${skippedWithParams ? `; ${skippedWithParams} more in skip lists` : ''})`)
  const max = Math.max(1, ...BUCKETS.map(([lo, hi]) => param.filter(f => f.parameters >= lo && f.parameters <= hi).length))
  for (const [lo, hi] of BUCKETS) {
    const n = param.filter(f => f.parameters >= lo && f.parameters <= hi).length
    const label = hi === Infinity ? `${lo}+` : lo === hi ? `${lo}` : `${lo}-${hi}`
    console.log(`${pad(label, 7)} ${pad(n, 5)} ${'#'.repeat(Math.round(40 * n / max))}`)
  }

  const sum = key => {
    const t = {}
    for (const f of param) for (const [k, v] of Object.entries(f[key] ?? {})) t[k] = (t[k] ?? 0) + v
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
  }
  console.log(`\nWidgets in parameterized files: ${sum('widgets') || '-'}`)
  console.log(`Top-level variables in parameterized files: ${sum('kinds') || '-'}`)
  console.log(`Parameterized files using /* [Group] */ sections: ${param.filter(f => f.groups > 0).length}`)

  const unresolved = files.filter(f => f.category === 'unresolved')
  if (unresolved.length) {
    const missing = new Map()
    for (const f of unresolved) {
      const name = f.error.replace(/^.*?: /, '')
      missing.set(name, (missing.get(name) ?? 0) + 1)
    }
    const top = [...missing].sort((a, b) => b[1] - a[1]).slice(0, 10)
    console.log(`\nUnresolved includes (${unresolved.length} files; run "npm run fetch-deps" at the repo root, or pass library dirs with -I):`)
    for (const [name, n] of top) console.log(`  ${pad(n, 4)}  ${name}`)
  }

  const errors = files.filter(f => f.category === 'error')
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`)
    for (const f of errors.slice(0, 20)) console.log(`  ${f.library}/${f.file}: ${f.error}`)
    if (errors.length > 20) console.log(`  ... ${errors.length - 20} more (use --json)`)
  }

  if (opts.list) {
    console.log('\nParameterized files:')
    for (const f of param.sort((a, b) => b.parameters - a.parameters)) {
      console.log(`${pad(f.parameters, 4)}  ${f.root}/${f.library === '.' ? '' : f.library + '/'}${f.file}`)
    }
  }
}

const opts = parseArgs(process.argv.slice(2))
const files = survey(opts)
if (opts.json) console.log(JSON.stringify(files, null, 2))
else report(files, opts)
