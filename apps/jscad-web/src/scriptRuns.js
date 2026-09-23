/**
 * Script loads overlap: each awaits file collection before it reaches the
 * frame, so an older load can finish after a newer one. Only the newest may
 * touch the page.
 * @returns {() => () => boolean} begin a run; the result says whether a newer one began since
 */
export const createScriptRuns = () => {
  let latest = 0
  return () => {
    const run = ++latest
    return () => run !== latest
  }
}

/**
 * Send a script with the file map it resolves against. Both go out in the
 * same turn, so no other run's map can land between them.
 * @param {{jscadSetFiles: Function, jscadScript: Function}} workerApi
 * @param {Record<string, string>} files
 * @param {object} request jscadScript options
 */
export const sendScript = async (workerApi, files, request) => {
  const [, result] = await Promise.all([workerApi.jscadSetFiles({ files }), workerApi.jscadScript(request)])
  return result
}
