import { runEsbuild } from '@jsx6/build'
// import { runEsbuild } from './runEsbuild.js'
import * as esbuild from 'esbuild'

export const esbDef = {
  jsxFactory: 'h',
  jsxFragment: 'null',
  format: 'esm',
  loader: {
    '.js': 'tsx',
    '.jsx': 'tsx',
  },
  bundle: true,
  minify: true,
  skipExisting: true,
  sourcemap: true,
}

const bundleDef = {
  ...esbDef,
  format: 'iife',
}

export const buildBundle = (outDir, bundle, {srcDir='src/bundle', skipExisting = true, ...options})=>{
  const file = `${srcDir}/${bundle}`
  const outfile = `${outDir}/${bundle}`
  return runEsbuild(esbuild,{...bundleDef, ...options, skipExisting, entryPoints:[file], outfile})
}

export const buildOneIfNeeded = (outDir, file, options={})=>{
  const outfile = options.outfile || `${outDir}/${file}`
  return runEsbuild(esbuild,{...esbDef, ...options, skipExisting: true, entryPoints:[file], outfile})
}

export const buildOne = (srcDir, outDir, path, watch, options={})=>{
  const file = `${srcDir}/${path}`
  const outfile = options.outfile || `${outDir}/${path}`
  return runEsbuild(esbuild,{...esbDef, skipExisting:false, ...options, watch, entryPoints:[file], outfile})
}