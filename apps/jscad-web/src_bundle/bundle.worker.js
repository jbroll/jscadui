importScripts('./bundle.jscadui.transform-babel.js')

// import io from '@jscad/io'
const {transformcjs} = jscadui_transform_babel
// import {transformcjs} from '@jscadui/transform-babel'

import {currentSolids, initWorker} from '@jscadui/worker'
import {readFileWeb, require} from '@jscadui/require'

import { withTransferable } from '@jscadui/postmessage'
import { defaultSerializerConfigs } from '@jscadui/format-common/src/exportFormats.js'

/**
 * Serializer configurations - the single source of truth for export formats.
 * Derived from defaultSerializerConfigs, can be customized if needed.
 * @type {import('@jscadui/format-common/src/exportFormats.js').SerializerConfig[]}
 */
const serializerConfigs = [...defaultSerializerConfigs]

/**
 * Get available export formats for UI.
 * @returns {import('@jscadui/format-common/src/exportFormats.js').ExportFormatInfo[]}
 */
export const jscadGetExportFormats = () => {
  return serializerConfigs.map(({ id, label, extension }) => ({ id, label, extension }))
}

const exportData = ({format, options={}})=>{
  const jscad_io = require('./bundle.jscad_io.js', null, readFileWeb)
  const solids = currentSolids()
  const config = serializerConfigs.find(c => c.id === format)
  if (!config) throw new Error(`Unknown export format: ${format}`)
  const serializer = jscad_io[config.serializerKey]
  const data = serializer.serialize({...config.defaultOptions, ...options}, solids)
  return withTransferable({ data }, data.filter(v=>typeof v !== 'string'))
}

const importData = {
  isBinaryExt: ext=>ext === 'stl',
  deserialize: ({url, filename, ext}, fileContent)=>{
    try {
      const jscad_io = require('./bundle.jscad_io.js', null, readFileWeb)
      const deserializer = jscad_io.deserializers[ext]

      if(deserializer) return deserializer({output:'geometry', filename}, fileContent)
      throw new Error('unsupported format in ' + url)
    } catch (error) {
      console.error(error)
      throw error
    }
  }
}

initWorker({
  transform: transformcjs,
  jscadExportData: exportData,
  importData,
  customHandlers: { jscadGetExportFormats }
})
