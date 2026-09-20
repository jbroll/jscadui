// The frame loads this bundle through a blob worker that sets __BUNDLE_BASE__
// first: a sandboxed frame with an opaque origin cannot construct a Worker from
// a URL, and relative importScripts fail inside a blob worker.
const bundleBase = self.__BUNDLE_BASE__
importScripts(bundleBase + 'bundle.jscadui.transform-babel.js')

const { transformcjs } = jscadui_transform_babel

import { initWorker, currentSolids } from '@jscadui/worker'
import { readFileWeb, require, requireHandlers, jscadClearTempCache, clearFileCache } from '@jscadui/require'
import { withTransferable } from '@jscadui/postmessage'
import { defaultSerializerConfigs } from '@jscadui/format-common/src/exportFormats.js'

// The project file map the frame's load command carries. readFileWeb (which the
// loader uses for every read) is replaced at build time by readFileFrame.js,
// which consults this map before fetching over the network.
export const jscadSetFiles = ({ files }) => {
  self.__PROJECT_FILES__ = files
}

// Cache for failed URL fetches (to avoid repeated 404s)
const failureCache = new Map()
const FAILURE_CACHE_TTL = 60000

// Cache for transpiled .scad files (path -> transpiled JS source)
const transpiledCache = new Map()

// Shared transpiler cache: persists TranspiledFile objects across jscadScript
// calls so the transpiler can skip re-processing unchanged dependencies.
const workerSharedCache = new Map()

// Normalise a URL or path to an absolute path for use as a cache key.
// No self.location.origin here: in a blob worker that base is 'null', so
// absolute URLs parse on their own.
const toCachePath = (urlOrPath) => {
  try {
    return new URL(urlOrPath).pathname
  } catch {
    return urlOrPath
  }
}

export const clearTranspiledCache = () => {
  transpiledCache.clear()
  workerSharedCache.clear()
}

// ── OpenSCAD (.scad) handler ──────────────────────────────────────────────
// Lazily loads the openscad transpiler bundle on first use, then registers a
// requireHandler so require('./foo.scad') works inside any user script.

let _openscad = null

function getOpenscad() {
  if (!_openscad) {
    importScripts(bundleBase + 'bundle.openscad.js')
    _openscad = jscadui_openscad
    // Transpiled .scad reads a global j$; browser runs modules via eval() in
    // global scope, so j$ must be a worker global.
    const jscad = require('@jscad/modeling', null, readFileWeb)
    _openscad.j$.init(jscad)
    self.j$ = _openscad.j$
  }
  return _openscad
}

requireHandlers.set('scad', (source, url, _readFile) => {
  const urlPath = toCachePath(url)

  if (transpiledCache.has(urlPath)) {
    return transpiledCache.get(urlPath)
  }
  const { parse, transpile } = getOpenscad()

  const { ast, errors } = parse(source, url)
  if (errors.length > 0) {
    for (const err of errors) console.warn(`OpenSCAD parse warning in ${url}:`, err.message)
  }

  const tryFetch = (testUrl) => {
    const failTime = failureCache.get(testUrl)
    if (failTime && (Date.now() - failTime) < FAILURE_CACHE_TTL) {
      return undefined
    }
    try {
      return _readFile(testUrl)
    } catch {
      failureCache.set(testUrl, Date.now())
      return undefined
    }
  }

  const urlToPath = (url) => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  }

  // Resolve use/include paths relative to the current file
  const fileDir = url.replace(/\/[^/]*$/, '/')
  const fileResolver = (filename, fromFile) => {
    const base = fromFile ? fromFile.replace(/\/[^/]*$/, '/') : fileDir
    const baseUrl = base.startsWith('http://') || base.startsWith('https://') ? base : null
    if (!baseUrl) return undefined

    const resolvedUrl = new URL(filename, baseUrl).toString()
    const content = tryFetch(resolvedUrl)
    if (content !== undefined) {
      return { path: urlToPath(resolvedUrl), content }
    }
    return undefined
  }

  const result = transpile(ast, {
    fileResolver,
    currentFile: urlPath,
    includeHeader: true,
  }, workerSharedCache)

  if (result.errors && result.errors.length > 0) {
    const criticalErrors = result.errors.filter(e =>
      e.code === 'FILE_NOT_FOUND' || e.code === 'PARSE_ERROR'
    )
    if (criticalErrors.length > 0) {
      const errorMessages = criticalErrors.map(e => e.message).join('; ')
      throw new Error(`OpenSCAD transpilation failed: ${errorMessages}`)
    }
    for (const err of result.errors) {
      console.warn(`OpenSCAD transpile warning in ${url}:`, err.message)
    }
  }

  if (result.files && result.files.size > 0) {
    for (const [filePath, fileData] of result.files) {
      transpiledCache.set(filePath, fileData.code)
    }
  }
  transpiledCache.set(urlPath, result.code)

  return result.code
})

// ── measure, check and export ─────────────────────────────────────────────
// jscadMain flattens the model's return into solids, so one solid is a single
// geometry and more are a scene array — the CLI's classification rule, kept so
// frame output stays identical to jscad-work.
const currentGeometry = () => {
  const solids = currentSolids()
  return solids.length === 1 ? solids[0] : solids
}

// Loaded lazily through the '@jscadui/model-tools' bundle alias, which resolves
// @jscad/modeling to the modeling bundle alias already in the worker.
let _modelTools = null
const modelTools = () => {
  if (!_modelTools) _modelTools = require('@jscadui/model-tools', null, readFileWeb)
  return _modelTools
}

const jscadMeasure = ({ options = {} }) => modelTools().measure(currentGeometry(), options)

const jscadCheck = ({ bed, options = {} }) => modelTools().check(currentGeometry(), { ...options, bed })

const jscadExportData = ({ format, options = {} }) => {
  const jscadIo = require('@jscad/io', null, readFileWeb)
  const config = defaultSerializerConfigs.find((c) => c.id === format)
  if (!config) throw new Error(`Unknown export format: ${format}`)
  const data = jscadIo[config.serializerKey].serialize({ ...config.defaultOptions, ...options }, currentSolids())
  return withTransferable({ data }, data.filter((v) => typeof v !== 'string'))
}

initWorker({
  transform: transformcjs,
  jscadExportData,
  customHandlers: {
    jscadMeasure,
    jscadCheck,
    jscadSetFiles,
    jscadClearTempCache: () => {
      jscadClearTempCache()
      clearTranspiledCache()
    },
    jscadClearFileCache: ({ files, root }) => {
      clearFileCache({ files, root })
      for (const file of files) transpiledCache.delete(toCachePath(file))
    },
  },
})