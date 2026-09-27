// A streamed grid kept none of its cells, so it runs again whole. Each cell
// reports progress, which restarts the frame's and the app's timers. The
// re-run skips mesh conversion: the export reads the solids back out, so
// entities would be built only to be discarded, at grid-scale memory cost.
// Export, measure and check re-run a streamed grid through the same worker
// globals (__jscadProgress, the solids store behind currentSolids and
// releaseSolids), and the worker answers concurrent requests freely, so two
// re-runs interleave at their awaits without this. One promise chain, shared
// by every withSolids instance in the worker, runs each re-run whole before
// the next starts. The chain survives rejections so one failed export never
// wedges the rest.
let tail = Promise.resolve()

const serialized = (run) => {
  const result = tail.then(run)
  tail = result.catch(() => {})
  return result
}

export const createWithSolids = ({ lastRunStreamed, postProgress, releaseSolids, currentParams, jscadMain, currentSolids }) => {
  return async (use) => serialized(async () => {
    if (!lastRunStreamed()) return use(currentSolids())
    globalThis.__jscadProgress = postProgress
    try {
      await jscadMain({ params: currentParams(), stream: false, solidsOnly: true })
      return await use(currentSolids())
    } finally {
      globalThis.__jscadProgress = null
      releaseSolids()
    }
  })
}
