import { copyTask, parseArgs } from '@jbroll/jsx6-build'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, copyFileSync, rmSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import liveServer from 'live-server'
import {serve} from './serve.js'
import { genExamplesManifest } from './src_build/genExamplesManifest.js'
import { hashAssets } from './src_build/hashAssets.js'
import { hashFrameAssets } from './src_build/hashFrameAssets.js'

import { buildBundle, buildOne } from './src_build/esbuildUtil.js'

// Read package.json for about page
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const dependencies = Object.entries(pkg.dependencies || {})
  .map(([name, version]) => {
    const v = String(version)
    // Handle npm: aliases like "npm:@jbroll/jscad-modeling@2.12.8"
    // Show the actual package name, not the alias
    if (v.startsWith('npm:')) {
      const actual = v.slice(4) // remove "npm:"
      // Extract package name and version (handle scoped packages like @scope/name@version)
      const lastAt = actual.lastIndexOf('@')
      return { name: actual.slice(0, lastAt), version: actual.slice(lastAt + 1) }
    }
    if (v.startsWith('file:')) {
      const linked = JSON.parse(readFileSync(v.slice(5) + '/package.json', 'utf-8'))
      return { name: linked.name, version: linked.version }
    }
    return { name, version }
  })
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name, version }) => `<li>${name} ${version}</li>`)
  .join('\n        ')

/** @param {string} content */
const injectAboutInfo = (content) => {
  return content
    .replace('<span id="about-version">0.0.0</span>', `<span id="about-version">${pkg.version}</span>`)
    .replace('<ul id="about-dependencies"></ul>', `<ul id="about-dependencies">\n        ${dependencies}\n      </ul>`)
}

const htmlFilter = {
  filter: injectAboutInfo,
  include: ['index.html']
}

// Frame page: bake the web origin as both app and run origin. The frame is
// served same-host at /frame/ under sandbox (opaque origin), so CSP must
// name the origin explicitly — 'self' matches nothing inside the frame.
const frameOrigin = process.env.FRAME_APP_ORIGIN || 'https://jscad.rkroll.com'
const frameHtmlFilter = {
  filter: (content) => content
    .replaceAll('__RUN_ORIGIN__', frameOrigin)
    .replaceAll('__APP_ORIGIN__', frameOrigin),
  include: ['frame/index.html'],
}

// *************** read parameters **********************
const { dev, port = 5120, serve:serveBuild=false, skipDocs=false } = parseArgs()
const watch = dev
const outDir = dev ? 'build_dev' : 'build'
// Docs come from the sibling OpenJSCAD.org checkout that also provides @jscad/modeling.
const jscadDir = '../../../OpenJSCAD.org'
const docsDir = jscadDir + '/docs'
if (!skipDocs && !existsSync(docsDir)) {
  if (!existsSync(jscadDir + '/package.json')) {
    throw new Error(`no OpenJSCAD.org checkout at ${jscadDir}; clone it beside jscadui or pass --skipDocs`)
  }
  console.log('generating docs in ' + jscadDir)
  if (!existsSync(jscadDir + '/node_modules/jsdoc')) execSync('npm install', { cwd: jscadDir, stdio: 'inherit' })
  execSync('npm run docs', { cwd: jscadDir, stdio: 'inherit' })
}

/******************************* SETUP  *************/
mkdirSync(outDir, { recursive: true })

// Clean generated output so repeated builds do not stack hashed files.
// build.js only recopied examples before, leaving prior hashed bundles
// (e.g. bundle.jscad_io.315b95f2.315b95f2.js) and stacked main.*.js behind.
if (existsSync(outDir + '/build')) {
  rmSync(outDir + '/build', { recursive: true, force: true })
}
mkdirSync(outDir + '/build', { recursive: true })
for (const f of readdirSync(outDir)) {
  if (/^main\.[0-9a-f]{8}\.(js|css)$/.test(f)) rmSync(outDir + '/' + f, { force: true })
}

/**************************** COPY STATIC ASSETS  *************/

copyTask('static', outDir, { include: [], exclude: [], watch, filters: [htmlFilter, frameHtmlFilter] })

// Clean examples directory before copying to prevent orphaned files
if (existsSync(outDir + '/examples')) {
  rmSync(outDir + '/examples', { recursive: true, force: true })
}
copyTask('examples', outDir+'/examples', { include: [], exclude: [], watch, filters: [] })
// Static manifest so the demo browser works without server directory autoindex.
genExamplesManifest('examples', outDir + '/examples/manifest.json')
//in dev mode dont try to sync docs, just copy the first time 
if(!skipDocs && !(dev & existsSync(outDir + "/docs"))){
  // this task is heavy
  copyTask(docsDir, outDir + "/docs", { include: [], exclude: [], watch:false, filters: [] })
}

/**************************** BUILD JS bundles - watched in dev mode *************/
await buildBundle(outDir + '/build', 'bundle.threejs.js', { globalName: 'THREE', watch: dev })
await buildBundle(outDir + '/build', 'bundle.regl.js', { globalName: 'regl', watch: dev })
// render-regl bundle needs CJS loader for gl-mat4/gl-vec3 dependencies
await buildBundle(outDir + '/build', 'bundle.render-regl.js', {
  globalName: 'RenderReglBundle',
  watch: dev,
  loader: { '.js': 'js', '.jsx': 'jsx' }
})

// CJS bundles that use CommonJS modules need default js loader (not tsx)
// The tsx loader breaks CommonJS require resolution in node_modules
const cjsLoader = { '.js': 'js', '.jsx': 'jsx' }
await buildBundle(outDir + '/build', 'bundle.jscad_modeling.js', { format: 'cjs', watch: dev, loader: cjsLoader })

// Build manifold bundle with @jscad/modeling-for-manifold as external
// This explicit alias (defined in packages/manifold/package.json) prevents circular resolution:
// - User requires @jscad/modeling → manifold bundle (when manifold engine selected)
// - Manifold internally requires @jscad/modeling-for-manifold → real jscad bundle
await buildOne('src_bundle', outDir + '/build', 'bundle.manifold_modeling.js', watch, {
  format: 'cjs',
  loader: cjsLoader,
  external: ['module', '@jscad/modeling-for-manifold']
})

// Copy manifold WASM file to build directory (needed by manifold bundle)
copyFileSync('../../node_modules/manifold-3d/manifold.wasm', outDir + '/build/manifold.wasm')

await buildBundle(outDir + '/build', 'bundle.jscad_io.js', { format:'cjs', watch: dev, loader: cjsLoader })
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
await buildBundle(outDir + '/build', 'bundle.V1_api.js', { format:'cjs', watch: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.params_core.js', { format: 'cjs', watch: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.jscadui.transform-babel.js', { globalName: 'jscadui_transform_babel', watch: dev })
// openscad-parser barrel-exports Node-only classes (PreludeUtil, CodeFile,
// IncludeResolver) whose files have top-level require("fs"/"path"/"os").
// We never call those code paths in the browser, but the require() at module
// init still runs.  Provide safe no-op stubs so the bundle loads without
// throwing "Dynamic require of 'fs' is not supported".
const nodeBuiltinStubPlugin = {
  name: 'node-builtin-stubs',
  setup(build) {
    const filter = /^(node:)?(fs|path|os|fs\/promises)$/
    build.onResolve({ filter }, args => ({ path: args.path, namespace: 'node-shim' }))
    build.onLoad({ filter: /.*/, namespace: 'node-shim' }, args => {
      // Strip node: prefix if present
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

/**************************** BUILD JS THAT can change and watch if in dev mode *************/
await buildOne('src_bundle', outDir + '/build', 'bundle.worker.js', watch, { format: 'iife' })

await buildOne('src_bundle', outDir, 'bundle.fs-serviceworker.js', watch, { format: 'iife' })


/**************************** BUILD MAIN JS and watch if in dev mode *************/
const loader = {
  '.example.js': 'text', // parse example files as text
  '.js': 'tsx',
  '.jsx': 'tsx',
}
await buildOne('.', outDir, 'main.js', watch, { format: 'esm', loader })

/******************************* COMPUTE FRAME (/frame) ***********************/
// Self-contained sandboxed execution page. Bundle set mirrors the app's
// src_bundle sources (canonical, shared) except the worker, which is the
// frame-specific entry (blob __BUNDLE_BASE__ + project file map).
const frameDir = outDir + '/frame'
const frameBuildDir = frameDir + '/build'
if (existsSync(frameBuildDir)) rmSync(frameBuildDir, { recursive: true, force: true })
mkdirSync(frameBuildDir, { recursive: true })
const frameCjs = { '.js': 'js', '.jsx': 'jsx' }
await buildBundle(frameBuildDir, 'bundle.jscad_modeling.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildOne('src_bundle', frameBuildDir, 'bundle.manifold_modeling.js', watch, {
  format: 'cjs',
  loader: frameCjs,
  external: ['module', '@jscad/modeling-for-manifold'],
})
copyFileSync('../../node_modules/manifold-3d/manifold.wasm', frameBuildDir + '/manifold.wasm')
await buildBundle(frameBuildDir, 'bundle.jscad_io.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildBundle(frameBuildDir, 'bundle.model-tools.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  external: ['@jscad/modeling'],
})
await buildBundle(frameBuildDir, 'bundle.jscad-fluent.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  external: ['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-anchors'],
})
await buildBundle(frameBuildDir, 'bundle.params_core.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildBundle(frameBuildDir, 'bundle.jscadui.transform-babel.js', { globalName: 'jscadui_transform_babel', watch: dev })
await buildBundle(frameBuildDir, 'bundle.openscad.js', {
  globalName: 'jscadui_openscad',
  watch: dev,
  plugins: [nodeBuiltinStubPlugin],
})
await buildBundle(frameBuildDir, 'bundle.jscad_text.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  plugins: [nodeBuiltinStubPlugin],
})
// Frame worker: readFileWeb (origin-based) cannot work in the blob worker,
// so substitute the map-aware loader — same shim pattern as the run app.
await buildOne('src_frame', frameBuildDir, 'bundle.frame-worker.js', watch, {
  format: 'iife',
  plugins: [{
    name: 'read-file-shim',
    setup(build) {
      build.onResolve({ filter: /readFileWeb\.js$/ }, (args) => {
        if (args.path.endsWith('readFileWeb.js') && args.importer.endsWith('packages/require/index.js')) {
          return { path: fileURLToPath(new URL('./src_frame/readFileFrame.js', import.meta.url)) }
        }
      })
    },
  }],
})
await buildOne('src_frame', frameDir, 'frame.js', watch, {
  format: 'esm',
  define: { __ALLOWED_ORIGIN__: JSON.stringify(frameOrigin) },
})

// Content-hash entry assets in production so 1-year-cached bundles bust on change.
if (!dev) hashAssets(outDir)
if (!dev) hashFrameAssets(frameDir)


/**************************** LIVE SERVER if in dev mode *************/
// docs folder is too heavy for watch
if (dev) 
  // Frame headers in dev too: the sandboxed /frame/ fetches its modules
  // cross-origin from its opaque origin even same-host, and only the app
  // origin may embed it. (Production equivalents live in serve.js.)
  liveServer.start({ root: outDir, port, open: false, ignore: outDir+'/docs', middleware: [(req, res, next) => {
    if (req.url === '/frame' || req.url.startsWith('/frame/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), serial=()')
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
    }
    next()
  }] })
else 
  if(serveBuild) serve(port)

//*/
