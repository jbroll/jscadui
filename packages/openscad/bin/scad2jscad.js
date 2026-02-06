#!/usr/bin/env node

/**
 * CLI tool for converting OpenSCAD files to JSCAD
 *
 * Usage:
 *   scad2jscad input.scad                    # Output to stdout
 *   scad2jscad input.scad -o output.js       # Output to file
 *   scad2jscad input.scad --no-header        # Without imports
 *   cat input.scad | scad2jscad              # Read from stdin
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { scadToJscad } from '../esm/index.js'

const VERSION = '0.1.0'

function printHelp() {
  console.log(`
scad2jscad - Convert OpenSCAD to JSCAD

Usage:
  scad2jscad <input.scad> [options]
  cat input.scad | scad2jscad [options]

Options:
  -o, --output <file>     Write output to file instead of stdout
  -n, --no-header         Omit import header (just the geometry)
  --segments <n>          Default $fn value (default: 32)
  -h, --help              Show this help
  -v, --version           Show version

Examples:
  scad2jscad model.scad                    Convert and print to stdout
  scad2jscad model.scad -o model.js        Convert and save to file
  scad2jscad model.scad --segments 64      Use higher segment count
  cat model.scad | scad2jscad > model.js   Pipe mode
`)
}

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    includeHeader: true,
    segments: 32,
    help: false,
    version: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '-v' || arg === '--version') {
      options.version = true
    } else if (arg === '-n' || arg === '--no-header') {
      options.includeHeader = false
    } else if (arg === '-o' || arg === '--output') {
      i++
      options.output = args[i]
    } else if (arg === '--segments') {
      i++
      options.segments = parseInt(args[i], 10)
    } else if (!arg.startsWith('-')) {
      options.input = arg
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }

  return options
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  if (options.version) {
    console.log(`scad2jscad v${VERSION}`)
    process.exit(0)
  }

  // Read input
  let source
  let _filename = 'stdin.scad'

  if (options.input) {
    const inputPath = resolve(options.input)
    _filename = basename(inputPath)
    try {
      source = readFileSync(inputPath, 'utf8')
    } catch (err) {
      console.error(`Error reading file: ${options.input}`)
      console.error(err.message)
      process.exit(1)
    }
  } else if (!process.stdin.isTTY) {
    // Read from stdin
    source = await readStdin()
  } else {
    console.error('No input file specified. Use -h for help.')
    process.exit(1)
  }

  // Convert
  try {
    const result = scadToJscad(source, {
      includeHeader: options.includeHeader,
      defaultSegments: options.segments,
    })

    // Output
    if (options.output) {
      writeFileSync(options.output, result)
      console.error(`Wrote ${options.output}`)
    } else {
      console.log(result)
    }
  } catch (err) {
    console.error(`Translation error: ${err.message}`)
    if (err.location) {
      console.error(`  at line ${err.location.start.line + 1}, column ${err.location.start.column + 1}`)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
