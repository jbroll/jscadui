import { copyTask, parseArgs } from '@jbroll/jsx6-build'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'fs'
import liveServer from 'live-server'
import {serve} from './serve.js'

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

// *************** read parameters **********************
const { dev, port = 5120, serve:serveBuild=false, skipDocs=false } = parseArgs()
const watch = dev
const outDir = dev ? 'build_dev' : 'build'
const docsDir = 'jscad/docs'
// if docs dir does not exist, then clone jscad and run `npm run docs` to generate it
if (!skipDocs &&!existsSync(docsDir)) {
  console.log('generating docs')
  if (!existsSync('jscad')) {
    // TODO: faster to fetch https://github.com/jscad/OpenJSCAD.org/archive/refs/heads/master.zip
    execSync('git clone https://github.com/jscad/OpenJSCAD.org jscad')
  }
  execSync('cd jscad && npm install && npm run docs')
}

/******************************* SETUP  *************/
mkdirSync(outDir, { recursive: true })

/**************************** COPY STATIC ASSETS  *************/

copyTask('static', outDir, { include: [], exclude: [], watch, filters: [htmlFilter] })
copyTask('examples', outDir+'/examples', { include: [], exclude: [], watch, filters: [] })
//in dev mode dont try to sync docs, just copy the first time 
if(!skipDocs && !(dev & existsSync(outDir + "/docs"))){
  // this task is heavy
  copyTask(docsDir, outDir + "/docs", { include: [], exclude: [], watch:false, filters: [] })
}

/**************************** BUILD JS that is static *************/
await buildBundle(outDir + '/build', 'bundle.threejs.js', { globalName: 'THREE', skipExisting: dev })
await buildBundle(outDir + '/build', 'bundle.regl.js', { globalName: 'regl', skipExisting: dev })
// render-regl bundle needs CJS loader for gl-mat4/gl-vec3 dependencies
await buildBundle(outDir + '/build', 'bundle.render-regl.js', {
  globalName: 'RenderReglBundle',
  skipExisting: dev,
  loader: { '.js': 'js', '.jsx': 'jsx' }
})

// CJS bundles that use CommonJS modules need default js loader (not tsx)
// The tsx loader breaks CommonJS require resolution in node_modules
const cjsLoader = { '.js': 'js', '.jsx': 'jsx' }
await buildBundle(outDir + '/build', 'bundle.jscad_modeling.js', { format: 'cjs', skipExisting: dev, loader: cjsLoader })

// Build manifold bundle with @jscad/modeling-core as external
// At runtime, manifold_modeling imports from @jscad/modeling-core which maps to jscad_modeling bundle
// Use buildOne with watch to auto-rebuild when manifold package source changes
await buildOne('src_bundle', outDir + '/build', 'bundle.manifold_modeling.js', watch, {
  format: 'cjs',
  loader: cjsLoader,
  external: ['module', '@jscad/modeling-core', '@jscad/modeling', '@jscad/modeling/*']
})

// Copy manifold WASM file to build directory (needed by manifold bundle)
copyFileSync('../../node_modules/manifold-3d/manifold.wasm', outDir + '/build/manifold.wasm')

await buildBundle(outDir + '/build', 'bundle.jscad_io.js', { format:'cjs', skipExisting: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.V1_api.js', { format:'cjs', skipExisting: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.params_core.js', { format: 'cjs', skipExisting: dev, loader: cjsLoader })
await buildBundle(outDir + '/build', 'bundle.jscadui.transform-babel.js', { globalName: 'jscadui_transform_babel', skipExisting: dev })

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


/**************************** LIVE SERVER if in dev mode *************/
// docs folder is too heavy for watch
if (dev) 
  liveServer.start({ root: outDir, port, open: false, ignore: outDir+'/docs' })
else 
  if(serveBuild) serve(port)

//*/
