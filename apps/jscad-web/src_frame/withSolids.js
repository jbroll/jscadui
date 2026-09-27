// A streamed grid kept none of its cells, so it runs again whole. Each cell
// reports progress, which restarts the frame's and the app's timers. The
// re-run skips mesh conversion: the export reads the solids back out, so
// entities would be built only to be discarded, at grid-scale memory cost.
export const createWithSolids = ({ lastRunStreamed, postProgress, releaseSolids, currentParams, jscadMain, currentSolids }) => {
  return async (use) => {
    if (!lastRunStreamed()) return use(currentSolids())
    globalThis.__jscadProgress = postProgress
    try {
      await jscadMain({ params: currentParams(), stream: false, solidsOnly: true })
      return await use(currentSolids())
    } finally {
      globalThis.__jscadProgress = null
      releaseSolids()
    }
  }
}
