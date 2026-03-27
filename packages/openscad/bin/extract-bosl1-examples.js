#!/usr/bin/env node
// Extract simple examples from BOSL v1 library files and generate test cases.
// Each BOSL1 lib file uses: include <BOSL/constants.scad> + use <BOSL/libfile.scad>
// We map those to: include <lib/constants.scad> + use <lib/libfile.scad>

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const LIB_DIR = 'test/corpus/bosl/lib'
const OUT_DIR = 'test/corpus/bosl'

// Parse example blocks from a BOSL1 library file.
// Format is identical to BOSL2:
//   // Example:
//   //   code line 1
//   //   code line 2
function extractExamples(content, libName) {
  const examples = []
  const lines = content.split('\n')

  let inExample = false
  let exampleLines = []
  let exampleName = ''
  let skipExample = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const exampleMatch = line.match(/^\/\/\s*Examples?\s*(\([^)]*\))?:?\s*(.*)$/)
    if (exampleMatch) {
      if (inExample && exampleLines.length > 0 && !skipExample) {
        examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
      }
      inExample = true
      exampleLines = []
      const tags = exampleMatch[1] || ''
      exampleName = exampleMatch[2] || ''

      // Skip animated, 2D, viewport-specific, or heavy examples
      skipExample = tags.includes('2D') ||
                    tags.includes('Anim') ||
                    tags.includes('FlatSpin') ||
                    tags.includes('VPT=') ||
                    tags.includes('VPR=') ||
                    tags.includes('VPD=') ||
                    tags.includes('Big') ||
                    tags.includes('NoAxes') ||
                    tags.includes('NoScales')
      continue
    }

    if (inExample) {
      const codeMatch = line.match(/^\/\/\s{2,3}(.+)$/)
      if (codeMatch) {
        exampleLines.push(codeMatch[1])
      } else if (!line.match(/^\/\/\s*$/)) {
        if (exampleLines.length > 0 && !skipExample) {
          examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
        }
        inExample = false
        exampleLines = []
        skipExample = false
      }
    }
  }

  if (inExample && exampleLines.length > 0 && !skipExample) {
    examples.push({ name: exampleName, code: exampleLines.join('\n'), lib: libName })
  }

  return examples
}

// Keep only simple, renderable geometry examples.
function isSimpleExample(example) {
  const code = example.code.trim()

  // Strip debug-highlight lines (#sphere, #cube, etc.) — they're reference markers
  const renderLines = code.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))

  if (renderLines.length === 0) return false
  if (renderLines.length > 3) return false

  const joined = renderLines.join('\n')

  if (joined.includes('module ') || joined.includes('function ')) return false
  if (joined.includes('difference()') || joined.includes('intersection()')) return false
  if (joined.includes('position(') || joined.includes('orient(')) return false
  if (joined.match(/^\s*\w+\s*=/)) return false

  // Must start with a module call
  if (!joined.match(/^\s*\w+\s*[([]/) ) return false

  return true
}

function generateTestFile(example, _testNum) {
  const libFile = example.lib
  const funcName = example.code.trim().match(/^\s*(\w+)\s*[([]/ )?.[1] || 'unknown'
  const comment = example.name ? ` - ${example.name}` : ''

  // Strip #-prefixed debug lines from the actual output
  const code = example.code.split('\n')
    .filter(l => !l.trim().startsWith('#'))
    .join('\n')
    .trim()

  // Add $fn for consistent rendering if not already present
  let finalCode = code
  if (!finalCode.includes('$fn=') && !finalCode.includes('$fn =')) {
    const lastParen = finalCode.lastIndexOf(')')
    if (lastParen > 0 && finalCode[lastParen - 1] !== '(') {
      finalCode = finalCode.slice(0, lastParen) + ', $fn=32' + finalCode.slice(lastParen)
    }
  }

  return `// Test BOSL ${libFile.replace('.scad', '')}: ${funcName}()${comment}
// Extracted from BOSL library examples
include <lib/constants.scad>
use <lib/${libFile}>

${finalCode}
`
}

// Main
const libFiles = readdirSync(LIB_DIR).filter(f => f.endsWith('.scad'))
const allExamples = []

for (const libFile of libFiles) {
  const content = readFileSync(join(LIB_DIR, libFile), 'utf-8')
  const examples = extractExamples(content, libFile)
  const simple = examples.filter(isSimpleExample)
  allExamples.push(...simple)
}

console.log(`Found ${allExamples.length} simple examples from ${libFiles.length} BOSL1 library files`)

// Deduplicate by first-module-called: one example per unique function/module name per lib.
// This ensures we have broad coverage across all library modules.
const seen = new Set()
const dedupedExamples = []
for (const ex of allExamples) {
  const funcName = ex.code.trim().match(/^\s*(\w+)\s*[([]/ )?.[1] || 'unknown'
  const key = `${ex.lib}:${funcName}`
  if (!seen.has(key)) {
    seen.add(key)
    dedupedExamples.push(ex)
  }
}
console.log(`After dedup (1 per function per lib): ${dedupedExamples.length} examples`)

// Generate, starting from 001 series
let testNum = 1
const generated = []

for (const ex of dedupedExamples) {
  const funcName = ex.code.trim().match(/^\s*(\w+)\s*[([]/ )?.[1] || 'unknown'
  const num = String(testNum).padStart(3, '0')
  const libBase = ex.lib.replace('.scad', '')
  const filename = `${num}-${libBase}-${funcName}.scad`
  const content = generateTestFile(ex, testNum)
  writeFileSync(join(OUT_DIR, filename), content)
  generated.push({ num: testNum, lib: ex.lib, file: filename })
  console.log(`Generated: ${filename}`)
  testNum++
}

console.log(`\nGenerated ${generated.length} test files (001-${String(testNum - 1).padStart(3, '0')})`)
