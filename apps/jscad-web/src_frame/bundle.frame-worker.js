// The frame loads this bundle through a blob worker that sets __BUNDLE_BASE__
// first: a sandboxed frame with an opaque origin cannot construct a Worker from
// a URL, and relative importScripts fail inside a blob worker.
const bundleBase = self.__BUNDLE_BASE__
importScripts(bundleBase + 'bundle.jscadui.transform-babel.js')

const { transformcjs } = jscadui_transform_babel

import {
  initWorker,
  currentSolids,
  currentParams,
  jscadInit,
  jscadMain,
  lastRunStreamed,
  postProgress,
  releaseSolids,
  setRunConsole,
  setRunSummary,
  setRunWarnings,
} from '@jscadui/worker'
import { asGeometry, summarizeRun } from '@jscadui/agent-loop/src/buildReport.js'
import { readFileWeb, require, requireHandlers, jscadClearTempCache, clearFileCache, setUserModuleWrapper } from '@jscadui/require'
import { withTransferable } from '@jscadui/postmessage'
import { defaultSerializerConfigs } from '@jscadui/format-common/src/exportFormats.js'
import { createScadHandler } from './scadHandler.js'
import { createImportData } from './importData.js'
import { sealMessageListeners } from './sealMessages.js'
import { createWithSolids } from './withSolids.js'
import { installOptionWarnings } from './optionWarnings.js'
import { installRunConsole } from './consoleCapture.js'

// The frame adds appOrigin to every jscadInit: this worker's own origin is
// opaque, so include urls with no origin of their own have no other base.
let appOrigin = null
const frameInit = ({ appOrigin: origin, ...options }) => {
  if (origin) appOrigin = origin
  return jscadInit(options)
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

const scad = createScadHandler({ getOpenscad, getAppOrigin: () => appOrigin })
requireHandlers.set('scad', scad.handle)

// The project file map the frame's load command carries. readFileWeb (which the
// loader uses for every read) is replaced at build time by readFileFrame.js,
// which consults this map before fetching over the network. A file that failed
// to read may exist now, so the failed reads go with the old map. The chat's
// API style rides along so the run's warnings name that API's form.
export const jscadSetFiles = ({ files, api }) => {
  self.__PROJECT_FILES__ = files
  scad.clearFailures()
  runWarnings.setApi(api)
}

// ── measure, check and export ─────────────────────────────────────────────
// jscadMain flattens the model's return into solids; asGeometry makes one solid
// a single geometry and more a scene array, the CLI's classification rule, kept
// so frame output stays identical to jscad-work and the eval.

const withSolids = createWithSolids({ lastRunStreamed, postProgress, releaseSolids, currentParams, jscadMain, currentSolids })

// Loaded lazily through the '@jscadui/model-tools' bundle alias, which resolves
// @jscad/modeling to the modeling bundle alias already in the worker.
let _modelTools = null
const modelTools = () => {
  if (!_modelTools) _modelTools = require('@jscadui/model-tools', null, readFileWeb)
  return _modelTools
}

const jscadMeasure = ({ options = {} }) => withSolids((solids) => modelTools().measure(asGeometry(solids), options))

// The chat's scratch `run` answers with this, as the eval's backend does.
setRunSummary((run) => summarizeRun(run, (items) => modelTools().measure(items)))

const jscadCheck = ({ bed, options = {} }) => withSolids((solids) => modelTools().check(asGeometry(solids), { ...options, bed }))

const jscadExportData = async ({ format, options = {} }) => {
  const jscadIo = require('@jscad/io', null, readFileWeb)
  const config = defaultSerializerConfigs.find((c) => c.id === format)
  if (!config) throw new Error(`Unknown export format: ${format}`)
  // Only a model that reads $preview can differ between the two modes, and
  // re-running one is expensive, so ask the runtime whether it ever mattered.
  // A streamed grid is re-run for the export anyway, in preview mode.
  const renderMode = !lastRunStreamed() && _openscad?.j$.previewUsed
  try {
    if (renderMode) {
      setScadPreview(false)
      await jscadMain({ params: currentParams() })
    }
    return await withSolids((solids) => {
      const data = jscadIo[config.serializerKey].serialize({ ...config.defaultOptions, ...options }, solids)
      return withTransferable({ data }, data.filter((v) => typeof v !== 'string'))
    })
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

const importData = createImportData(() => require('@jscad/io', null, readFileWeb).deserializers)

const runWarnings = installOptionWarnings({ setUserModuleWrapper, setRunWarnings })
installRunConsole({ setRunConsole })

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
      scad.clearTranspiled()
      scad.clearFailures()
    },
    jscadClearFileCache: ({ files, root }) => {
      clearFileCache({ files, root })
      scad.forgetFiles(files, root)
      scad.clearFailures()
    },
  },
})

sealMessageListeners(self)