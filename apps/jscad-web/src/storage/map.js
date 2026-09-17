export function assembleFileMap(manifest, backends) {
  const files = {}
  for (const [path, backend] of Object.entries(manifest)) {
    const content = backends[backend]?.[path]
    if (content === undefined) throw new Error(`assembleFileMap: ${path} missing from ${backend}`)
    files[path] = content
  }
  return files
}

export function resolveRequire(path, maps) {
  return maps.local?.[path] ?? maps.rowboat?.[path]
}
