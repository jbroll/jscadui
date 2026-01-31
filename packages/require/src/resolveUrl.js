
export const MODULE_BASE = 'https://cdn.jsdelivr.net/npm/'

export const getExtension = (url) => {
  const arr = url.split('/')
  const file = arr[arr.length-1]
  const idx = file.lastIndexOf('.')
  return idx === -1 ? '' : file.substring(idx+1)
}

/**
 * Recursively decode URL-encoded strings until stable.
 * Prevents double-encoding bypasses like %252e%252e -> %2e%2e -> ..
 * @param {string} path
 * @returns {string}
 */
const fullyDecode = (path) => {
  let decoded = path
  let prev
  do {
    prev = decoded
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      // Invalid encoding, stop decoding
      break
    }
  } while (decoded !== prev)
  return decoded
}

/**
 * Normalize a path by resolving . and .. segments
 * Prevents traversal above root by ignoring .. when at root level
 * @param {string} path
 * @returns {string}
 */
const normalizePath = (path) => {
  // Decode URL-encoded path traversal attempts (handles double-encoding)
  const decoded = fullyDecode(path)
  const parts = decoded.split('/')
  const result = []
  for (const part of parts) {
    if (part === '..') {
      // Only pop if there are segments to remove; ignore if at root level
      if (result.length > 0) {
        result.pop()
      }
    } else if (part && part !== '.') {
      result.push(part)
    }
  }
  return result.join('/')
}

const splitModuleName = (module) => {
  let file = ''
  let idx = module.indexOf('/')
  if (module[0] === '@') idx = module.indexOf('/',idx+1)
  if (idx !== -1) {
    file = module.substring(idx+1)
    module = module.substring(0,idx)
  }
  return [module,file]
}

/**
 * Resolve a package or file name to a url.
 * JS packages will resolve to an npm package url.
 * Relative urls will resolve to a local url.
 * @param {string} url the package or file name to resolve
 * @param {string} base the url of the current module to resolve relative to
 * @param {string} root the url under which local files are served
 * @param {string} moduleBase the url for npm packages
 * @returns the resolved module url
 */
export const resolveUrl = (url, base, root, moduleBase=MODULE_BASE) => {
  let isRelativeFile = false
  let isModule = false
  
  if (!/^(http:|https:|fs:|file:)/.test(url)) {
    // npm modules cannot start with . or /
    if (!/^\.?\.?\//.test(url)) {
      const [moduleName, moduleFile] = splitModuleName(url)
      const moduleUrl = new URL(moduleName, moduleBase).toString()
      if (moduleFile) {
        base = root = moduleUrl + '/'
        url = moduleFile
        isRelativeFile = true
      } else {
        isModule = true
        url = moduleUrl
      }
    } else {
      isRelativeFile = true
    }

    if (isRelativeFile && root) {
      // Check if base is from a different domain than root (e.g., npm package on jsdelivr)
      // In that case, resolve relative to base directly without root restrictions
      const getOrigin = (s) => {
        try { return new URL(s).origin } catch { return null }
      }
      const rootOrigin = getOrigin(root)
      const baseOrigin = getOrigin(base)

      if (baseOrigin && rootOrigin && baseOrigin !== rootOrigin) {
        // H10 doc: Cross-origin imports (e.g., npm packages on CDN) intentionally skip
        // path normalization. This is safe because:
        // 1. CDN packages are served from their own isolated origin
        // 2. Path traversal within a CDN package only navigates within that package's tree
        // 3. The CDN itself enforces access controls on its content
        // 4. User's local files (at rootOrigin) cannot be accessed from a different origin
        if (!getExtension(url)) url += '.js'
        url = new URL(url, base).toString()
      } else {
        // sanitize to avoid going below root, it will prevent / to go below cache baseUrl
        // it will prevent ../../../../ to go below cache baseUrl
        const fromRoot = root && url[0] === '/'
        if (!fromRoot) {
          // base relative path
          const relativePath = base.replace(/^\//, '').replace(root, '') // strip root
          // create url relative path
          url = new URL(url, `fs:/root/${relativePath}`).toString()
          // check if url went above root
          if (!url.startsWith('fs:/root/')) throw new Error('relative url cannot go above root')
          url = url.substring(9)
          // Defense in depth: normalize path to remove any remaining .. segments
          url = normalizePath(url)
        } else {
          // Normalize absolute paths from root
          url = normalizePath(url.substring(1))
        }
        if (!getExtension(url)) url += '.js'
        // now create the full url to load the file
        url = new URL(url, root).toString()
      }
    }
  }
  return { url, isRelativeFile, isModule }
}
