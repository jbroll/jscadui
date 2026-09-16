import { copyTask, parseArgs } from '@jbroll/jsx6-build'
import { mkdirSync, rmSync } from 'fs'
import liveServer from 'live-server'
import { serve } from './serve.js'
import { hashAssets } from './src_build/hashAssets.js'
import { buildBundle, buildOne } from './src_build/esbuildUtil.js'

// *************** read parameters **********************
const { dev, port = 5120, serve: serveBuild = false } = parseArgs()
const watch = dev
const outDir = dev ? 'build_dev' : 'build'

// The run origin is baked into the iframe src (index.html) and main.js at
// build time. STUDIO_APP_ORIGIN is read by the run app's own build so the
// frame answers commands only from this app's origin.
const runOrigin = process.env.STUDIO_RUN_ORIGIN || 'https://run.jscad-studio.rkroll.com'

const htmlFilter = {
  filter: (content) => content.replaceAll('__RUN_ORIGIN__', runOrigin),
  include: ['index.html'],
}

/******************************* SETUP  *************/
// hashAssets renames bundles in place; a stale hashed copy from an earlier
// build would otherwise be re-hashed and win the reference rewrite.
rmSync(outDir + '/build', { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/**************************** COPY STATIC ASSETS  *************/
copyTask('static', outDir, { include: [], exclude: [], watch, filters: [htmlFilter] })

/**************************** BUILD JS bundles - watched in dev mode *************/
await buildBundle(outDir + '/build', 'bundle.threejs.js', { globalName: 'THREE', watch: dev })
await buildBundle(outDir + '/build', 'bundle.regl.js', { globalName: 'regl', watch: dev })
// render-regl bundle needs CJS loader for gl-mat4/gl-vec3 dependencies
await buildBundle(outDir + '/build', 'bundle.render-regl.js', {
  globalName: 'RenderReglBundle',
  watch: dev,
  loader: { '.js': 'js', '.jsx': 'jsx' },
})

/**************************** BUILD MAIN JS and watch if in dev mode *************/
const loader = {
  '.js': 'tsx',
  '.jsx': 'tsx',
}
await buildOne('.', outDir, 'main.js', watch, {
  format: 'esm',
  loader,
  define: { __RUN_ORIGIN__: JSON.stringify(runOrigin) },
})

// Content-hash entry assets in production so 1-year-cached bundles bust on change.
if (!dev) hashAssets(outDir)

/**************************** LIVE SERVER if in dev mode *************/
if (dev) {
  liveServer.start({ root: outDir, port, open: false })
} else if (serveBuild) {
  serve(port)
}