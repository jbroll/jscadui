import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const META_PATH = '.jscad-web.json'

export async function exportZip(storage, id, metaPath = META_PATH) {
  const project = await storage.readProject(id)
  const meta = { name: project.name, entry: project.entry, kind: project.kind }
  const entries = { [metaPath]: strToU8(JSON.stringify(meta)) }
  for (const [path, content] of Object.entries(project.files)) entries[path] = strToU8(content)
  return zipSync(entries)
}

export async function importZip(storage, file, metaPath = META_PATH) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes)
  const metaBytes = entries[metaPath]
  if (!metaBytes) throw new Error('importZip: zip carries no project metadata')
  const meta = JSON.parse(strFromU8(metaBytes))
  const files = {}
  for (const [path, content] of Object.entries(entries)) {
    if (path === metaPath) continue
    files[path] = strFromU8(content)
  }
  const id = crypto.randomUUID()
  await storage.writeFiles(id, files, { message: 'imported from zip', name: meta.name, entry: meta.entry })
  return { id, name: meta.name, entry: meta.entry, kind: meta.kind }
}
