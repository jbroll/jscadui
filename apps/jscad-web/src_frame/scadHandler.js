import { includeCandidates, isSpaFallback } from './scadResolve.js'
import { PROJECT_BASE } from './fileMap.js'

const FAILURE_CACHE_TTL = 60000

const PROJECT_ORIGIN = new URL(PROJECT_BASE).origin

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// No self.location.origin here: in a blob worker that base is 'null'.
const absolute = (urlOrPath, origin) => {
  try {
    return new URL(urlOrPath, origin ?? undefined).href
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

  // url -> the .scad source its cached entries were built from. An editor run
  // with no project clears nothing, so the source is what shows an edit.
  const sources = new Map()

  // The transpiler's own cache of TranspiledFile objects, kept across runs so
  // it can skip unchanged dependencies. It is keyed by the paths pathFor gives,
  // which are bare on the entry's origin, so there is one per entry origin.
  const sharedCaches = new Map()
  const sharedCacheFor = (origin) => {
    if (!sharedCaches.has(origin)) sharedCaches.set(origin, new Map())
    return sharedCaches.get(origin)
  }

  const handle = (source, url, readFile) => {
    const appOrigin = getAppOrigin()
    let entryOrigin = originOf(url)
    if (!entryOrigin || entryOrigin === 'null') entryOrigin = appOrigin
    const key = absolute(url, entryOrigin)

    if (transpiledCache.has(key) && sources.get(key) === source) {
      return transpiledCache.get(key)
    }

    // The transpiler writes each file's path into a require() call, and
    // require resolves a bare path against the script's root, which is the app
    // or the project. A file anywhere else keeps its origin, both there and as
    // the fromFile its own includes resolve against.
    const bare = entryOrigin === appOrigin || entryOrigin === PROJECT_ORIGIN
    const pathFor = (fileUrl) => {
      try {
        const parsed = new URL(fileUrl)
        return bare && parsed.origin === entryOrigin ? parsed.pathname : parsed.href
      } catch {
        return fileUrl
      }
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

    const shared = sharedCacheFor(entryOrigin)
    const fileResolver = (filename, fromFile) => {
      for (const candidate of includeCandidates(filename, fromFile, url, appOrigin)) {
        const content = tryFetch(candidate)
        if (content === undefined) continue
        const path = pathFor(candidate)
        // The transpiler reads a file before it looks in its cache, so dropping
        // an entry built from other source here makes it build a fresh one.
        if (sources.get(candidate) !== content) shared.delete(path)
        sources.set(candidate, content)
        return { path, content }
      }
      return undefined
    }

    sources.set(key, source)
    const result = transpile(ast, {
      fileResolver,
      currentFile: pathFor(key),
      includeHeader: true,
    }, shared)

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
        transpiledCache.set(absolute(filePath, entryOrigin), fileData.code)
      }
    }
    transpiledCache.set(key, result.code)

    return result.code
  }

  return {
    handle,
    clearFailures: () => failureCache.clear(),
    clearTranspiled: () => {
      transpiledCache.clear()
      sharedCaches.clear()
      sources.clear()
    },
    /**
     * Includes are inlined into their includers, so an edit under `root` drops
     * every file on its origin. Files from other origins stay.
     * @param {string[]} files paths as jscadClearFileCache names them
     * @param {string} [root] the base those paths are relative to
     */
    forgetFiles: (files, root) => {
      const origin = root && originOf(root)
      if (!origin) {
        for (const file of files) transpiledCache.delete(file)
        return
      }
      for (const key of transpiledCache.keys()) {
        if (originOf(key) === origin) transpiledCache.delete(key)
      }
      const shared = sharedCaches.get(origin)
      for (const path of shared?.keys() ?? []) {
        if (path.startsWith('/')) shared.delete(path)
      }
    },
  }
}
