import { describe, expect, it, vi } from 'vitest'
import { createViewRuns, noPartNotice } from '../src/viewRuns.js'

const project = () => ({
  'main.js': "const { makeTruck } = require('./truck.js')\nmodule.exports = { main: () => makeTruck() }",
  'truck.js': "const dims = require('./lib/dims.js')\nmodule.exports = { makeTruck, makeWheelset, axleDx }",
  'lib/dims.js': 'module.exports = { length: 40 }',
  'gear.js': 'module.exports = { main }',
})

// The frame as the runs see it: what each paint and quiet load ran, in order.
const setup = (files = project()) => {
  const runs = []
  const notices = []
  const deps = {
    files: async () => files,
    declared: () => 'main.js',
    paint: vi.fn(async (plan) => {
      runs.push(['paint', plan.url ?? plan.path])
      return { result: { painted: plan.path } }
    }),
    load: vi.fn(async (plan, { user }) => {
      runs.push([user ? 'load-user' : 'load', plan.url ?? plan.path])
      return { outcome: { result: { loaded: plan.path } }, mesh: [`mesh of ${plan.path}`] }
    }),
    notice: (text) => notices.push(text),
  }
  return { views: createViewRuns(deps), runs, notices, files, deps }
}

describe('createViewRuns', () => {
  it('a selected part file draws through its synthesized entry; the entry clears the selection', async () => {
    const { views, runs } = setup()
    await views.show('/truck.js')
    expect(views.selected()).toBe('truck.js')
    await views.show('/main.js')
    expect(views.selected()).toBe(undefined)
    expect(runs).toEqual([['paint', '.part-view.js'], ['paint', 'main.js']])
  })

  it('a file with its own main draws as itself', async () => {
    const { views, runs } = setup()
    await views.show('gear.js')
    expect(runs).toEqual([['paint', 'gear.js']])
  })

  it('a file with no part keeps the viewer where it was, redraws it, and says so', async () => {
    const { views, runs, notices } = setup()
    await views.show('truck.js')
    await views.show('/lib/dims.js')
    expect(views.selected()).toBe('truck.js')
    expect(runs).toEqual([['paint', '.part-view.js'], ['paint', '.part-view.js']])
    expect(notices).toEqual([noPartNotice('lib/dims.js')])
  })

  it('leaves a failed redraw its error instead of the notice', async () => {
    const { views, notices, deps } = setup()
    deps.paint.mockResolvedValueOnce({ error: new Error('boom') })
    await views.show('lib/dims.js')
    expect(notices).toEqual([])
  })

  it('a selected file that loses its part falls back to the entry with the notice', async () => {
    const { views, runs, notices, files } = setup()
    await views.show('truck.js')
    files['truck.js'] = 'module.exports = { axleDx }'
    await views.render()
    expect(runs.at(-1)).toEqual(['paint', 'main.js'])
    expect(notices).toEqual([noPartNotice('truck.js')])
  })

  it("the chat's build with nothing selected draws the entry once and answers its outcome", async () => {
    const { views, runs } = setup()
    expect(await views.build()).toEqual({ result: { painted: 'main.js' } })
    expect(runs).toEqual([['paint', 'main.js']])
  })

  it("the chat's build with a part selected draws the part, then loads the entry quietly for the report", async () => {
    const { views, runs } = setup()
    await views.show('truck.js')
    runs.length = 0
    expect(await views.build()).toEqual({ result: { loaded: 'main.js' } })
    expect(runs).toEqual([['paint', '.part-view.js'], ['load', 'main.js']])
    expect(views.entryMesh()).toEqual(['mesh of main.js'])
  })

  it('reads by the chat after its build reuse the loaded entry; after a user run they load it again', async () => {
    const { views, runs } = setup()
    await views.show('truck.js')
    await views.build()
    runs.length = 0
    await views.ensureEntry()
    expect(runs).toEqual([])
    await views.show('truck.js')
    await views.ensureEntry()
    expect(runs).toEqual([['paint', '.part-view.js'], ['load', 'main.js']])
  })

  it("the user's param change or export loads the selected part back, with the user's params, only when the chat replaced it", async () => {
    const { views, runs } = setup()
    await views.show('truck.js')
    await views.ensureView()
    expect(runs).toEqual([['paint', '.part-view.js']])
    await views.build()
    runs.length = 0
    await views.ensureView()
    await views.ensureView()
    expect(runs).toEqual([['load-user', '.part-view.js']])
  })

  it('with nothing selected neither side reloads anything', async () => {
    const { views, runs } = setup()
    await views.render()
    await views.ensureEntry()
    await views.ensureView()
    expect(runs).toEqual([['paint', 'main.js']])
    expect(views.entryMesh()).toBe(null)
  })

  it('a project switch clears the selection, keeping a stored model of its own selected', async () => {
    const { views, runs } = setup()
    await views.show('truck.js')
    await views.open('main.js')
    expect(views.selected()).toBe(undefined)
    await views.open('gear.js')
    expect(views.selected()).toBe('gear.js')
    expect(runs.slice(1)).toEqual([['paint', 'main.js'], ['paint', 'gear.js']])
  })

  it('after another load, a param change does not bring the part back over it', async () => {
    const { views, runs } = setup()
    await views.show('truck.js')
    await views.build()
    views.forget()
    runs.length = 0
    await views.ensureView()
    await views.ensureEntry()
    expect(runs).toEqual([])
    expect(views.selected()).toBe(undefined)
  })

  it('a rename of the selected file moves the selection', async () => {
    const { views } = setup()
    await views.show('truck.js')
    views.rename('/truck.js', 'lorry.js')
    expect(views.selected()).toBe('lorry.js')
    views.rename('/gear.js', 'cog.js')
    expect(views.selected()).toBe('lorry.js')
  })
})
