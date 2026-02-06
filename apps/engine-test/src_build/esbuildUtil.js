import { runEsbuild } from '@jsx6/build'
import * as esbuild from 'esbuild'

export const esbDef = {
  jsxFactory: 'h',
  jsxFragment: 'null',
  format: 'esm',
  loader: { '.js': 'tsx', '.jsx': 'tsx' },
  bundle: true,
  minify: true,
  sourcemap: true,
}

const bundleDef = {
  ...esbDef,
  format: 'iife',
}

export const buildBundle = (outDir, bundle, {srcDir='src_bundle', ...options})=>{
  const file = `${srcDir}/${bundle}`
  const outfile = `${outDir}/${bundle}`
  return runEsbuild(esbuild,{...bundleDef, ...options, entryPoints:[file], outfile})
}

export const buildOne = (srcDir, outDir, path, watch, options={})=>{
  const file = `${srcDir}/${path}`
  const outfile = options.outfile || `${outDir}/${path}`
  return runEsbuild(esbuild,{...esbDef, ...options, watch, entryPoints:[file], outfile})
}
