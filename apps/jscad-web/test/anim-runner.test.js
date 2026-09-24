import { describe, it, expect, vi } from 'vitest'
import { AnimRunner } from '../src/animRunner.js'

describe('AnimRunner', () => {
  it('runs each frame without streaming, since a streamed result carries no entities to draw', async () => {
    const jscadMain = vi.fn(async () => ({ entities: [] }))
    const runner = new AnimRunner({ jscadMain }, {})
    vi.spyOn(runner, 'waitTime').mockResolvedValue(undefined)

    await runner.start({ fps: 1, min: 0, max: 1, name: 't' }, 0, {})

    expect(jscadMain).toHaveBeenCalled()
    for (const [options] of jscadMain.mock.calls) expect(options.stream).toBe(false)
  })
})
