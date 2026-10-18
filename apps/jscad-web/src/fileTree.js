// The editor drawer's file tree: a pure render of the open project's file map.
// Everything the agent can touch shows — `test/`, `notes/`, dotfiles and binary
// files included — grouped by `/` with directories first and alphabetical
// throughout. Each row opens the file, and carries a pencil (rename) and a
// trash (delete); the entry file and the last file refuse deletion with a
// message row instead of confirming.
import { isBinaryPath } from './projectFiles.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const bare = (path) => String(path ?? '').replace(/^\//, '')

/**
 * One directory node in the tree being built: subdirectories and the files
 * that sit directly in it.
 * @typedef {object} TreeDir
 * @property {Map<string, TreeDir>} dirs
 * @property {{name:string, path:string}[]} files
 */

/** @param {unknown} content */
const sizeOf = (content) => {
  if (content == null) return 0
  if (typeof content === 'object') return content.size ?? content.byteLength ?? 0
  return String(content).length
}

/** @param {number} bytes */
const humanSize = (bytes) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

/**
 * @typedef {object} FileTreeDeps
 * @property {Record<string, unknown>} [files] the project's file map (path -> content)
 * @property {string} [entry] the project's entry path
 * @property {string[]} [dirtyPaths] open paths with unsaved edits
 * @property {string[]} [touchedPaths] paths the current turn wrote
 * @property {string} [message] a one-line notice (a blocked rename, say)
 * @property {(message:string) => (boolean|Promise<boolean>)} [confirm] the delete gate
 * @property {(path:string) => void} [onOpen]
 * @property {(path:string) => (void|Promise<void>)} [onDelete]
 * @property {(path:string, name:string) => (void|Promise<void>)} [onRename]
 */

/**
 * Render the file tree into `container`, replacing whatever it held.
 * @param {HTMLElement} container
 * @param {FileTreeDeps} [deps]
 */
export const renderFileTree = (container, {
  files = {},
  entry = '',
  dirtyPaths = [],
  touchedPaths = [],
  message = '',
  confirm = (text) => globalThis.confirm?.(text) ?? false,
  onOpen = () => {},
  onDelete,
  onRename,
} = {}) => {
  container.innerHTML = ''

  const paths = Object.keys(files)
  const entryKey = bare(entry)
  const dirty = new Set(dirtyPaths.map(bare))
  const touched = new Set(touchedPaths.map(bare))

  // A message row leads the list: the tree keeps its shape while the notice is up.
  const showMessage = (text) => {
    container.querySelector('.file-message')?.remove()
    container.prepend(el('li', 'file-message', text))
  }

  const deleteFile = async (path) => {
    if (bare(path) === entryKey) {
      showMessage('The entry file cannot be deleted')
      return
    }
    if (paths.length <= 1) {
      showMessage('The last file cannot be deleted')
      return
    }
    if (!(await confirm(`Delete “${bare(path)}”?`))) return
    await onDelete?.(path)
  }

  const renameFile = (path, name) => {
    if (!name || name === bare(path).slice(bare(path).lastIndexOf('/') + 1)) return
    onRename?.(path, name)
  }

  const fileRow = (path, name) => {
    const key = bare(path)
    const row = el('li', 'file-node')
    row.dataset.path = path
    if (key === entryKey) row.classList.add('is-entry')
    if (dirty.has(key)) row.classList.add('is-dirty')
    if (touched.has(key)) row.classList.add('is-touched')

    const open = el('button', 'file-open', name)
    open.type = 'button'
    open.addEventListener('click', () => onOpen(path))
    row.append(open)

    if (isBinaryPath(key)) {
      row.append(el('span', 'file-size', humanSize(sizeOf(files[path]))))
    }

    if (onRename) {
      const pencil = el('button', 'file-rename', '✎')
      pencil.type = 'button'
      pencil.title = 'Rename'
      pencil.addEventListener('click', () => {
        const entered = prompt('Rename file', name)
        if (entered === null) return
        renameFile(path, entered.trim())
      })
      row.append(pencil)
    }

    if (onDelete) {
      const trash = el('button', 'file-delete', '🗑')
      trash.type = 'button'
      trash.title = 'Delete'
      trash.addEventListener('click', () => { deleteFile(path).catch(() => {}) })
      row.append(trash)
    }

    return row
  }

  /** @param {TreeDir} node @param {HTMLElement} list */
  const renderLevel = (node, list) => {
    for (const dir of [...node.dirs.keys()].sort()) {
      const group = el('li', 'file-dir')
      group.append(el('div', 'file-dir-label', `${dir}/`))
      const children = el('ul', 'file-children')
      const child = node.dirs.get(dir)
      if (child) renderLevel(child, children)
      group.append(children)
      list.append(group)
    }
    const named = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
    for (const file of named) list.append(fileRow(file.path, file.name))
  }

  /** @type {TreeDir} */
  const root = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = bare(path).split('/').filter(Boolean)
    if (!parts.length) continue
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.dirs.get(name)
      if (!child) {
        child = { dirs: new Map(), files: [] }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push({ name: parts[parts.length - 1], path })
  }

  if (message) container.append(el('li', 'file-message', message))
  renderLevel(root, container)
}
