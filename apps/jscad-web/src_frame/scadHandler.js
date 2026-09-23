import { includeCandidates, isSpaFallback } from './scadResolve.js'

const FAILURE_CACHE_TTL = 60000

// Normalise a URL or path to an absolute path for use as a cache key.
// No self.location.origin here: in a blob worker that base is 'null', so
// absolute URLs parse on their own.
const toCachePath = (urlOrPath) => {
  try {
    return new URL(urlOrPath).pathname
  } catch {
    return urlOrPath
  }
}

/**
 * The require handler for .scad files: transpile to JS, resolving use/include
 * through scadResolve.js, with a cache of transpiled files and of failed reads.
 * @param {object} options
 * @param {() => {parse: Function, transpile: Function}} options.getOpenscad
 * @param {() => string | null} options.getAppOrigin
 * @param {() => number} [options.now]
 */
export const createScadHandler = ({ getOpenscad, getAppOrigin, now = Date.now }) => {
  // Failed include reads, so one transpile does not fetch the same 404 for
  // every file that includes it.
  const failureCache = new Map()

  // path -> transpiled JS source
  const transpiledCache = new Map()

  // Shared transpiler cache: persists TranspiledFile objects across jscadScript
  // calls so the transpiler can skip re-processing unchanged dependencies.
  const workerSharedCache = new Map()

  const handle = (source, url, readFile) => {
    const urlPath = toCachePath(url)

    if (transpiledCache.has(urlPath)) {
      return transpiledCache.get(urlPath)
    }
    const { parse, transpile } = getOpenscad()

    const { ast, errors } = parse(source, url)
    if (errors.length > 0) {
      for (const err of errors) console.warn(`OpenSCAD parse warning in ${url}:`, err.message)
    }

    const attempts = []

    const tryFetch = (testUrl) => {
      const failTime = failureCache.get(testUrl)
      if (failTime && (now() - failTime) < FAILURE_CACHE_TTL) {
        return undefined
      }
      let content
      let reason
      try {
        content = readFile(testUrl)
        if (content !== undefined && isSpaFallback(content)) reason = 'server returned an html fallback'
      } catch (error) {
        content = undefined
        reason = error?.message ?? String(error)
      }
      if (content !== undefined && !reason) {
        failureCache.delete(testUrl)
        return content
      }
      // A worker inside a cross-origin frame has no console anyone can read, so
      // the attempts ride the error instead.
      attempts.push(`${testUrl} — ${reason ?? 'no content'}`)
      failureCache.set(testUrl, now())
      return undefined
    }

    const fileResolver = (filename, fromFile) => {
      for (const candidate of includeCandidates(filename, fromFile, url, getAppOrigin())) {
        const content = tryFetch(candidate)
        if (content !== undefined) return { path: toCachePath(candidate), content }
      }
      return undefined
    }

    const result = transpile(ast, {
      fileResolver,
      currentFile: urlPath,
      includeHeader: true,
    }, workerSharedCache)

    if (result.errors && result.errors.length > 0) {
      const criticalErrors = result.errors.filter(e =>
        e.code === 'FILE_NOT_FOUND' || e.code === 'PARSE_ERROR'
      )
      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => e.message).join('; ')
        const tried = attempts.length ? ` [tried ${attempts.join(' | ')}]` : ' [no candidate urls]'
        throw new Error(`OpenSCAD transpilation failed: ${errorMessages}${tried}`)
      }
      for (const err of result.errors) {
        console.warn(`OpenSCAD transpile warning in ${url}:`, err.message)
      }
    }

    if (result.files && result.files.size > 0) {
      for (const [filePath, fileData] of result.files) {
        transpiledCache.set(filePath, fileData.code)
      }
    }
    transpiledCache.set(urlPath, result.code)

    return result.code
  }

  return {
    handle,
    clearFailures: () => failureCache.clear(),
    clearTranspiled: () => {
      transpiledCache.clear()
      workerSharedCache.clear()
    },
    /** @param {string[]} files */
    forgetFiles: (files) => {
      for (const file of files) transpiledCache.delete(toCachePath(file))
    },
  }
}
