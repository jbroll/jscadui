// The worker bundles' importData treats only .stl as binary
// (src_bundle/bundle.worker.js, src_frame/bundle.frame-worker.js), so only those cross as ArrayBuffer.
const BINARY_EXT = new Set(['stl'])

/** @param {string} path */
export const isBinaryPath = (path) => BINARY_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

/**
 * The frame's worker is on another origin, so the file service worker cannot
 * serve it: a service worker only sees fetches from clients it controls. The
 * project travels in the message instead.
 * @param {{base:string,cache:Cache}|undefined} sw
 * @returns {Promise<Record<string,string|ArrayBuffer>>}
 */
export const collectProjectFiles = async (sw) => {
  if (!sw?.cache) return {}
  const files = {}
  for (const request of await sw.cache.keys()) {
    const path = new URL(request.url).pathname.replace(new URL(sw.base).pathname, '')
    const response = await sw.cache.match(request)
    if (!response) continue
    files[path] = isBinaryPath(path) ? await response.arrayBuffer() : await response.text()
  }
  return files
}
