export const HARNESS_FLAG_KEY = 'jscad-harness'

// The browser session generator drives the real app and calls the chat's own
// handlers through this hook. It is absent unless the page's localStorage opts in.
export function installHarnessHook({ storage, target, view, measure, check, buildReport }) {
  let flag = null
  try { flag = storage?.getItem(HARNESS_FLAG_KEY) } catch { /* storage blocked */ }
  if (flag !== '1') return false
  target.jscadHarness = { view, measure, check, buildReport }
  return true
}
