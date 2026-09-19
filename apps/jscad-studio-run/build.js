import { copyTask, parseArgs } from '@jbroll/jsx6-build'
import { copyFileSync, mkdirSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import liveServer from 'live-server'
import { serve } from './serve.js'
import { hashAssets } from './src_build/hashAssets.js'
import { buildBundle, buildOne } from './src_build/esbuildUtil.js'

// *************** read parameters **********************
const { dev, port = 5130, serve: serveBuild = false } = parseArgs()
const watch = dev
const outDir = dev ? 'build_dev' : 'build'

// Origins baked at build time. The frame page's CSP must name its own origin
// explicitly: in a sandboxed frame the document origin is opaque, so CSP 'self'
// matches nothing. The allowedOrigin is the app origin that may post commands.
const appOrigin = process.env.STUDIO_APP_ORIGIN || 'https://jscad-studio.rkroll.com'
const runOrigin = process.env.STUDIO_RUN_ORIGIN || 'https://run.jscad-studio.rkroll.com'

const htmlFilter = {
  filter: (content) => content
    .replaceAll('__RUN_ORIGIN__', runOrigin)
    .replaceAll('__APP_ORIGIN__', appOrigin),
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
// CJS bundles that use CommonJS modules need default js loader (not tsx)
const cjsLoader = { '.js': 'js', '.jsx': 'jsx' }
await buildBundle(outDir + '/build', 'bundle.jscad_modeling.js', { format: 'cjs', watch: dev, loader: cjsLoader })

// Build manifold bundle with @jscad/modeling-for-manifold as external
// This explicit alias prevents circular resolution: manifold internally
// requires @jscad/modeling-for-manifold → real jscad bundle.
await buildOne('src_bundle', outDir + '/build', 'bundle.manifold_modeling.js', watch, {
  format: 'cjs',
  loader: cjsLoader,
  external: ['module', '@jscad/modeling-for-manifold'],
})

// Copy manifold WASM file to build directory (needed by manifold bundle)
copyFileSync('../../node_modules/manifold-3d/manifold.wasm', outDir + '/build/manifold.wasm')

await buildBundle(outDir + '/build', 'bundle.jscad_io.js', { format: 'cjs', watch: dev, loader: cjsLoader })
// measure/check bundle: modeling stays external so the runtime require routes
// it to the modeling bundle alias, keeping one shared copy in the worker.
await buildBundle(outDir + '/build', 'bundle.model-tools.js', {
  format: 'cjs',
  watch: dev,
  loader: cjsLoader,
  external: ['@jscad/modeling'],
})
// fluent bundle: shared deps stay external so the runtime require routes
// them to the modeling bundle alias and the CDN anchors build.
await buildBundle(outDir + '/build', 'bundle.jscad-fluent.js', {
  format: 'cjs',
  watch: dev,
  loader: cjsLoader,
  external: ['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-anchors'],
})
await buildBundle(outDir + '/build', 'bundle.params_core.js', { format: 'cjs', watch: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.jscadui.transform-babel.js', { globalName: 'jscadui_transform_babel', watch: dev })

// openscad-parser barrel-exports Node-only classes whose files have top-level
// require("fs"/"path"/"os"); provide safe no-op stubs so the bundle loads.
const nodeBuiltinStubPlugin = {
  name: 'node-builtin-stubs',
  setup(build) {
    const filter = /^(node:)?(fs|path|os|fs\/promises)$/
    build.onResolve({ filter }, args => ({ path: args.path, namespace: 'node-shim' }))
    build.onLoad({ filter: /.*/, namespace: 'node-shim' }, args => {
      const moduleName = args.path.replace(/^node:/, '')
      const stubs = {
        fs: `
          exports.readFileSync = () => ''
          exports.writeFileSync = () => {}
          exports.existsSync = () => false
          exports.mkdirSync = () => {}
          exports.readdirSync = () => []
          exports.promises = {
            readFile: async () => '',
            writeFile: async () => {},
            readdir: async () => [],
            mkdir: async () => {},
          }
        `,
        'fs/promises': `
          exports.readFile = async () => ''
          exports.writeFile = async () => {}
          exports.readdir = async () => []
          exports.mkdir = async () => {}
        `,
        path: `
          exports.join = (...p) => p.filter(Boolean).join('/')
          exports.basename = (p, ext) => { const b = (p || '').replace(/.*\\//, ''); return ext ? b.replace(ext, '') : b }
          exports.dirname = p => (p || '').replace(/\\/[^\\/]*$/, '') || '.'
          exports.resolve = (...p) => p.filter(Boolean).join('/')
          exports.isAbsolute = p => (p || '').startsWith('/')
          exports.extname = p => ((p || '').match(/\\.[^.]*$/) || [''])[0]
          exports.sep = '/'
          exports.default = exports
        `,
        os: `
          exports.tmpdir = () => '/tmp'
          exports.homedir = () => '/'
          exports.cpus = () => [{}]
          exports.platform = () => 'browser'
        `,
      }
      return { contents: stubs[moduleName] || 'exports.default = {}', loader: 'js' }
    })
  },
}
await buildBundle(outDir + '/build', 'bundle.openscad.js', {
  globalName: 'jscadui_openscad',
  watch: dev,
  plugins: [nodeBuiltinStubPlugin],
})
await buildBundle(outDir + '/build', 'bundle.jscad_text.js', {
  format: 'cjs',
  watch: dev,
  loader: cjsLoader,
  plugins: [nodeBuiltinStubPlugin],
})

/**************************** BUILD WORKER *************/
// The worker bundle's readFileWeb (from @jscadui/require) resolves paths
// against self.location.origin, which is 'null' in the blob worker a sandboxed
// frame must use. Substitute the loader's readFile with the map-aware one.
const readFileShimPlugin = {
  name: 'read-file-shim',
  setup(build) {
    build.onResolve({ filter: /readFileWeb\.js$/ }, (args) => {
      if (args.path.endsWith('readFileWeb.js') && args.importer.endsWith('packages/require/index.js')) {
        return { path: fileURLToPath(new URL('./src/readFileFrame.js', import.meta.url)) }
      }
    })
  },
}
await buildOne('src_bundle', outDir + '/build', 'bundle.worker.js', watch, {
  format: 'iife',
  plugins: [readFileShimPlugin],
})

/**************************** BUILD FRAME JS *************/
await buildOne('src', outDir, 'frame.js', watch, {
  format: 'esm',
  define: { __ALLOWED_ORIGIN__: JSON.stringify(appOrigin) },
})

// Content-hash entry assets in production so 1-year-cached bundles bust on change.
if (!dev) hashAssets(outDir)

/**************************** LIVE SERVER if in dev mode *************/
if (dev) {
  liveServer.start({ root: outDir, port, open: false })
} else if (serveBuild) {
  serve(port, appOrigin)
}