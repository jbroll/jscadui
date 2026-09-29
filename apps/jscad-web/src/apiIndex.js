import { docsTool } from '@jscadui/agent-loop'

// api/index.json is about 260 KB and only the chat reads it, so build.js
// bundles it on its own and hashes this name; a page that never chats never
// downloads it.
export const API_INDEX_BUNDLE = 'build/bundle.api-index.js'

// A computed specifier, so esbuild leaves the import to the browser.
const importBundle = () => import(new URL(API_INDEX_BUNDLE, document.baseURI).href).then((m) => m.default)

/**
 * The index, loaded on the first call and shared after; a failed load is tried again next call.
 * @param {() => Promise<Array<object>>} [load]
 */
export const createIndexLoader = (load = importBundle) => {
  let pending = null
  return () =>
    (pending ??= load().catch((error) => {
      pending = null
      throw error
    }))
}

/**
 * The chat's docs tool.
 * @param {() => Promise<Array<object>>} loadIndex
 * @param {() => string} getApi the chat's API style
 */
export const createDocs = (loadIndex, getApi) => async (query) => docsTool(await loadIndex(), query, { api: getApi() })
