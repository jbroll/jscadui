/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest'
import { bindStopButton } from '../src/runStop.js'

describe('bindStopButton', () => {
  it('hides until a run starts, disables on click, re-enables on the next run', async () => {
    document.body.innerHTML = '<button id="stop">Stop</button>'
    const workerApi = { jscadAbort: vi.fn(async () => ({ aborted: true })) }
    const { setRunning } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError: vi.fn() })
    const btn = document.getElementById('stop')
    expect(btn.style.display).toBe('none')
    setRunning(true)
    expect(btn.style.display).toBe('')
    btn.click()
    expect(workerApi.jscadAbort).toHaveBeenCalledTimes(1)
    expect(btn.disabled).toBe(true)
    setRunning(true)
    expect(btn.disabled).toBe(false)
    setRunning(false)
    expect(btn.style.display).toBe('none')
  })

  it('shows the streamed cell count and reports an abort failure', async () => {
    document.body.innerHTML = '<button id="stop">Stop</button>'
    const onError = vi.fn()
    const workerApi = { jscadAbort: vi.fn(async () => { throw new Error('frame gone') }) }
    const { setRunning, setCells } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError })
    setRunning(true)
    setCells(1234)
    expect(document.getElementById('stop').textContent).toBe('Stop (1234 cells)')
    document.getElementById('stop').click()
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
  })
})
