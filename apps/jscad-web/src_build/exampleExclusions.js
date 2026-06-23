import { existsSync, readFileSync } from 'fs'
import { join, relative, dirname, basename } from 'path'

export function loadPatternFile(dir, name) {
  const f = join(dir, name)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

// exclude.txt: anchored to dir, trailing '/' = subtree, '*' does not cross '/'.
export function matchesExclude(rel, patterns) {
  for (const raw of patterns) {
    let p = raw.startsWith('/') ? raw.slice(1) : raw
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.slice(0, -1)
    const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (dirOnly ? '(/.*)?$' : '$'))
    if (rx.test(rel)) return true
  }
  return false
}

// skip.txt: matched against the relative path or basename.
export function matchesSkip(rel, patterns) {
  const base = basename(rel)
  for (const raw of patterns) {
    const rx = new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    if (rx.test(rel) || rx.test(base)) return true
  }
  return false
}

/** True if any exclude.txt/skip.txt from an ancestor dir excludes this path. */
export function isExcluded(absPath, examplesRoot) {
  let dir = dirname(absPath)
  while (dir.length >= examplesRoot.length) {
    const exclude = loadPatternFile(dir, 'exclude.txt')
    const skip = loadPatternFile(dir, 'skip.txt')
    if (exclude.length || skip.length) {
      const rel = relative(dir, absPath)
      if (matchesExclude(rel, exclude) || matchesSkip(rel, skip)) return true
    }
    if (dir === examplesRoot) break
    dir = dirname(dir)
  }
  return false
}
