/**
 * Test that all example files can be loaded and executed without errors.
 * This catches regressions like broken parameter defaults, missing imports, etc.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { discoverPatternFiles, matchesScopes } from '../../packages/openscad/bin/pattern-files.js'
import { inlineIncludes } from '../../packages/worker/src/inlineIncludes.js'
import { addV1Shim } from '../../packages/worker/src/addV1Shim.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

// Import params-core for proxy mode (how the app runs all examples)
const { createParamsProxy, createProxyState, wrapLegacyModule } = nodeRequire('@jscadui/params-core')
const jscadText = await import('@jscadui/jscad-text')

// Determine which engine(s) to test
// ENGINE=jscad - Test only @jscad/modeling
// ENGINE=manifold - Test only @jscadui/manifold
// (default) - Test both engines
const engineFilter = process.env.ENGINE?.toLowerCase()
const engines = []

if (!engineFilter || engineFilter === 'jscad') {
  engines.push({
    name: '@jscad/modeling',
    module: nodeRequire('@jscad/modeling'), // Aliased to @jbroll/jscad-modeling
  })
}

if (!engineFilter || engineFilter === 'manifold') {
  const manifold = await import('@jscadui/manifold')
  engines.push({
    name: '@jscadui/manifold',
    module: manifold,
    init: manifold.init,
  })
}

// Cache for loaded modules (for relative requires)
const moduleCache = new Map()

/**
 * Create a mock require function that provides the specified engine and supports relative paths.
 * engineName is used as the cache key discriminator (not the module object itself).
 */
const createMockRequire = (basePath, engineModule, engineName) => {
  return (moduleName) => {
    if (moduleName === '@jscad/modeling') {
      return engineModule
    }
    if (moduleName === '@jscad/csg') {
      // V1 .jscad files: the app resolves this to bundle.V1_api.js
      // (src_bundle/bundle.V1_api.js = @jscad/csg/api.js)
      return nodeRequire('@jscad/csg/api.js')
    }
    if (moduleName === '@jscadui/jscad-text') {
      jscadText.init(engineModule)
      return jscadText
    }
    // Handle relative requires
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const fullPath = resolve(dirname(basePath), moduleName)
      const cacheKey = `${fullPath}:${engineName}`
      if (moduleCache.has(cacheKey)) {
        return moduleCache.get(cacheKey)
      }
      const mod = loadExample(fullPath, engineModule, engineName)
      moduleCache.set(cacheKey, mod)
      return mod
    }
    throw new Error(`Unknown module: ${moduleName}`)
  }
}

/**
 * Evaluate source as a CommonJS module with the engine-aware mock require.
 */
const evalSource = (source, filePath, engineModule, engineName) => {
  const mockRequire = createMockRequire(filePath, engineModule, engineName)
  const exports = {}
  const module = { exports }

  // Use Function constructor to avoid strict mode issues with eval
  const fn = new Function('require', 'exports', 'module', source)
  fn(mockRequire, exports, module)

  return module.exports
}

/**
 * Full loader: V1 .jscad files are include-inlined then go through the same
 * addV1Shim transform the app applies, so the harness matches runtime.
 */
const loadExample = (filePath, engineModule, engineName) => {
  let source = readFileSync(filePath, 'utf-8')
  if (filePath.endsWith('.jscad')) {
    source = addV1Shim(inlineIncludes(source, filePath, { readFile: tryRead }))
  }
  return evalSource(source, filePath, engineModule, engineName)
}

// Get all example files, minus anything an ancestor skip.txt names
// (same pattern-file semantics as generate-all-files.js grids).
const examplesDir = join(__dirname, 'examples')
const tryRead = (p) => {
  try { return readFileSync(p, 'utf-8') } catch { return undefined }
}
const skipScopes = discoverPatternFiles(examplesDir, 'skip.txt')
// V2 runnable examples plus V1 .jscad (shimmed at load, like the app)
const exampleFiles = readdirSync(examplesDir, { recursive: true })
  .filter(f => f.endsWith('.example.js') || f === 'jscad.example.js' || f.endsWith('.jscad'))
  .map(f => join(examplesDir, f))
  .filter(f => !matchesScopes(f, skipScopes))

describe('Example files', () => {
  // Initialize engines that require async setup (e.g. Manifold WASM)
  beforeAll(async () => {
    for (const engine of engines) {
      if (engine.init) {
        await engine.init()
      }
    }
  })

  // Test with each engine
  describe.each(engines.map(e => [e.name, e.module]))(
    'Engine: %s',
    (engineName, engineModule) => {
      describe.each(exampleFiles.map(f => [f.replace(examplesDir + '/', ''), f]))(
        '%s',
        (_name, filePath) => {
          it('should load without errors', () => {
            // Clear cache for fresh load
            moduleCache.clear()
            const mod = loadExample(filePath, engineModule, engineName)
            expect(mod).toBeDefined()
            expect(typeof mod.main).toBe('function')
          })

          it('should execute main() with params proxy', () => {
            // Clear cache for fresh load
            moduleCache.clear()
            const mod = loadExample(filePath, engineModule, engineName)

            // Check if this is a legacy script (has getParameterDefinitions)
            const isLegacy = typeof mod.getParameterDefinitions === 'function'

            let result
            if (isLegacy) {
              // Use wrapLegacyModule to create isolated state with sealed proxy
              // This is exactly how ALL.js and the worker handle legacy scripts
              const wrappedMain = wrapLegacyModule(mod)
              result = wrappedMain({})
            } else {
              // Hierarchical scripts: create child proxies for nested parts
              const state = createProxyState({}, new Set(), { mode: 'hierarchical' })
              const params = createParamsProxy(state)
              result = mod.main(params)
            }

            // Execute main - should not throw
            expect(result).toBeDefined()
          })
        }
      )
    }
  )
})
