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
  // Held while another run has the frame: neither side's model is loaded.
  const BORROWED = Symbol('borrowed')
  // Settles once a borrowed run's restore is done; every frame operation waits on it.
  let borrowed = Promise.resolve()
  // Frame operations past that wait; a borrow lets them finish before it takes the frame.
  const inFlight = new Set()
  // Only leaf operations: a gated caller of a gated op would deadlock against a borrow waiting on it.
  const gated = (op) => async (...args) => {
    for (let seen; seen !== borrowed;) await (seen = borrowed)
    const run = op(...args)
    inFlight.add(run)
    try {
      return await run
    } finally {
      inFlight.delete(run)
    }
  }
  let entryMesh = null

  const keyOf = (plan) => plan.url ?? plan.path
  // A failed run's error stays on screen instead; a superseded run's successor speaks for itself.
  const tell = (outcome, path) => {
    if (!outcome?.error && !outcome?.stale) notice(noPartNotice(path))
  }
  const entryPlan = async () => viewPlan(await files(), declared())

  const viewerPlan = async () => {
    const all = await files()
    const plan = viewPlan(all, declared(), selected)
    return plan.kind === 'none' ? { plan: viewPlan(all, declared()), none: plan.path } : { plan, none: null }
  }

  const restore = async () => {
    const { plan } = await viewerPlan()
    await load(plan, { user: true })
    held = keyOf(plan)
  }

  const paintView = async () => {
    const { plan, none } = await viewerPlan()
    held = keyOf(plan)
    const outcome = await paint(plan)
    if (none) tell(outcome, none)
    return outcome
  }

  const ensureEntry = gated(async () => {
    if (selected === undefined && held !== BORROWED) return null
    const plan = await entryPlan()
    if (plan.path && held === plan.path) return null
    held = plan.path
    const { outcome, mesh } = await load(plan, { user: false })
    entryMesh = mesh ?? null
    return outcome
  })

  // The viewer follows `path` unless it has no part to show. Gated whole, as
  // `show` and `open`, so a borrow's restore loads the selection the export saw.
  const showView = async (path) => {
    const plan = viewPlan(await files(), declared(), path)
    if (plan.kind === 'none') {
      const outcome = await paintView()
      tell(outcome, plan.path)
      return outcome
    }
    selected = plan.kind === 'entry' ? undefined : plan.path
    return paintView()
  }
  const render = gated(paintView)

  return {
    /** The file the viewer follows, or undefined for the entry. */
    selected: () => selected,
    render,
    show: gated(showView),
    /** A project switch opens on `path`, the project's stored entry. */
    open: gated((path) => {
      selected = undefined
      held = null
      return showView(path)
    }),
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
    ensureView: gated(async () => {
      if (selected === undefined && held !== BORROWED) return
      const plan = viewPlan(await files(), declared(), selected)
      if (plan.kind === 'none' || held === keyOf(plan)) return
      held = keyOf(plan)
      await load(plan, { user: true })
    }),
    /** Lend the frame to `run`, then load the viewer's own model back with the user's params. */
    borrow: async (run) => {
      const prior = borrowed
      const { promise, resolve } = Promise.withResolvers()
      borrowed = promise
      try {
        await prior
        await Promise.allSettled(inFlight)
        held = BORROWED
        return await run()
      } finally {
        await restore().finally(resolve)
      }
    },
    /** The entry's mesh for the chat's view, or null when the viewer shows the entry itself. */
    entryMesh: () => (selected === undefined ? null : entryMesh),
    /** Something else loaded (an example, a dropped folder): neither side has a model to restore. */
    forget: () => {
      selected = undefined
      held = null
      entryMesh = null
    },
    rename: (from, to) => {
      if (selected !== undefined && selected === bare(from)) selected = bare(to)
    },
  }
}
