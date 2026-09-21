// The frame loads this bundle through a blob worker that sets __BUNDLE_BASE__
// first: a sandboxed frame with an opaque origin cannot construct a Worker from
// a URL, and relative importScripts fail inside a blob worker.
const bundleBase = self.__BUNDLE_BASE__
importScripts(bundleBase + 'bundle.jscadui.transform-babel.js')

const { transformcjs } = jscadui_transform_babel

import { initWorker, currentSolids, currentParams, jscadInit, jscadMain } from '@jscadui/worker'
import { readFileWeb, require, requireHandlers, jscadClearTempCache, clearFileCache } from '@jscadui/require'
import { withTransferable } from '@jscadui/postmessage'
import { defaultSerializerConfigs } from '@jscadui/format-common/src/exportFormats.js'
import { includeCandidates, isSpaFallback } from './scadResolve.js'

// The project file map the frame's load command carries. readFileWeb (which the
// loader uses for every read) is replaced at build time by readFileFrame.js,
// which consults this map before fetching over the network.
export const jscadSetFiles = ({ files }) => {
  self.__PROJECT_FILES__ = files
}

// The frame adds appOrigin to every jscadInit: this worker's own origin is
// opaque, so include urls with no origin of their own have no other base.
let appOrigin = null
const frameInit = ({ appOrigin: origin, ...options }) => {
  if (origin) appOrigin = origin
  return jscadInit(options)
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

// OpenSCAD's F5 preview and F6 render differ for models that read $preview, and
// NopSCADlib's tests draw nothing outside preview. The viewport is a preview;
// an export is a render.
let scadPreview = true
const setScadPreview = (on) => {
  scadPreview = on
  if (_openscad) _openscad.j$.setSpecialVar('$preview', on)
}

function getOpenscad() {
  if (!_openscad) {
    importScripts(bundleBase + 'bundle.openscad.js')
    _openscad = jscadui_openscad
    // Transpiled .scad reads a global j$; browser runs modules via eval() in
    // global scope, so j$ must be a worker global.
    const jscad = require('@jscad/modeling', null, readFileWeb)
    _openscad.j$.init(jscad)
    _openscad.j$.setSpecialVar('$preview', scadPreview)
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

  const attempts = []

  const tryFetch = (testUrl) => {
    const failTime = failureCache.get(testUrl)
    if (failTime && (Date.now() - failTime) < FAILURE_CACHE_TTL) {
      return undefined
    }
    let content
    let reason
    try {
      content = _readFile(testUrl)
      if (content !== undefined && isSpaFallback(content)) reason = 'server returned an html fallback'
    } catch (error) {
      content = undefined
      reason = error?.message ?? String(error)
    }
    if (content !== undefined && !reason) {
      failureCache.delete(testUrl)
      return content
    }
    // A worker inside a cross-origin frame has no console anyone can read, so
    // the attempts ride the error instead.
    attempts.push(`${testUrl} — ${reason ?? 'no content'}`)
    failureCache.set(testUrl, Date.now())
    return undefined
  }

  const urlToPath = (url) => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  }

  const fileResolver = (filename, fromFile) => {
    for (const candidate of includeCandidates(filename, fromFile, url, appOrigin)) {
      const content = tryFetch(candidate)
      if (content !== undefined) return { path: urlToPath(candidate), content }
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
      const tried = attempts.length ? ` [tried ${attempts.join(' | ')}]` : ' [no candidate urls]'
      throw new Error(`OpenSCAD transpilation failed: ${errorMessages}${tried}`)
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

const jscadExportData = async ({ format, options = {} }) => {
  const jscadIo = require('@jscad/io', null, readFileWeb)
  const config = defaultSerializerConfigs.find((c) => c.id === format)
  if (!config) throw new Error(`Unknown export format: ${format}`)
  // Only a model that reads $preview can differ between the two modes, and
  // re-running one is expensive, so ask the runtime whether it ever mattered.
  const renderMode = _openscad?.j$.previewUsed
  try {
    if (renderMode) {
      setScadPreview(false)
      await jscadMain({ params: currentParams() })
    }
    const data = jscadIo[config.serializerKey].serialize({ ...config.defaultOptions, ...options }, currentSolids())
    return withTransferable({ data }, data.filter((v) => typeof v !== 'string'))
  } finally {
    if (renderMode) {
      setScadPreview(true)
      await jscadMain({ params: currentParams() })
    }
  }
}

// The export dropdown asks the engine which formats it has.
const jscadGetExportFormats = () =>
  defaultSerializerConfigs.map(({ id, label, extension }) => ({ id, label, extension }))

const importData = {
  isBinaryExt: (ext) => ext === 'stl',
  deserialize: ({ url, filename, ext }, fileContent) => {
    const jscadIo = require('@jscad/io', null, readFileWeb)
    const deserializer = jscadIo.deserializers[ext]
    if (!deserializer) throw new Error('unsupported format in ' + url)
    return deserializer({ output: 'geometry', filename }, fileContent)
  },
}

initWorker({
  transform: transformcjs,
  jscadExportData,
  importData,
  customHandlers: {
    jscadInit: frameInit,
    jscadGetExportFormats,
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