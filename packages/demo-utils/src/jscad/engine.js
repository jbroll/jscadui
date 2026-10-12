import { RenderThreejs } from '@jscadui/render-threejs'

import { observeResize } from '../observeResize.js'

// import * as THREE from 'three'

export const init = async () => {
  await addScript('build/bundle.threejs.js')
  const JscadThreeViewer = RenderThreejs(THREE)
  const el = document.getElementById('viewer')
  const viewer = JscadThreeViewer(el)

  observeResize(el, evt => viewer.resize(evt.contentRect))

  return viewer
}

const addScript = async (source, module = false) => {
  return new Promise((resolve, reject) => {
    var tag = document.createElement('script')
    tag.type = module ? 'module' : 'text/javascript'
    tag.src = source
    tag.onload = () => resolve()
    tag.onerror = err => reject(err)
    document.head.append(tag)
  })
}
