/**
 * Build identity for the running app: the content hash of the main entry in
 * the served index.html (the same hash smoke-deploy's entryHash reads), shown
 * in the menu and polled so a long-lived tab can notice a newer deploy.
 */

// Mirrors smoke-deploy's entryHash (src_build/buildId.js) for the app entry.
export const buildHashOf = (html) => html.match(/(?<![\w-])main\.([0-9a-f]{8})\.js/)?.[1] ?? null

/**
 * The build hash the server is serving right now, or null when it cannot be
 * told (dev server with unhashed entries, failed fetch).
 */
export const currentBuildHash = async ({ fetchFn = fetch, url = '/' } = {}) => {
  let res
  try {
    res = await fetchFn(url, { cache: 'no-store' })
  } catch {
    return null
  }
  if (!res?.ok) return null
  return buildHashOf(await res.text())
}

/**
 * Poll the served build; call onNewVersion once with the new hash when it
 * differs from `current`. Unhashable answers are ignored, never reported.
 * @returns {() => void} stop polling
 */
export const watchBuildHash = ({ current, intervalMs = 5 * 60 * 1000, onNewVersion, fetchFn, url } = {}) => {
  let stopped = false
  let timer
  const check = async () => {
    if (stopped) return
    const latest = await currentBuildHash({ fetchFn, url })
    if (stopped) return
    if (latest && latest !== current) {
      stopped = true
      onNewVersion?.(latest)
      return
    }
    if (!stopped) timer = setTimeout(check, intervalMs)
  }
  timer = setTimeout(check, intervalMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
