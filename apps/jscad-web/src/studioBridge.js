/**
 * Expose a minimal external API for setting viewer parameters from outside the
 * page (headless render via page.evaluate, and the live SSE bridge). The viewer's
 * param system is otherwise module-internal.
 *
 * @param {object} deps
 * @param {{ setParam(path:string, value:unknown): string[] }} deps.paramsCtrl
 * @param {() => Promise<void>} deps.runModel  re-run the model + re-render (caller-bound)
 * @param {() => object} deps.getParams        current param values
 */
export function installStudioBridge({ paramsCtrl, runModel, getParams }) {
  globalThis.jscadStudio = {
    ready: true,
    getParams,
    async setParams(obj) {
      for (const [path, value] of Object.entries(obj || {})) {
        paramsCtrl.setParam(path, value)
      }
      await runModel()
      return getParams()
    },
  }
}
