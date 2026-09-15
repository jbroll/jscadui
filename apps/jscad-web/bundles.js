const ANCHORS_CDN = 'https://cdn.jsdelivr.net/npm/@jbroll/jscad-anchors@0/dist/jscad-anchors.cjs'

/**
 * Module URLs for the worker's bundle aliases.
 * @param {{engine?: string, toUrl: (path: string) => string, overrides?: Record<string, string>}} options
 * @returns {Record<string, string>}
 */
export const getBundles = ({ engine, toUrl, overrides = {} }) => {
  const jscadModeling = toUrl('./build/bundle.jscad_modeling.js')
  const anchors = overrides['@jbroll/jscad-anchors'] ?? ANCHORS_CDN
  return {
    ...overrides,
    '@jscad/modeling': anchors,
    '@jbroll/jscad-anchors': anchors,
    '@jscad/modeling-for-anchors': engine === 'manifold' ? toUrl('./build/bundle.manifold_modeling.js') : jscadModeling,
    '@jscad/modeling-for-manifold': jscadModeling,
    '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
    '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
    '@jscadui/params-core': toUrl('./build/bundle.params_core.js'),
    '@jscadui/jscad-text': toUrl('./build/bundle.jscad_text.js'),
  }
}
