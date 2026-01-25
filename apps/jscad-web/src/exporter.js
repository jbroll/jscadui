import { gzipSync } from 'fflate'
import { ExportFormats, ExportFormatMeta } from '@jscadui/format-common/src/exportFormats.js'
import { downloadBlob } from '@jscadui/scene'
import { str2ab } from './str2ab.js'
import * as editor from './editor.js'

/** @typedef {import('@jscadui/worker').JscadWorker} JscadWorker*/

/**
 * @typedef {Object} ExportFormatEntry
 * @property {string} name
 * @property {string} label
 * @property {()=>Promise<void>} execute
 */

/** @type {ExportFormatEntry[]} */
const exportFormats = [
  ...Object.entries(ExportFormats).map(([, formatId]) => ({
    name: formatId,
    label: ExportFormatMeta[formatId].label,
    execute: () => exportAsFile(formatId, ExportFormatMeta[formatId].extension),
  })),
  { name: 'scriptUrl', label: 'Copy to clipboard script url', execute: () => exportToScriptUrl() },
]

const exportButton = /** @type {HTMLButtonElement} */ (document.getElementById('export-button'))
const exportFormatSelect = /** @type {HTMLSelectElement} */ (document.getElementById('export-format'))

/** @type {JscadWorker} */
let workerApi

/** @param {JscadWorker} newWorkerApi */
export const init = (newWorkerApi) => {
  workerApi = newWorkerApi

  for (const format of exportFormats) {
    const option = document.createElement('option')
    option.value = format.name
    option.text = format.label
    exportFormatSelect.appendChild(option)
  }

  // Bind export buttons
  exportButton.addEventListener('click', async () => {
  // Export model in selected format    
    const format = /** @type {ExportFormatEntry} */ (exportFormats.find((f) => f.name === exportFormatSelect.value))
    await format.execute()
  })
}

const exportToScriptUrl = async () => {
  if (editor.getEditorFiles().length > 1) {
    alert('Can not export multi file projects as url')
    return
  }
  const src = editor.getSource()
  const gzipped = gzipSync(str2ab(src))
  const str = String.fromCharCode(...gzipped)
  const url = document.location.origin + '#data:application/gzip;base64,' + btoa(str)
  console.log('url\n', url)
  try {
    await navigator.clipboard.writeText(url)
    alert('URL with gzipped script was successfully copied to clipboard')
  } catch (err) {
    console.error('Failed to copy: ', err)
    alert(`failed to copy to clipboard\n${err}`)
  }
}

/** 
 * @param {string} formatName
 * @param {string} formatExtension
 */
const exportAsFile = async (formatName, formatExtension = formatName) => {
  let { data } = (await workerApi.jscadExportData({ format: formatName })) || {}
  if (data) {
    if (!(data instanceof Array)) data = [data]
    console.log('save', `${exportConfig.projectName}.${formatExtension}`, data)
    let type = 'text/plain'
    if (formatName === ExportFormats.THREE_MF) type = 'application/zip'

    downloadBlob(new Blob(data, { type }), `${exportConfig.projectName}.${formatExtension}`)
  }
}

export const exportConfig = {
  projectName: 'jscad',
}