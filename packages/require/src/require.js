/* TODO
- different urls base for local files and modules
- require localized for a specific local file
- require localized for a module url (if module calls require ./)
- use local cache for local files
- use moduleCache for modules
- inspect package.json to see if there is cjs already pre-built
- add .js to local requires (but for modules)
  - local files start with ./ or ../  and others are considered modules
- typescript import must use .js (it is a bit strange, but probably has good reasons)
*/

import { extractPathInfo } from '../../fs-provider/fs-provider'
import { MODULE_BASE, getExtension } from './resolveUrl'
import { wrapLegacyModule } from '../../params-core/src/createParamsProxy.js'
import { cacheManager } from './caching/cacheManager.js'
import { moduleResolver } from './resolution/moduleResolver.js'

export { resolveUrl } from './resolveUrl'

/**
 * Pluggable source handlers for non-standard file types.
 *
 * Map from lowercase extension (without dot) to a handler function:
 *   (source: string, url: string, readFile: Function) => string
 *
 * The handler receives the raw source text and must return JavaScript source
 * ready for eval(). The url is the fully-resolved URL of the file.
 *
 * Register before the first require() call:
 *   requireHandlers.set('scad', (source, url, readFile) => transpileToJs(source, url, readFile))
 */
export const requireHandlers = new Map()

// initially new Function was used to pass parameters: require, exports, module
// new Functions screws with sourcemaps as it adds a prefix to the source
// we need eval to do the same without prefix
// https://esbuild.github.io/content-types/#direct-eval
// to be nice to bundlers we need indirect eval
//
// SECURITY NOTE (FALSE POSITIVE): Intentional code execution - JSCAD is a script playground.
// User scripts run in an isolated Worker context. This eval is fundamental to the app's
// purpose of executing user-provided CAD modeling scripts. This is by design.
export const runModule = globalThis.eval('(require, exports, module, source)=>eval(source)')

/**
 * @typedef SourceWithUrl
 * @prop {string} url
 * @prop {string} script
 */

/**
 * 
 * @param {SourceWithUrl | string} urlOrSource 
 * @param {*} transform 
 * @param {(path:string,options?:{base:string,output:string})=>string} readFile 
 * @param {string} base 
 * @param {string} root 
 * @param {*} importData 
 * @param {*} moduleBase 
 * @returns 
 */
export const require = (urlOrSource, transform, readFile, base, root, importData = null, moduleBase = MODULE_BASE) => {
  /** @type {string | undefined} */
  let source
  /** @type {string} */
  let url
  let isRelativeFile
  let cacheUrl
  let bundleAlias
  if (typeof urlOrSource === 'string') {//Only the URL is given
    url = urlOrSource
  } else { //URL and source are given (this is the main file)
    source = urlOrSource.script
    url = urlOrSource.url
    isRelativeFile = true
  }
  let exports
  let resolvedUrl = url

  if (source === undefined) {
    bundleAlias = cacheManager.getBundleAlias(url)

    const resolved = moduleResolver.resolve(url, base, root, moduleBase)
    const resolvedStr = resolved.url.toString()
    const urlComponents = resolvedStr.split('/')
    const resolvedExt = getExtension(resolvedStr)
    // no file ext is usually module from CDN; registered handlers are also treated as JS-like
    const isJs = !urlComponents[urlComponents.length - 1].includes('.') || resolvedStr.endsWith('.ts') || resolvedStr.endsWith('.js') || requireHandlers.has(resolvedExt)
    if (!isJs && importData) {
      const info = extractPathInfo(resolvedStr)
      const content = readFile(resolvedStr, { output: importData.isBinaryExt(info.ext) })
      return importData.deserialize(info, content)
    }

    isRelativeFile = resolved.isRelativeFile
    resolvedUrl = resolved.url
    cacheUrl = resolved.url
    cacheManager.trackDependency(base, cacheUrl) // Mark this module as a dependency of the base module

    exports = cacheManager.get(cacheUrl, isRelativeFile) // get from cache (O(1) LRU update)

    if (!exports) {
      // not cached

      // Check for circular dependency
      // FP5: Check-then-add to loading set is safe - JavaScript is single-threaded within
      // a worker context. Async/await boundaries don't create true concurrency here.
      if (cacheManager.isLoading(cacheUrl)) {
        throw new Error(`Circular dependency detected: ${url} is already being loaded`)
      }
      cacheManager.markLoading(cacheUrl)

      // H8 fix: Wrap the entire loading block in try-finally to ensure loading set cleanup
      // even if errors occur during readFile or other operations
      try {
        //Clear the known dependencies of the old version this module
        cacheManager.clearDependencies(cacheUrl)
        try {
          source = readFile(resolvedUrl)
          if (resolvedUrl.includes('cdn.jsdelivr.net')) {
            // jsdelivr will read package.json and tell us what the main file is
            const srch = ' * Original file: '
            const idx = source.indexOf(srch)
            if (idx != -1) {
              const idx2 = source.indexOf('\n', idx + srch.length + 1)
              const rawRedirect = source.substring(idx + srch.length, idx2)
              // C4 fix: Check for path traversal in raw string BEFORE URL parsing
              // URL constructor normalizes paths, making post-parse checks ineffective
              if (rawRedirect.includes('..') || rawRedirect.includes('%2e%2e') || rawRedirect.includes('%2E%2E')) {
                console.warn('Ignoring jsdelivr redirect with path traversal:', rawRedirect)
              } else {
                const realFile = new URL(rawRedirect, resolvedUrl).toString()
                // Validate that the redirect URL origin is exactly cdn.jsdelivr.net to prevent redirect attacks
                try {
                  const redirectUrl = new URL(realFile)
                  if (redirectUrl.origin === 'https://cdn.jsdelivr.net') {
                    resolvedUrl = base = realFile
                  } else {
                    console.warn('Ignoring suspicious jsdelivr redirect:', realFile)
                  }
                } catch {
                  console.warn('Invalid jsdelivr redirect URL:', realFile)
                }
              }
            }
          }
        } catch (e) {
          // L3 fix: Only try .ts fallback for 404/not-found errors, not other failures
          // Note: Node.js ENOENT errors say "no such file or directory", not "not found"
          const isNotFound = e.message?.includes('not found') || e.message?.includes('404') || e.message?.includes('no such file')

          // For .scad files, try library path searching before giving up
          if (resolvedUrl.endsWith('.scad') && isNotFound) {
            const filename = url.split('/').pop()

            // Dynamically extract library directory from the base path
            // Example: "./examples/openscad/bosl2/01-core/file.scad" → "bosl2"
            const getLibraryPaths = (basePath) => {
              const allPaths = [
                './examples/openscad/bosl/lib/',
                './examples/openscad/bosl2/lib/',
                './examples/openscad/snippets/lib/',
              ]

              if (!basePath) return allPaths

              // Extract library name from path like "/examples/openscad/{library}/..."
              const match = basePath.match(/\/openscad\/([^/]+)\//)
              if (match && match[1]) {
                const library = match[1]
                const libraryPath = `./examples/openscad/${library}/lib/`

                // Put the matching library first, then others
                return [
                  libraryPath,
                  ...allPaths.filter(p => p !== libraryPath)
                ]
              }

              return allPaths
            }

            const libraryPaths = getLibraryPaths(base)
            let found = false
            for (const libPath of libraryPaths) {
              try {
                const testUrl = new URL(libPath + filename, self.location.origin).toString()
                source = readFile(testUrl)
                resolvedUrl = testUrl
                found = true
                break
              } catch (_libError) {
                // Continue searching
              }
            }
            if (!found) {
              throw new Error(`failed to load module ${url}\n  ${e}`)
            }
          } else if (resolvedUrl.endsWith('.js') && isNotFound) {
            try {
              resolvedUrl = resolvedUrl.replace(/\.js$/, '.ts')
              source = readFile(resolvedUrl)
            } catch (_e2) {
              console.error('failed to load fallback .ts')
              throw new Error(`failed to load module ${url}\n  ${e}`)
            }
          } else {
            throw new Error(`failed to load module ${url}\n  ${e}`)
          }
        }
      } catch (loadError) {
        // H8 fix: Clean up loading set on error during the loading phase
        cacheManager.unmarkLoading(cacheUrl)
        throw loadError
      }
    }
  }
  try {
    if (source !== undefined) {
      const extension = getExtension(resolvedUrl)
      // https://cdn.jsdelivr.net/npm/@jscad/svg-serializer@2.3.13/index.js uses require to read package.json
      if (extension === 'json') {
        exports = JSON.parse(source)
      } else {
        // Check for a registered extension handler (e.g. '.scad' → JavaScript)
        const extHandler = requireHandlers.get(extension)
        if (extHandler) {
          source = extHandler(source, resolvedUrl, readFile)
        } else if (transform && !bundleAlias) {
          // do not transform bundles that are already cjs ( requireCache.bundleAlias.*)
          source = transform(source, resolvedUrl).code
        }
      }
      // construct require function relative to resolvedUrl
      const requireFunc = newUrl => require(newUrl, transform, readFile, resolvedUrl, root, importData, moduleBase)
      const module = requireModule(url, resolvedUrl, source, requireFunc)
      module.local = isRelativeFile
      exports = module.exports
      // import jscad from "@jscad/modeling";
      // will be effectively transformed to
      // const jscad = require('@jscad/modeling').default
      // we need to plug-in default if missing
      if (!('default' in exports)) exports.default = exports

      // Auto-wrap legacy modules that have getParameterDefinitions
      // This promotes them to work with the params proxy system
      if (typeof exports.main === 'function' && typeof exports.getParameterDefinitions === 'function') {
        const wrappedMain = wrapLegacyModule(exports)
        exports.main = wrappedMain
        // Keep getParameterDefinitions for inspection but mark as wrapped
        exports._legacyWrapped = true
      }
    }

    // Cache the module exports
    if (cacheUrl) {
      cacheManager.set(cacheUrl, exports, isRelativeFile) // O(1) LRU-managed cache
    }

    return exports // require returns object exported by module
  } finally {
    // Always remove from loading set, even on error (C3 fix)
    if (cacheUrl) {
      cacheManager.unmarkLoading(cacheUrl)
    }
  }
}

const requireModule = (id, url, source, _require) => {
  try {
    const exports = {}
    const module = { id, uri: url, exports, source } // according to node.js modules
    //module.require = _require
    source += '\n//# sourceURL=' + url
    runModule(_require, exports, module, source)
    return module
  } catch (err) {
    err.message += ` / failed loading module ${id}`
    throw err
  }
}

/**
 * @typedef ClearFileCacheOptions
 * @prop {Array<String>} files
 * @prop {string} root
 */

/**
 * Clear file cache for specific files. Used when a file has changed.
 * @param {ClearFileCacheOptions} obj
 */
export const clearFileCache = ({ files, root }) => {
  cacheManager.clearFileCache(files, root)
}

/**
 * Clear project-specific cache including dependency tracking
 */
export const jscadClearTempCache = () => {
  cacheManager.clearTempCache()
}

/**
 * Clear all caches including module cache
 * Use this for long-running applications to prevent unbounded memory growth
 */
export const clearAllCaches = () => {
  cacheManager.clearAllCaches()
}

/**
 * Legacy requireCache object for backward compatibility
 * @deprecated Use cacheManager methods directly
 */
export const requireCache = cacheManager.getLegacyCacheObjects()
