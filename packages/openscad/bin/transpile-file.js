#!/usr/bin/env node

/**
 * Transpile a single .scad file using the new transpiler
 *
 * Usage:
 *   transpile-file.js <file.scad>        - Transpile and print JavaScript
 *   transpile-file.js <file.scad> --run  - Transpile and execute (uses in-memory require)
 *   transpile-file.js <file.scad> --info - Show exports, imports, and all transpiled files
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { parse } from '../esm/parser/parse.js'
import { transpile } from '../esm/transpiler/transpile.js'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const runMode = args.includes('--run')
const infoMode = args.includes('--info')

if (!file) {
  console.error('Usage: transpile-file.js <file.scad> [--run] [--info]')
  console.error('')
  console.error('Options:')
  console.error('  --run   Transpile and execute (multi-file supported via in-memory require)')
  console.error('  --info  Show exports, imports, and all transpiled files')
  process.exit(1)
}

// Resolve the file path
const filePath = resolve(file)
const fileDir = dirname(filePath)
const fileName = basename(filePath)

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

const source = readFileSync(filePath, 'utf8')
const { ast, errors } = parse(source)

if (errors.length > 0) {
  console.error('Parse errors:', errors)
  process.exit(1)
}

/**
 * File resolver for use statements
 * Resolves relative to the directory containing the current file
 */
function fileResolver(filename, fromFile) {
  // Resolve relative to the source file's directory
  const baseDir = fromFile ? dirname(resolve(fileDir, fromFile)) : fileDir
  const targetPath = resolve(baseDir, filename)

  if (existsSync(targetPath)) {
    return readFileSync(targetPath, 'utf8')
  }

  console.error(`Warning: Could not resolve ${filename} from ${fromFile || fileName}`)
  return undefined
}

const result = transpile(ast, {
  fileResolver,
  currentFile: fileName,
})

if (infoMode) {
  console.log('=== Transpile Result ===')
  console.log('Exports:', result.exports)
  console.log('Imports:', result.imports)
  console.log('')
  console.log('=== Transpiled Files ===')
  for (const [name, file] of result.files) {
    console.log(`\n[${name}]`)
    console.log(`  exports: ${file.exports.join(', ')}`)
  }
  console.log('')
  console.log('=== Main File Code ===')
}

console.log(result.code)

if (runMode) {
  console.log('\n=== Execution Result ===')
  try {
    // Create a module context with require support
    const Module = await import('module')
    const createRequire = Module.createRequire || Module.default?.createRequire

    if (!createRequire) {
      console.error('Cannot create require function')
      process.exit(1)
    }

    const nodeRequire = createRequire(import.meta.url)

    // In-memory module cache for transpiled files
    const moduleCache = new Map()

    // Build cache from transpiled files
    for (const [name, file] of result.files) {
      const jsName = './' + name.replace(/\.scad$/, '.js')
      moduleCache.set(jsName, file.code)
    }

    // Custom require that serves transpiled files from memory
    function customRequire(path) {
      // Check if it's a transpiled file
      if (moduleCache.has(path)) {
        const code = moduleCache.get(path)
        const exports = {}
        const moduleObj = { exports }
        const fn = new Function('require', 'module', 'exports', code)
        fn(customRequire, moduleObj, exports)
        return moduleObj.exports
      }
      // Fall back to node's require for external modules
      return nodeRequire(path)
    }

    // Evaluate the main transpiled code
    const exports = {}
    const moduleObj = { exports }

    // Create a function that has access to our custom require
    const fn = new Function('require', 'module', 'exports', result.code)
    fn(customRequire, moduleObj, exports)

    // Call main if it exists
    if (typeof moduleObj.exports.main === 'function') {
      const geometry = moduleObj.exports.main()
      console.log('main() returned:', typeof geometry)
      if (geometry && typeof geometry === 'object') {
        console.log('  type:', geometry.type || 'unknown')
        if (geometry.polygons) {
          console.log('  polygons:', geometry.polygons.length)
        }
        if (geometry.sides) {
          console.log('  sides:', geometry.sides.length)
        }
      }
    } else {
      console.log('No main function found')
    }
  } catch (e) {
    console.error('Execution error:', e.message)
    console.error(e.stack)
  }
}
