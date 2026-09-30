import { afterEach, describe, expect, it } from 'vitest'
import { installRunConsole } from '../src_frame/consoleCapture.js'

const REAL = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }

describe('frame console capture', () => {
  afterEach(() => {
    Object.assign(console, REAL)
  })

  it('records each call and forwards it to the real console', () => {
    const forwarded = []
    console.log = (...args) => forwarded.push(args)
    let collector
    installRunConsole({ setRunConsole: (c) => { collector = c } })

    console.log('hello', { a: 1 })

    expect(forwarded).toEqual([['hello', { a: 1 }]])
    expect(collector.list()).toEqual(['hello {"a":1}'])
  })

  it('installs a collector for every console level', () => {
    let collector
    installRunConsole({ setRunConsole: (c) => { collector = c } })
    console.info('i')
    console.warn('w')
    console.error('e')
    console.debug('d')
    expect(collector.list()).toEqual(['i', 'w', 'e', 'd'])
  })

  it('reports only the current run in the frame worker, not a scratch run before it', async () => {
    globalThis.self ??= { addEventListener() {}, postMessage() {} }
    const { jscadMain, jscadScript, setRunConsole } = await import('@jscadui/worker')
    const quiet = () => {}
    Object.assign(console, { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet })
    installRunConsole({ setRunConsole })
    const model = "module.exports = { main: () => { console.log('main ran'); return [] } }"
    await jscadScript({ script: model, url: 'http://project.local/model.js' })
    const scratch = await jscadScript({
      script: "console.log('scratch output')\nmodule.exports = {}",
      url: 'http://project.local/scratch.js',
      scratch: true,
    })
    expect(scratch.console).toEqual(['scratch output'])

    const paramChange = await jscadMain({ params: {} })

    expect(paramChange.console).toEqual(['main ran'])
    setRunConsole(null)
  })
})
