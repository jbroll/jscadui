import { RenderThreejs } from '@jscadui/render-threejs'

// Track loaded scripts to avoid reloading
const loadedScripts = new Set()

/**
 * Initialize the 3D viewer with the specified render engine
 * @param {'threejs' | 'regl'} engineType
 * @returns {Promise<object>} The viewer instance
 */
export const init = async (engineType = 'threejs') => {
  const el = /** @type {HTMLDivElement} */ (document.getElementById('viewer'))

  let viewer

  if (engineType === 'regl') {
    // Load regl library and render-regl bundle
    await addScript('build/bundle.regl.js')
    await addScript('build/bundle.render-regl.js')
    // @ts-ignore - RenderReglBundle is loaded as a global
    const JscadReglViewer = RenderReglBundle.RenderRegl()
    viewer = JscadReglViewer(el)
  } else {
    // Default to Three.js
    await addScript('build/bundle.threejs.js')
    const JscadThreeViewer = RenderThreejs(THREE)
    viewer = JscadThreeViewer(el)
  }

  // Set up resize observer for future resizes
  observeResize(el, evt => viewer.resize(evt.contentRect))

  // Trigger initial resize with current element dimensions
  const rect = el.getBoundingClientRect()
  viewer.resize({ width: rect.width, height: rect.height })

  return viewer
}

/**
 * @param {HTMLElement} el
 * @param {(entry:ResizeObserverEntry)=>void} listener
 */
const observeResize = (el, listener) => {
  // ResizeObserver is better than window resize as it can be used on any element
  // this is a short/compact/simple implementation that uses a new ResizeObserver each time.
  // which is fine probably up-to 50 of them. There is a performance hit if too many are created.
  // for an implementation that can handle more take a look at https://github.com/hrgdavor/jsx6/tree/main/libs/dom-observer
  const resizeObserver = new ResizeObserver(entries => {
    listener(entries[0])
  })
  resizeObserver.observe(el)
}

/**
 * @param {string} source
 * @param {boolean} [module]
 * @returns {Promise<void>}
 */
const addScript = async (source, module = false) => {
  // Don't reload already-loaded scripts
  if (loadedScripts.has(source)) return

  return new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.type = module ? 'module' : 'text/javascript'
    tag.src = source
    tag.onload = () => {
      loadedScripts.add(source)
      resolve()
    }
    tag.onerror = err => reject(err)
    document.head.append(tag)
  })
}
