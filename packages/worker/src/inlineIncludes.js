/**
 * V1 `include(path)` inlines the target file into the including source,
 * matching V1 semantics where the included file shares global scope
 * (functions/vars visible both ways). Recursive with a seen-set, so each
 * file inlines once (cycle-safe).
 *
 * A line counts as an include directive only when the whole (trimmed) line
 * is `include('...')` / `include("...")` — the form V1 models use.
 *
 * Synchronous with sync reads on purpose: the `require()` extension-handler
 * path (packages/require) that serves grid items and demo loads is sync
 * (sync XHR in the worker, fs reads in Node). Async callers (fileSystem
 * project cache) use the same reads. No Node builtins: paths are
 * posix-style (URLs and repo paths alike), so this runs in the frame
 * worker and the app bundle as well as Node.
 */
const INCLUDE_LINE = /^\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/

const splitPath = (p) => p.split('/').filter((s) => s !== '' && s !== '.')

// Join posix segments, resolving `.` and `..`. Keeps a leading `/` and
// never escapes above it; relative results stay relative.
function joinPosix(...parts) {
  const absolute = parts.some((p) => p.startsWith('/'))
  const out = []
  for (const seg of parts.flatMap(splitPath)) {
    if (seg === '..') {
      if (out.length > 0) out.pop()
    } else {
      out.push(seg)
    }
  }
  return (absolute ? '/' : '') + out.join('/')
}

const dirnamePosix = (p) => {
  const idx = p.replace(/\/$/, '').lastIndexOf('/')
  if (idx === -1) return '.'
  if (idx === 0) return '/'
  return p.slice(0, idx)
}

/**
 * Candidate roots for resolving an include path: the including file's own
 * directory, plus every ancestor holding a `library/` dir (the tspspi
 * layout: models reference `/mechanics/...` living under `<suite>/library/`).
 * Pure: takes an optional `hasDir` probe; without one every ancestor
 * `library/` is offered and resolution tries each in order.
 */
export function defaultRoots(fromFile, hasDir) {
  const roots = [dirnamePosix(fromFile)]
  let dir = dirnamePosix(fromFile)
  while (true) {
    const lib = joinPosix(dir, 'library')
    if (!hasDir || hasDir(lib)) {
      roots.push(lib)
      if (hasDir) break
    }
    const parent = dirnamePosix(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

const joinRoot = (root, includePath) =>
  includePath.startsWith('/') ? joinPosix(root, includePath.slice(1)) : joinPosix(root, includePath)

/**
 * Static hosts rewrite unknown paths to the SPA's index.html (HTTP 200), so
 * a missing include arrives as markup rather than a failed read. Markup can
 * never be valid inlined JS, so treat it as missing: resolution keeps trying
 * further roots instead of splicing HTML into the module (which evals to
 * `Unexpected token '<'`). Every readFile implementation (sync XHR in the
 * worker, fs in Node) shares this contract.
 */
const isMarkup = (content) => typeof content === 'string' && /^\s*(<!doctype|<html)/i.test(content)

/**
 * @param {string} source - including file's source
 * @param {string} fromFile - path of the including file (for relatives)
 * @param {{readFile: (absPath: string) => string | undefined, roots?: string[], seen?: Set<string>}} io
 * @returns inlined source; throws when a target cannot be resolved.
 * `readFile` returns undefined for missing files (never throws).
 */
export function inlineIncludes(source, fromFile, { readFile, roots, seen = new Set() }) {
  const searchRoots = roots ?? defaultRoots(fromFile)
  const lines = source.split('\n')
  let depth = 0
  const out = []
  for (const line of lines) {
    // Directives inside block comments (e.g. usage examples in header docs)
    // are left alone: splicing file content there would let an injected */
    // close the outer comment early and expose doc text as code.
    const commented = depth > 0
    const opens = (line.match(/\/\*/g) || []).length
    const closes = (line.match(/\*\//g) || []).length
    depth = Math.max(0, depth + opens - closes)
    if (commented) {
      out.push(line)
      continue
    }
    const m = line.match(INCLUDE_LINE)
    if (!m) {
      out.push(line)
      continue
    }
    const includePath = m[1]
    let target
    for (const r of searchRoots) {
      const p = joinRoot(r, includePath)
      const content = readFile(p)
      if (content !== undefined && !isMarkup(content)) {
        target = { path: p, content }
        break
      }
    }
    if (!target) {
      throw new Error(`v1 include: cannot resolve '${includePath}' from '${fromFile}'`)
    }
    if (seen.has(target.path)) {
      out.push(`// already included: ${includePath}`)
      continue
    }
    seen.add(target.path)
    out.push(`// inlined from ${includePath}`)
    out.push(inlineIncludes(target.content, target.path, { readFile, roots: searchRoots, seen }))
  }
  return out.join('\n')
}
