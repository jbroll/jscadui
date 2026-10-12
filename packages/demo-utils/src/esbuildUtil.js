import { runEsbuild } from '@jsx6/build'
import * as esbuild from 'esbuild'

export const esbDef = {
  jsxFactory: 'h',
  jsxFragment: 'null',
  format: 'esm',
  // .jsx is kept off the tsx loader: with both '.js' and '.jsx' mapped to tsx,
  // esbuild 0.27 fails to resolve extensionless requires in bundled CJS
  // dependencies (e.g. @jscad/regl-renderer, clipper-lib).
  loader: { '.js': 'tsx', '.jsx': 'jsx' },
  bundle: true,
  minify: true,
  sourcemap: true,
}

const bundleDef = {
  ...esbDef,
  format: 'iife',
}

export const buildBundle = (outDir, bundle, { srcDir = 'src_bundle', ...options } = {}) => {
  const file = `${srcDir}/${bundle}`
  const outfile = `${outDir}/${bundle}`
  return runEsbuild(esbuild, { ...bundleDef, ...options, entryPoints: [file], outfile })
}

export const buildOne = (srcDir, outDir, path, watch, options = {}) => {
  const file = `${srcDir}/${path}`
  const outfile = options.outfile || `${outDir}/${path}`
  return runEsbuild(esbuild, { ...esbDef, ...options, watch, entryPoints: [file], outfile })
}
