/**
 * Pattern files: skip.txt, compare-skip.txt, echo-skip.txt and exclude.txt.
 *
 * One pattern per line; blank lines and lines starting with # are ignored. A
 * pattern file applies to the paths below its directory, matched against the
 * path relative to that directory:
 *
 *   /x    anchored: matched against the relative path only. * stays within one
 *         path segment, ** crosses segments.
 *   x     unanchored: matched against the relative path or its basename.
 *         * matches anything, / included.
 *   x/    a directory: matches it and everything below it.
 *
 * A path passed in with a trailing / names a directory.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

const escapeRegex = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** Patterns in a pattern file, or [] when it does not exist. */
export function readPatternFile(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

/**
 * Every `filename` at or below the roots, dot-directories skipped, as
 * [{ dir, patterns }] with `dir` absolute. Empty and unreadable files are left out.
 */
export function discoverPatternFiles(roots, filename) {
  const scopes = []
  const walk = dir => {
    try {
      const patterns = readPatternFile(join(dir, filename))
      if (patterns.length) scopes.push({ dir, patterns })
    } catch { /* unreadable: no patterns */ }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(join(dir, entry.name))
    }
  }
  for (const root of [roots].flat()) {
    const abs = resolve(root)
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs)
  }
  return scopes
}

const compiled = new Map()

function compile(pattern, anchored) {
  const key = `${anchored}:${pattern}`
  if (compiled.has(key)) return compiled.get(key)
  const anchor = anchored || pattern.startsWith('/')
  let p = pattern.startsWith('/') ? pattern.slice(1) : pattern
  const dirPattern = p.endsWith('/')
  if (dirPattern) p = p.slice(0, -1)
  const body = anchor
    ? p.split('**').map(part => escapeRegex(part).replace(/\*/g, '[^/]*')).join('.*')
    : escapeRegex(p).replace(/\*/g, '.*')
  let test
  if (dirPattern) {
    const rx = new RegExp(`^${body}/`)
    test = relPath => rx.test(relPath)
  } else {
    const rx = new RegExp(`^${body}$`)
    test = relPath => {
      const path = relPath.endsWith('/') ? relPath.slice(0, -1) : relPath
      return rx.test(path) || (!anchor && rx.test(basename(path)))
    }
  }
  compiled.set(key, test)
  return test
}

/** `anchored: true` reads every pattern as if it began with /. */
export function matchesPattern(relPath, pattern, { anchored = false } = {}) {
  return compile(pattern, anchored)(relPath)
}

export function matchesAny(relPath, patterns, options) {
  return patterns.some(p => matchesPattern(relPath, p, options))
}

/** Whether any scope from discoverPatternFiles() that contains `path` matches it. */
export function matchesScopes(path, scopes, options) {
  const abs = resolve(path)
  const dirSuffix = path.endsWith('/') ? '/' : ''
  return scopes.some(({ dir, patterns }) =>
    abs.startsWith(dir + '/') && matchesAny(relative(dir, abs) + dirSuffix, patterns, options))
}
