import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { LEGACY_META_PATH, META_PATH, isMetaPath } from './meta.js'

export async function exportZip(storage, id) {
  const project = await storage.readProject(id)
  const meta = { name: project.name, entry: project.entry, kind: project.kind }
  const entries = { [META_PATH]: strToU8(JSON.stringify(meta)) }
  for (const [path, content] of Object.entries(project.files)) entries[path] = strToU8(content)
  return zipSync(entries)
}

export async function importZip(storage, file) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes)
  const metaBytes = entries[META_PATH] ?? entries[LEGACY_META_PATH]
  if (!metaBytes) throw new Error('importZip: zip carries no project metadata')
  const meta = JSON.parse(strFromU8(metaBytes))
  const files = {}
  for (const [path, content] of Object.entries(entries)) {
    if (isMetaPath(path)) continue
    files[path] = strFromU8(content)
  }
  const id = crypto.randomUUID()
  await storage.writeFiles(id, files, { message: 'imported from zip', name: meta.name, entry: meta.entry })
  return { id, name: meta.name, entry: meta.entry, kind: meta.kind }
}
