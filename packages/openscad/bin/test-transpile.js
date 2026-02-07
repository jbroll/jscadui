#!/usr/bin/env node

/**
 * Test the new transpiler with module support
 */

import { parse } from '../esm/parser/parse.js'
import { transpile } from '../esm/transpiler/transpile.js'

// Simulated file system for testing multi-file support
const virtualFiles = {
  'hardware.scad': `
module Bolt(length = 20, diameter = 5) {
  cylinder(h = length, r = diameter/2);
}

module Nut(size = 10) {
  difference() {
    cube(size, center = true);
    cylinder(h = size + 1, r = size/4, center = true);
  }
}

module Washer(outer = 12, inner = 6, thickness = 2) {
  difference() {
    cylinder(h = thickness, r = outer/2);
    cylinder(h = thickness + 1, r = inner/2);
  }
}
`,
  'utils.scad': `
function double(x) = x * 2;
function half(x) = x / 2;
function clamp(x, lo, hi) = min(max(x, lo), hi);
`
}

// File resolver that uses the virtual file system
const fileResolver = (filename) => virtualFiles[filename]

// Test case 1: Simple module definition
const test1 = `
module Box(size = 10) {
  cube(size);
}

Box(20);
`

// Test case 2: Multiple modules with dependencies
const test2 = `
module Bolt(length = 20, diameter = 5) {
  cylinder(h = length, r = diameter/2);
}

module Nut(size = 10) {
  difference() {
    cube(size, center = true);
    cylinder(h = size + 1, r = size/4, center = true);
  }
}

module Assembly() {
  Bolt();
  translate([0, 0, 25]) Nut();
}

Assembly();
`

// Test case 3: use statement WITH file resolver
const test3 = `
use <hardware.scad>

Bolt(length = 30);
Nut(size = 15);
Washer();
`

// Test case 4: Multiple use statements
const test4 = `
use <hardware.scad>
use <utils.scad>

module ScaledBolt(scale = 1) {
  Bolt(length = double(20 * scale));
}

ScaledBolt(2);
`

console.log('=== Test 1: Simple module ===')
try {
  const result1 = parse(test1)
  const output1 = transpile(result1.ast)
  console.log(output1.code)
  console.log('\nExports:', output1.exports)
} catch (e) {
  console.error('Error:', e.message)
}

console.log('\n=== Test 2: Multiple modules ===')
try {
  const result2 = parse(test2)
  const output2 = transpile(result2.ast)
  console.log(output2.code)
  console.log('\nExports:', output2.exports)
} catch (e) {
  console.error('Error:', e.message)
}

console.log('\n=== Test 3: use statement with file resolver ===')
try {
  const result3 = parse(test3)
  // Pass file resolver to discover imported symbols
  const output3 = transpile(result3.ast, { fileResolver })
  console.log(output3.code)
  console.log('\nExports:', output3.exports)
  console.log('Imports:', output3.imports)
} catch (e) {
  console.error('Error:', e.message)
}

console.log('\n=== Test 4: Multiple use statements ===')
try {
  const result4 = parse(test4)
  const output4 = transpile(result4.ast, { fileResolver, currentFile: 'main.scad' })
  console.log(output4.code)
  console.log('\nExports:', output4.exports)
  console.log('Imports:', output4.imports)
  console.log('\n--- All transpiled files ---')
  for (const [filename, file] of output4.files) {
    console.log(`\n[${filename}] exports: ${file.exports.join(', ')}`)
    console.log(file.code.split('\n').slice(0, 10).join('\n') + '\n...')
  }
} catch (e) {
  console.error('Error:', e.message, e.stack)
}
