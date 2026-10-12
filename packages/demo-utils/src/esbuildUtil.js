import { runEsbuild } from '@jsx6/build'
import * as esbuild from 'esbuild'

export const esbDef = {
  jsxFactory: 'h',
  jsxFragment: 'null',
  format: 'esm',
  // esbuild 0.27 cannot resolve extensionless require()s in bundled CJS deps
  // (e.g. @jscad/regl-renderer, clipper-lib) when both '.js' and '.jsx' map to
  // a TypeScript loader. '.jsx' is unused here, so keep it on the default jsx
  // loader and leave '.js' as tsx.
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
