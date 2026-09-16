// The storage interface: every mode returns the same shape. The zip pair is
// implemented once over the interface, not per mode — any storage that can
// readProject and writeFiles can export and import.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createCloudStorage as createCloud } from './cloud.js'

// The zip's reserved meta entry carries the project's identity fields; a project
// file can never use this path.
const META_PATH = '.jscad-studio.json'

export function createCloudStorage(options) {
  return withZip(createCloud(options))
}

export function withZip(storage) {
  return {
    ...storage,
    exportZip: (id) => exportZip(storage, id),
    importZip: (file) => importZip(storage, file),
  }
}

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
  const metaBytes = entries[META_PATH]
  if (!metaBytes) throw new Error('importZip: zip carries no project metadata')
  const meta = JSON.parse(strFromU8(metaBytes))
  const files = {}
  for (const [path, content] of Object.entries(entries)) {
    if (path === META_PATH) continue
    files[path] = strFromU8(content)
  }
  const id = crypto.randomUUID()
  await storage.writeFiles(id, files, { message: 'imported from zip', name: meta.name, entry: meta.entry })
  return { id, name: meta.name, entry: meta.entry, kind: meta.kind }
}
