import { describe, expect, it } from 'vitest'
import { conversationTag, createLiveLog, formatLiveHeader, liveLogPath, prefixBlock } from './live-log.js'

describe('liveLogPath', () => {
  it('defaults to the jscad-chat state dir', () => {
    expect(liveLogPath({})).toMatch(/\.local\/state\/jscad-chat\/eval-live\.log$/)
  })

  it('is overridden by EVAL_LIVE_LOG', () => {
    expect(liveLogPath({ EVAL_LIVE_LOG: '/tmp/x.log' })).toBe('/tmp/x.log')
  })

  it('is disabled by EVAL_LIVE_LOG=0', () => {
    expect(liveLogPath({ EVAL_LIVE_LOG: '0' })).toBeNull()
  })
})

describe('prefixBlock', () => {
  it('prefixes a single line and ends with a newline', () => {
    expect(prefixBlock('gpt-5', 'hello')).toBe('[gpt-5] hello\n')
  })

  it('prefixes every line of a multi-line block', () => {
    expect(prefixBlock('gpt-5', 'line one\nline two')).toBe('[gpt-5] line one\n[gpt-5] line two\n')
  })
})

describe('conversationTag', () => {
  it('names the model, fixture and run so interleaved conversations stay apart', () => {
    expect(prefixBlock(conversationTag('gpt-5', 'cube-hole', 2), 'a\nb')).toBe('[gpt-5 cube-hole#2] a\n[gpt-5 cube-hole#2] b\n')
  })
})

describe('formatLiveHeader', () => {
  it('includes time, provider, model, prompt hash, fixtures, runs and the result file', () => {
    const line = formatLiveHeader({
      provider: 'anthropic',
      model: 'claude-x',
      promptSha256: 'abcdef0123456789',
      fixtureNames: ['cube-hole', 'gear'],
      runs: 3,
      filePath: '/data/results/x.json',
      now: new Date('2026-09-28T12:00:00.000Z'),
    })
    expect(line).toBe(
      '2026-09-28T12:00:00.000Z provider=anthropic model=claude-x promptSha=abcdef01 fixtures=cube-hole,gear runs=3 file=/data/results/x.json',
    )
  })
})

const fakeFs = (files = {}) => ({
  files,
  mkdirCalls: [],
  renameCalls: [],
  appendCalls: [],
  mkdirSync(dir) {
    this.mkdirCalls.push(dir)
  },
  statSync(path) {
    if (!(path in this.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { size: this.files[path].length }
  },
  renameSync(from, to) {
    this.renameCalls.push([from, to])
    this.files[to] = this.files[from]
    delete this.files[from]
  },
  appendFileSync(path, text) {
    this.appendCalls.push([path, text])
    this.files[path] = (this.files[path] ?? '') + text
  },
})

describe('createLiveLog', () => {
  it('is a no-op when the path is disabled', () => {
    const fs = fakeFs()
    const log = createLiveLog(null, { fs })
    expect(() => log.write('x')).not.toThrow()
    expect(fs.mkdirCalls).toEqual([])
    expect(fs.appendCalls).toEqual([])
  })

  it('creates the log directory and appends each write', () => {
    const fs = fakeFs()
    const log = createLiveLog('/state/jscad-chat/eval-live.log', { fs })
    log.write('[m] line one\n')
    log.write('[m] line two\n')
    expect(fs.mkdirCalls).toEqual(['/state/jscad-chat'])
    expect(fs.appendCalls).toEqual([
      ['/state/jscad-chat/eval-live.log', '[m] line one\n'],
      ['/state/jscad-chat/eval-live.log', '[m] line two\n'],
    ])
  })

  it('rotates to .1 before a write that would push the file over the threshold', () => {
    const path = '/state/eval-live.log'
    const fs = fakeFs({ [path]: 'x'.repeat(20) })
    const log = createLiveLog(path, { fs, rotateBytes: 10 })
    log.write('fresh\n')
    expect(fs.renameCalls).toEqual([[path, `${path}.1`]])
    expect(fs.files[`${path}.1`]).toBe('x'.repeat(20))
    expect(fs.files[path]).toBe('fresh\n')
  })

  it('replaces an existing .1 on a second rotation', () => {
    const path = '/state/eval-live.log'
    const fs = fakeFs({ [path]: 'x'.repeat(20), [`${path}.1`]: 'stale' })
    const log = createLiveLog(path, { fs, rotateBytes: 10 })
    log.write('fresh\n')
    expect(fs.files[`${path}.1`]).toBe('x'.repeat(20))
  })

  it('does not rotate a file under the threshold', () => {
    const path = '/state/eval-live.log'
    const fs = fakeFs({ [path]: 'short' })
    const log = createLiveLog(path, { fs, rotateBytes: 10 })
    log.write('more\n')
    expect(fs.renameCalls).toEqual([])
    expect(fs.files[path]).toBe('shortmore\n')
  })

  it('treats a missing file as empty instead of throwing', () => {
    const path = '/state/eval-live.log'
    const fs = fakeFs()
    const log = createLiveLog(path, { fs, rotateBytes: 10 })
    expect(() => log.write('first\n')).not.toThrow()
    expect(fs.files[path]).toBe('first\n')
  })
})
