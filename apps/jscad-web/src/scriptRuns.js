/**
 * Script loads overlap: each awaits file collection before it reaches the
 * frame, so an older load can finish after a newer one. Only the newest may
 * touch the page. A param change is dropped by any newer run, but it does not
 * drop a load, which still has to build the params UI.
 * @returns {{load: () => () => boolean, paramChange: () => () => boolean}}
 *   begin a run; the result says whether a run that supersedes it began since
 */
export const createScriptRuns = () => {
  let latest = 0
  let latestLoad = 0
  return {
    load: () => {
      const run = latestLoad = ++latest
      return () => run !== latestLoad
    },
    paramChange: () => {
      const run = ++latest
      return () => run !== latest
    },
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
