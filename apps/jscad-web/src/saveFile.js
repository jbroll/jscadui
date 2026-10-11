export const hasSaveHandle = (fileHandle) => !!fileHandle

export const missingSaveHandleMessage = (path) =>
  `Cannot save ${path}: this browser has no File System Access API, so pick a folder-backed file or copy the code manually.`

/**
 * How Ctrl+S reaches its target for an editor path.
 * `handle` writes through a dropped file's handle; `project` writes through the
 * open project's own storage, which the compile that ran the code already did;
 * `picker` asks the File System Access API for a file.
 * @param {{ inProject: boolean, hasHandle: boolean }} args
 * @returns {'handle'|'project'|'picker'}
 */
export const saveRoute = ({ inProject, hasHandle }) => {
  if (hasHandle) return 'handle'
  return inProject ? 'project' : 'picker'
}
