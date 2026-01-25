import { toDate3mf } from './toDate3mf.js'

/**
 * Escape XML special characters to prevent XML injection
 * @param {string | undefined} str
 * @returns {string}
 */
const escapeXml = (str) => {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * @typedef Header
 * @prop {import('../xml-schema-3mf.js').Xml3mfUnit} [unit]
 * @prop {string} [title]
 * @prop {string} [author]
 * @prop {string} [description]
 * @prop {string} [application]
 * @prop {Date} [creationDate]
 * @prop {string} [license]
 * @prop {string} [copyright]
 * @prop {Date} [modificationDate] 
 * @prop {string} [rating] 
 */

/**
 * @param {Header} header 
 * @param {import('../xml-schema-3mf.js').Xml3mfResource[]} resources
 * @param {import('../xml-schema-3mf.js').Xml3mfBuild} build
 * @returns {import('../xml-schema-3mf.js').Xml3mfModel}
 */
export const genModel = (header, resources, build) => {
  /** @type {import('../xml-schema-3mf.js').Xml3mfModel} */
  const result = {
    '@_unit': header.unit ?? 'millimeter',
    '@_xml:lang': 'en-US',
    '@_xmlns': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
    '@_xmlns:slic3rpe': 'http://schemas.slic3r.org/3mf/2017/06',
    metadata: [
      { '@_name': 'slic3rpe:Version3mf', '#text': '1' },
    ],
    resources,
    build,
  }

  if (header.title !== undefined) result.metadata.push({ '@_name': 'Title', '#text': escapeXml(header.title) })
  if (header.author !== undefined) result.metadata.push({ '@_name': 'Designer', '#text': escapeXml(header.author) })
  if (header.description !== undefined) result.metadata.push({ '@_name': 'Description', '#text': escapeXml(header.description) })
  if (header.copyright !== undefined) result.metadata.push({ '@_name': 'Copyright', '#text': escapeXml(header.copyright) })
  if (header.license !== undefined) result.metadata.push({ '@_name': 'LicenseTerms', '#text': escapeXml(header.license) })
  if (header.rating !== undefined) result.metadata.push({ '@_name': 'Rating', '#text': escapeXml(header.rating) })
  if (header.application !== undefined) result.metadata.push({ '@_name': 'Application', '#text': escapeXml(header.application) })
  result.metadata.push({ '@_name': 'CreationDate', '#text': toDate3mf(header.creationDate ?? new Date()) })
  result.metadata.push({ '@_name': 'ModificationDate', '#text': toDate3mf(header.modificationDate ?? new Date()) })

  return result
}