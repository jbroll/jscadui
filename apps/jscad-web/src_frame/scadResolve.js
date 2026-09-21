// Include resolution for OpenSCAD use/include, shared by the frame worker and
// its tests. The transpiler hands each resolved file's bare pathname back as
// fromFile, and a blob worker's self.location.origin is the string 'null', so
// the transpile entry url's origin is the only base available.

const isAbsoluteUrl = (path) => path.startsWith('http://') || path.startsWith('https://')

const dirOf = (path) => path.replace(/\/[^/]*$/, '/')

// OPENSCADPATH-like fallback: a library's own root, e.g. /examples/openscad/bosl2.
const libraryDir = (contextFile) => {
  const match = contextFile.match(/(.*\/openscad\/[^/]+)(?:\/|$)/)
  return match ? match[1] : null
}

/**
 * Absolute URLs to try for `filename` included from `fromFile`, in order.
 * @param {string} filename
 * @param {string|undefined} fromFile path or URL of the including file
 * @param {string} entryUrl URL of the file that started the transpile
 * @returns {string[]}
 */
export const includeCandidates = (filename, fromFile, entryUrl) => {
  let origin
  try {
    origin = new URL(entryUrl).origin
  } catch {
    return []
  }
  if (origin === 'null') return []

  const context = fromFile || entryUrl
  const base = dirOf(context)
  const baseUrl = isAbsoluteUrl(base) ? base : new URL(base, origin).href

  const candidates = [new URL(filename, baseUrl).toString()]
  const libDir = libraryDir(context)
  if (libDir) {
    const libUrl = new URL(`${libDir}/${filename}`, origin).toString()
    if (libUrl !== candidates[0]) candidates.push(libUrl)
  }
  return candidates
}

// A SPA host serves index.html (200) for a missing path; .scad never starts with
// an HTML doctype, so this detects that fallback as not-found.
const HTML_DOC = new RegExp('^\\uFEFF?\\s*<(?:!doctype html|html[\\s>])', 'i')

export const isSpaFallback = (content) => typeof content === 'string' && HTML_DOC.test(content)
