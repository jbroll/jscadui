/**
 * The editor's per-path text, so switching files never re-reads a stale
 * snapshot. `remember` records authoritative content (clean); `edit` records a
 * user change (dirty).
 * @returns {{
 *   has: (path:string) => boolean,
 *   get: (path:string) => string | undefined,
 *   set: (path:string, text:string) => void,
 *   remember: (path:string, text:string) => void,
 *   edit: (path:string, text:string) => void,
 *   clear: () => void,
 *   prune: (paths:Set<string>) => void,
 *   isDirty: () => boolean,
 *   isDirtyPath: (path:string) => boolean,
 * }}
 */
export function createEditorBuffer() {
  const buffers = new Map()
  const dirty = new Set()
  return {
    has: (path) => buffers.has(path),
    get: (path) => buffers.get(path),
    set: (path, text) => { buffers.set(path, text) },
    remember: (path, text) => { buffers.set(path, text); dirty.delete(path) },
    edit: (path, text) => { buffers.set(path, text); dirty.add(path) },
    clear: () => { buffers.clear(); dirty.clear() },
    prune: (paths) => {
      for (const path of [...buffers.keys()]) if (!paths.has(path)) buffers.delete(path)
      for (const path of [...dirty]) if (!paths.has(path)) dirty.delete(path)
    },
    isDirty: () => dirty.size > 0,
    isDirtyPath: (path) => dirty.has(path),
  }
}
