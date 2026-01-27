/**
 * Test that all example files can be loaded and executed without errors.
 * This catches regressions like broken parameter defaults, missing imports, etc.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

// Import jscad modeling - this is aliased in package.json to @jbroll/jscad-modeling
const jscad = nodeRequire('@jscad/modeling')

// Import params-core for proxy mode (how the app runs all examples)
const { createParamsProxy, createProxyState, convertLegacyDefs, injectLegacyDefs } = nodeRequire('@jscadui/params-core')

// Cache for loaded modules (for relative requires)
const moduleCache = new Map()

/**
 * Create a mock require function that provides @jscad/modeling and supports relative paths
 */
const createMockRequire = (basePath) => {
  return (moduleName) => {
    if (moduleName === '@jscad/modeling') {
      return jscad
    }
    // Handle relative requires
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const fullPath = resolve(dirname(basePath), moduleName)
      if (moduleCache.has(fullPath)) {
        return moduleCache.get(fullPath)
      }
      const mod = loadExample(fullPath)
      moduleCache.set(fullPath, mod)
      return mod
    }
    throw new Error(`Unknown module: ${moduleName}`)
  }
}

/**
 * Execute a CommonJS example script and return the exports
 */
const loadExample = (filePath) => {
  const source = readFileSync(filePath, 'utf-8')
  const mockRequire = createMockRequire(filePath)
  const exports = {}
  const module = { exports }

  // Use Function constructor to avoid strict mode issues with eval
  const fn = new Function('require', 'exports', 'module', source)
  fn(mockRequire, exports, module)

  return module.exports
}

// Get all example files
const examplesDir = join(__dirname, 'examples')
const exampleFiles = readdirSync(examplesDir, { recursive: true })
  .filter(f => f.endsWith('.example.js') || f === 'jscad.example.js')
  .map(f => join(examplesDir, f))

describe('Example files', () => {
  describe.each(exampleFiles.map(f => [f.replace(examplesDir + '/', ''), f]))(
    '%s',
    (_name, filePath) => {
      it('should load without errors', () => {
        // Clear cache for fresh load
        moduleCache.clear()
        const mod = loadExample(filePath)
        expect(mod).toBeDefined()
        expect(typeof mod.main).toBe('function')
      })

      it('should execute main() with params proxy', () => {
        // Clear cache for fresh load
        moduleCache.clear()
        const mod = loadExample(filePath)

        // Check if this is a legacy script (has getParameterDefinitions)
        const isLegacy = typeof mod.getParameterDefinitions === 'function'

        // Create params proxy with appropriate mode
        // - Legacy scripts use 'flat' mode (returns undefined for unknown props)
        // - Hierarchical scripts use 'hierarchical' mode (creates child proxies)
        const state = createProxyState({}, new Set(), { mode: isLegacy ? 'flat' : 'hierarchical' })
        const params = createParamsProxy(state)

        // Inject legacy parameter definitions if available
        if (isLegacy) {
          const defs = mod.getParameterDefinitions()
          const proxyDefs = convertLegacyDefs(defs)
          injectLegacyDefs(params, proxyDefs)
        }

        // Execute main - should not throw
        const result = mod.main(params)
        expect(result).toBeDefined()
      })
    }
  )
})
