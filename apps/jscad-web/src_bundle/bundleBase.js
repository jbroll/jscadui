/**
 * Resolve a file copied next to a worker bundle. A blob worker's
 * `location.href` is `blob:` with an opaque path, so nothing resolves against
 * it; the compute frame's bootstrap hands the real base down as
 * `__BUNDLE_BASE__`.
 * @param {string} file
 * @param {{__BUNDLE_BASE__?: string, location?: {href?: string}}} scope
 * @returns {string}
 */
export const bundleFileUrl = (file, scope) => {
  const injected = scope.__BUNDLE_BASE__
  if (typeof injected === 'string' && injected) return new URL(file, injected).href
  const href = scope.location?.href ?? ''
  if (!href || href.startsWith('blob:')) {
    throw new Error(`cannot resolve ${file}: no bundle base in this worker`)
  }
  return new URL(file, href).href
}
