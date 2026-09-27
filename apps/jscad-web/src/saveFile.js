export const hasSaveHandle = (fileHandle) => !!fileHandle

export const missingSaveHandleMessage = (path) =>
  `Cannot save ${path}: this browser has no File System Access API, so pick a folder-backed file or copy the code manually.`
