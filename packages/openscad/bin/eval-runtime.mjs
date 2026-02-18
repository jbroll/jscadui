#!/usr/bin/env node
/**
 * Fast runtime evaluator for testing OpenSCAD runtime functions.
 *
 * Usage:
 *   node bin/eval-runtime.mjs "console.log(j$.sinDeg(720))"
 *   echo "console.log(j$.sinDeg(720))" | node bin/eval-runtime.mjs
 *
 * The j$ object and jscad (@jscad/modeling) are available.
 * Runtime is fully initialized so geometry functions work.
 *
 * Example tests:
 *   node bin/eval-runtime.mjs "console.log(j$.sinDeg(720))"
 *   node bin/eval-runtime.mjs "const s = j$.sphere({r:5}); console.log(s.polygons.length)"
 *   node bin/eval-runtime.mjs "console.log(j$.rotateExtrude({angle:-11.35}, j$.circle({r:5})))"
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load @jscad/modeling via CommonJS require (it's CJS)
const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')

// Load runtime
const runtimePath = join(__dirname, '..', '..', 'openscad-runtime', 'src', 'index.js')
const rt = await import(runtimePath)

// Initialize j$ with jscad
rt.j$.init(jscad)
const j$ = rt.j$

// Get code from arg or stdin
let code = process.argv[2]
if (!code) {
  code = readFileSync('/dev/stdin', 'utf8')
}

// Evaluate with j$ and jscad in scope
const fn = new Function('j$', 'jscad', `"use strict";\n${code}`)
fn(j$, jscad)
