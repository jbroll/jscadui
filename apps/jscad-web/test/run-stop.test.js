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
    // The stopped run ends, then the next run starts: usable again.
    setRunning(false)
    setRunning(true)
    expect(btn.disabled).toBe(false)
    setRunning(false)
    expect(btn.style.display).toBe('none')
  })

  it('ignores a second click while an abort is in flight', async () => {
    document.body.innerHTML = '<button id="stop">Stop</button>'
    let release
    const workerApi = { jscadAbort: vi.fn(() => new Promise((resolve) => { release = resolve })) }
    const { setRunning } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError: vi.fn() })
    const btn = document.getElementById('stop')
    setRunning(true)
    btn.click()
    // A jobs update arrives before the abort settles: it must not re-enable the
    // button, and the second click must not send a second abort.
    setRunning(true)
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(workerApi.jscadAbort).toHaveBeenCalledTimes(1)
    release({ aborted: true })
    // The abort settles while the run's jobs still drain: a jobs update must
    // not re-enable the button into a second abort.
    await Promise.resolve()
    setRunning(true)
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(workerApi.jscadAbort).toHaveBeenCalledTimes(1)
  })

  it('clears the cell count for a new run', () => {
    document.body.innerHTML = '<button id="stop">Stop</button>'
    const workerApi = { jscadAbort: vi.fn(async () => ({ aborted: true })) }
    const { setCells } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError: vi.fn() })
    const btn = document.getElementById('stop')
    setCells(1234)
    expect(btn.textContent).toBe('Stop (1234 cells)')
    setCells(null)
    expect(btn.textContent).toBe('Stop')
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
