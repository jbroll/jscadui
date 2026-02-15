#!/usr/bin/env node
// Extract simple examples from BOSL2 library files and generate test cases

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const LIB_DIR = 'test/corpus/bosl2/lib'
const OUT_DIR = 'test/corpus/bosl2'

// Libraries that need explicit include (not in std.scad)
const EXPLICIT_INCLUDES = new Set([
  'gears.scad',
  'threading.scad',
  'screws.scad',
  'ball_bearings.scad',
  'linear_bearings.scad',
  'nema_steppers.scad',
  'hinges.scad',
  'bottlecaps.scad',
  'tripod_mounts.scad',
  'modular_hose.scad',
  'cubetruss.scad',
  'wiring.scad',
  'walls.scad',
  'sliders.scad',
  'partitions.scad',
  'turtle3d.scad',
  'nurbs.scad',
  'isosurface.scad',
  'polyhedra.scad',
  'joiners.scad',
  'knurling.scad',
  'metric_screws.scad',
  'screw_drive.scad',
  'skin.scad',
  'beziers.scad',
])

// Parse example blocks from a library file
function extractExamples(content, libName) {
  const examples = []
  const lines = content.split('\n')

  let inExample = false
  let exampleLines = []
  let exampleName = ''
  let skipExample = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for example header
    const exampleMatch = line.match(/^\/\/\s*Examples?\s*(\([^)]*\))?:?\s*(.*)$/)
    if (exampleMatch) {
      // Save previous example if any
      if (inExample && exampleLines.length > 0 && !skipExample) {
        examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
      }

      // Start new example
      inExample = true
      exampleLines = []
      const tags = exampleMatch[1] || ''
      exampleName = exampleMatch[2] || ''

      // Skip certain example types that are complex
      skipExample = tags.includes('2D') ||       // 2D projection examples
                   tags.includes('Anim') ||       // Animation examples
                   tags.includes('NoAxes') ||     // Complex scene setups
                   tags.includes('VPT=') ||       // Viewport transforms
                   tags.includes('VPR=') ||       // Viewport rotations
                   tags.includes('VPD=') ||       // Viewport distance
                   tags.includes('Big') ||        // Big/slow examples
                   tags.includes('NoScales')      // Complex positioning
      continue
    }

    // Check for example code line
    if (inExample) {
      const codeMatch = line.match(/^\/\/\s{2,3}(.+)$/)
      if (codeMatch) {
        exampleLines.push(codeMatch[1])
      } else if (!line.match(/^\/\/\s*$/)) {
        // End of example block (non-comment or non-empty comment)
        if (exampleLines.length > 0 && !skipExample) {
          examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
        }
        inExample = false
        exampleLines = []
        skipExample = false
      }
    }
  }

  // Handle last example
  if (inExample && exampleLines.length > 0 && !skipExample) {
    examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
  }

  return examples
}

// Filter to simple, single-call examples
function isSimpleExample(example) {
  const code = example.code.trim()

  // Skip if too many lines (complex multi-statement)
  const lines = code.split('\n').filter(l => l.trim())
  if (lines.length > 3) return false

  // Skip if contains module/function definitions
  if (code.includes('module ') || code.includes('function ')) return false

  // Skip if contains difference/intersection (complex CSG)
  if (code.includes('difference()') || code.includes('intersection()')) return false

  // Skip if contains position/orient (attachment system)
  if (code.includes('position(') || code.includes('orient(')) return false

  // Skip if contains variables assignments at the start
  if (code.match(/^\s*\w+\s*=/)) return false

  // Must start with a module call
  if (!code.match(/^\s*\w+\(/)) return false

  return true
}

// Generate test file content
function generateTestFile(example, _testNum) {
  const libName = example.lib
  const needsExplicit = EXPLICIT_INCLUDES.has(libName)

  let includes = 'include <lib/std.scad>\n'
  if (needsExplicit) {
    includes += `include <lib/${libName}>\n`
  }

  // Add $fn for consistent rendering
  let code = example.code.trim()
  if (!code.includes('$fn=') && !code.includes('$fn =')) {
    // Find the last ) and insert $fn before it
    const lastParen = code.lastIndexOf(')')
    if (lastParen > 0 && code[lastParen - 1] !== '(') {
      code = code.slice(0, lastParen) + ', $fn=32' + code.slice(lastParen)
    }
  }

  const funcName = code.match(/^\s*(\w+)\(/)?.[1] || 'unknown'
  const comment = example.name ? ` - ${example.name}` : ''

  return `// Test BOSL2 ${libName.replace('.scad', '')}: ${funcName}()${comment}
// Extracted from BOSL2 library examples
${includes}
${code}
`
}

// Main
const libFiles = readdirSync(LIB_DIR).filter(f => f.endsWith('.scad'))
const allExamples = []

for (const libFile of libFiles) {
  const content = readFileSync(join(LIB_DIR, libFile), 'utf-8')
  const examples = extractExamples(content, libFile)
  const simpleExamples = examples.filter(isSimpleExample)
  allExamples.push(...simpleExamples)
}

console.log(`Found ${allExamples.length} simple examples from ${libFiles.length} libraries`)

// Group by library and take first few from each
const byLib = new Map()
for (const ex of allExamples) {
  if (!byLib.has(ex.lib)) byLib.set(ex.lib, [])
  byLib.get(ex.lib).push(ex)
}

// Generate test files, starting from 900 series
let testNum = 900
const generated = []

for (const [lib, examples] of byLib) {
  // Take up to 2 examples per library
  const toGenerate = examples.slice(0, 2)
  for (const ex of toGenerate) {
    const filename = `${testNum}-${lib.replace('.scad', '')}-ex.scad`
    const content = generateTestFile(ex, testNum)
    const outPath = join(OUT_DIR, filename)
    writeFileSync(outPath, content)
    generated.push({ num: testNum, lib, file: filename })
    console.log(`Generated: ${filename}`)
    testNum++
  }
}

console.log(`\nGenerated ${generated.length} test files (900-${testNum - 1})`)
