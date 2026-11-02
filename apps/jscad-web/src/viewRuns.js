import { projectPath } from '@jscadui/agent-loop'
import { viewPlan } from './projectBuild.js'

const bare = (path) => {
  try {
    return projectPath(path)
  } catch {
    return undefined
  }
}

export const noPartNotice = (path) => `${path} has no part to show (no main or make* export)`

/**
 * The viewer shows the selected file and the chat sees the entry, but the
 * frame holds one model at a time. Each side loads its own model back before
 * it reads the frame, only when the other side replaced it: `ensureEntry`
 * before the chat measures, checks, exports or views, `ensureView` before the
 * user's param change or export.
 * @param {{
 *   files: () => Promise<Record<string, unknown>>,
 *   declared: () => string | undefined,
 *   paint: (plan: object) => Promise<object>,
 *   load: (plan: object, options: {user: boolean}) => Promise<{outcome: object, mesh?: unknown}>,
 *   notice: (text: string) => void,
 * }} deps `paint` runs a plan and draws it; `load` runs it without drawing.
 */
export const createViewRuns = ({ files, declared, paint, load, notice }) => {
  let selected
  // What the frame last loaded: a plan's url or path; null when unknown.
  let held = null
  let entryMesh = null

  const keyOf = (plan) => plan.url ?? plan.path
  // A failed run's error stays on screen instead; a superseded run's successor speaks for itself.
  const tell = (outcome, path) => {
    if (!outcome?.error && !outcome?.stale) notice(noPartNotice(path))
  }
  const entryPlan = async () => viewPlan(await files(), declared())

  const render = async () => {
    const all = await files()
    let plan = viewPlan(all, declared(), selected)
    const none = plan.kind === 'none' ? plan.path : null
    if (none) plan = viewPlan(all, declared())
    held = keyOf(plan)
    const outcome = await paint(plan)
    if (none) tell(outcome, none)
    return outcome
  }

  const ensureEntry = async () => {
    if (selected === undefined) return null
    const plan = await entryPlan()
    if (plan.path && held === plan.path) return null
    held = plan.path
    const { outcome, mesh } = await load(plan, { user: false })
    entryMesh = mesh ?? null
    return outcome
  }

  // The viewer follows `path` unless it has no part to show.
  const show = async (path) => {
    const plan = viewPlan(await files(), declared(), path)
    if (plan.kind === 'none') {
      const outcome = await render()
      tell(outcome, plan.path)
      return outcome
    }
    selected = plan.kind === 'entry' ? undefined : plan.path
    return render()
  }

  return {
    /** The file the viewer follows, or undefined for the entry. */
    selected: () => selected,
    render,
    show,
    /** A project switch opens on `path`, the project's stored entry. */
    open: (path) => {
      selected = undefined
      held = null
      return show(path)
    },
    /**
     * The chat's build: the viewer redraws what it follows, and the report
     * comes from the entry, loaded without drawing when the viewer follows a part.
     */
    build: async () => {
      const outcome = await render()
      if (selected === undefined) return outcome
      return (await ensureEntry()) ?? outcome
    },
    ensureEntry,
    ensureView: async () => {
      if (selected === undefined) return
      const plan = viewPlan(await files(), declared(), selected)
      if (plan.kind === 'none' || held === keyOf(plan)) return
      held = keyOf(plan)
      await load(plan, { user: true })
    },
    /** The entry's mesh for the chat's view, or null when the viewer shows the entry itself. */
    entryMesh: () => (selected === undefined ? null : entryMesh),
    rename: (from, to) => {
      if (selected !== undefined && selected === bare(from)) selected = bare(to)
    },
  }
}
