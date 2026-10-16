import { dirname, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * V1 `include(path)` inlines the target file into the including source,
 * matching V1 semantics where the included file shares global scope
 * (functions/vars visible both ways). Recursive with a seen-set, so each
 * file inlines once (cycle-safe).
 *
 * A line counts as an include directive only when the whole (trimmed) line
 * is `include('...')` / `include("...")` — the form V1 models use.
 */
const INCLUDE_LINE = /^\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/

/**
 * Candidate roots for resolving an include path: the including file's own
 * directory, plus the nearest ancestor holding a `library/` dir (the tspspi
 * layout: models reference `/mechanics/...` living under `<suite>/library/`).
 */
export function defaultRoots(fromFile, readDir) {
  const roots = [dirname(fromFile)]
  let dir = dirname(fromFile)
  while (true) {
    const lib = resolve(dir, 'library')
    if (readDir ? readDir(lib) : existsSync(lib)) {
      roots.push(lib)
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

const joinRoot = (root, includePath) =>
  includePath.startsWith('/')
    ? resolve(root, includePath.slice(1).split('/').join(sep))
    : resolve(root, includePath)

/**
 * @param {string} source - including file's source
 * @param {string} fromFile - absolute path of the including file (for relatives)
 * @param {{readFile: (absPath: string) => string | undefined, roots?: string[], seen?: Set<string>}} io
 * @returns inlined source; throws when a target cannot be resolved
 */
export function inlineIncludes(source, fromFile, { readFile, roots, seen = new Set() }) {
  const searchRoots = roots ?? defaultRoots(fromFile)
  const lines = source.split('\n')
  let depth = 0
  return lines.map((line) => {
    // Directives inside block comments (e.g. usage examples in header docs)
    // are left alone: splicing file content there would let an injected */
    // close the outer comment early and expose doc text as code.
    const commented = depth > 0
    const opens = (line.match(/\/\*/g) || []).length
    const closes = (line.match(/\*\//g) || []).length
    depth = Math.max(0, depth + opens - closes)
    if (commented) return line
    const m = line.match(INCLUDE_LINE)
    if (!m) return line
    const includePath = m[1]
    const target = searchRoots.map((r) => joinRoot(r, includePath)).find((p) => readFile(p) !== undefined)
    if (!target) {
      throw new Error(`v1 include: cannot resolve '${includePath}' from '${fromFile}'`)
    }
    if (seen.has(target)) {
      return `// already included: ${includePath}`
    }
    seen.add(target)
    const content = readFile(target)
    const inlined = inlineIncludes(content, target, { readFile, roots: searchRoots, seen })
    return `// inlined from ${includePath}\n${inlined}`
  }).join('\n')
}
