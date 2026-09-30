// apps/jscad-web/test/aiChat.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { buildSystemPrompt } from '@jscadui/agent-loop'
import { initChat, relayBaseUrl } from '../src/aiChat.js'

describe('browser chat turn', () => {
  it('runs requestTool for a tool_use and appends streamed text', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ requestTool, onText }) => {
      onText('Hello')
      const result = await requestTool('measure', {})
      onText(`volume ${JSON.parse(result).volume}`)
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'how big?'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))
    expect(container.querySelector('.chat-messages').textContent).toMatch(/volume 42/)
  })

  it('renders a string tool result as-is, not JSON-quoted with literal \\n', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const docsText = 'cuboid(options)\n  size: [x, y, z]'
    const runTurnFn = vi.fn(async ({ requestTool }) => {
      await requestTool('docs', { name: 'cuboid' })
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: vi.fn(async () => docsText),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'docs for cuboid'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    const resultEl = await vi.waitFor(() => {
      const el = container.querySelector('.chat-tool-result')
      expect(el.textContent).not.toBe('running...')
      return el
    })
    expect(resultEl.textContent).toBe(docsText)
  })

  it('renders text after a tool call as a fresh message below the tool line', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ requestTool, onText }) => {
      onText('I will measure')
      await requestTool('measure', {})
      onText('the volume is 42')
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'how big?'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))

    const messages = container.querySelector('.chat-messages')
    const assistants = messages.querySelectorAll('.chat-msg.assistant')
    const tool = messages.querySelector('.chat-tool')
    expect(assistants.length).toBe(2)
    expect(assistants[0].textContent).toBe('I will measure')
    expect(assistants[1].textContent).toBe('the volume is 42')
    expect(tool.compareDocumentPosition(assistants[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
const abortError = () => Object.assign(new Error('turn aborted'), { name: 'AbortError' })

// A turn that waits until the test releases it or the chat aborts it.
const heldTurn = () => {
  let release
  let args
  const runTurnFn = vi.fn((options) => {
    args = options
    return new Promise((resolve, reject) => {
      release = () => resolve({ messages: [] })
      options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
    })
  })
  return { runTurnFn, release: () => release(), args: () => args }
}

const openChat = (options = {}) => {
  document.body.innerHTML = '<div id="chat"></div>'
  const container = document.getElementById('chat')
  initChat({
    container,
    requestTool: async () => '{}',
    getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
    ...options,
  })
  const q = (selector) => container.querySelector(selector)
  const type = (text) => {
    q('.chat-input').value = text
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  }
  return { container, q, type }
}

describe('running turn', () => {
  it('turns Send into Stop while a turn runs and back when it ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    const send = q('.chat-send')
    expect([send.textContent, send.getAttribute('aria-label'), send.type]).toEqual(['Send', 'Send the message', 'submit'])
    type('a cube')
    expect([send.textContent, send.getAttribute('aria-label'), send.type]).toEqual(['Stop', 'Stop the reply', 'button'])
    expect(send.classList.contains('running')).toBe(true)
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.release()
    await vi.waitFor(() => expect(send.textContent).toBe('Send'))
    expect([send.getAttribute('aria-label'), send.type, send.classList.contains('running')]).toEqual(['Send the message', 'submit', false])
  })

  it('keeps the input editable while a turn runs, and Enter does not send until it ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    type('first')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    expect(q('.chat-input').disabled).toBe(false)
    type('second')
    expect(q('.chat-input').value).toBe('second')
    expect(turn.runTurnFn).toHaveBeenCalledTimes(1)
    turn.release()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(2))
    expect(turn.runTurnFn.mock.calls[1][0].conversation.messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it('Stop aborts the turn, keeps the partial reply marked stopped, persists it and still ends the turn', async () => {
    const turn = heldTurn()
    const endTurn = vi.fn(async () => {})
    const storage = { readConversation: async () => null, writeConversation: vi.fn(async () => {}) }
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn, endTurn, storage, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onText('Writing the cu')
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(turn.args().signal.aborted).toBe(true)
    expect(q('.chat-msg.assistant').textContent).toBe('Writing the cu')
    expect(q('.chat-msg.stopped').textContent).toBe('Stopped')
    expect(q('.chat-msg.error')).toBeNull()
    expect(endTurn).toHaveBeenCalledTimes(1)
    expect(storage.writeConversation.mock.calls.at(-1)[1]).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Writing the cu', stopped: true },
    ])
  })

  it('tells the model a stopped reply was stopped, and shows it stopped on resume', async () => {
    const stored = [{ role: 'user', content: 'a cube' }, { role: 'assistant', content: '', stopped: true }]
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const storage = { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation: vi.fn(async () => {}) }
    const { q, type } = openChat({ runTurnFn, storage, projectId: 'p1' })
    await vi.waitFor(() => expect(q('.chat-msg.stopped')?.textContent).toBe('Stopped'))
    expect(q('.chat-msg.assistant')).toBeNull()
    type('go on')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(runTurnFn.mock.calls[0][0].conversation.messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: '[stopped by the user]' },
    ])
  })

  it('shows the phase of the turn above the input and hides it when the turn ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    const status = q('.chat-status')
    const phase = q('.chat-status-phase')
    expect(phase.getAttribute('aria-live')).toBe('polite')
    expect(q('.chat-status-time').getAttribute('aria-hidden')).toBe('true')
    expect(status.nextElementSibling).toBe(q('.chat-form'))
    type('a cube')
    expect(status.classList.contains('active')).toBe(true)
    expect(phase.textContent).toBe('Thinking…')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    const { onStatus } = turn.args()
    onStatus({ phase: 'thinking', reasoningChars: 400 })
    expect(phase.textContent).toBe('Thinking…')
    expect(q('.chat-status-time').textContent).toMatch(/^~100 tokens · \d+s$/)
    onStatus({ phase: 'text' })
    expect(phase.textContent).toBe('Writing…')
    expect(q('.chat-status-time').textContent).toMatch(/^\d+s$/)
    onStatus({ phase: 'tool', tool: 'write', detail: 'main.js' })
    expect(phase.textContent).toBe('write main.js…')
    onStatus({ phase: 'tool', tool: 'measure' })
    expect(phase.textContent).toBe('measure…')
    onStatus({ phase: 'retry', attempt: 2, maxAttempts: 4 })
    expect(phase.textContent).toBe('Provider busy, retrying (2/4)…')
    turn.release()
    await vi.waitFor(() => expect(status.classList.contains('active')).toBe(false))
    expect(phase.textContent).toBe('')
    expect(q('.chat-status-time').textContent).toBe('')
  })

  it('counts the seconds of the turn about once a second', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const turn = heldTurn()
      const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      expect(q('.chat-status-time').textContent).toBe('0s')
      vi.advanceTimersByTime(2100)
      expect(q('.chat-status-time').textContent).toBe('2s')
      expect(q('.chat-status-phase').textContent).toBe('Thinking…')
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('model reasoning', () => {
  // vi.waitFor would advance the fake clock; a macrotask lets the turn start without moving it.
  const started = async (turn) => {
    while (turn.runTurnFn.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  const withClock = async (fn) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      await fn()
    } finally {
      vi.useRealTimers()
    }
  }

  it('streams each step into a collapsed block, Thinking… with its seconds, then Thought for Ns when text starts', () =>
    withClock(async () => {
      const turn = heldTurn()
      const { q, container, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      await started(turn)
      const { onReasoning, onStatus, onText } = turn.args()
      onStatus({ phase: 'thinking', reasoningChars: 4 })
      onReasoning('hmm ')
      const block = q('.chat-reasoning')
      expect(block.tagName).toBe('DETAILS')
      expect(block.open).toBe(false)
      expect(block.querySelector('summary').textContent).toBe('Thinking… 0s')
      onReasoning('a cube')
      expect(q('.chat-reasoning-text').textContent).toBe('hmm a cube')
      vi.advanceTimersByTime(3100)
      expect(block.querySelector('summary').textContent).toBe('Thinking… 3s')
      onStatus({ phase: 'text' })
      onText('Here it is')
      expect(block.querySelector('summary').textContent).toBe('Thought for 3s')
      expect(block.compareDocumentPosition(q('.chat-msg.assistant')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      vi.advanceTimersByTime(5000)
      expect(block.querySelector('summary').textContent).toBe('Thought for 3s')
      expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
      turn.release()
    }))

  it('opens a new block for each model step and closes the last one when the turn ends', () =>
    withClock(async () => {
      const turn = heldTurn()
      const { q, container, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      await started(turn)
      const { onReasoning, onStatus, requestTool } = turn.args()
      onReasoning('write it')
      onStatus({ phase: 'tool', tool: 'write', detail: 'main.js' })
      await requestTool('write', { path: 'main.js', content: 'x' })
      onStatus({ phase: 'thinking' })
      vi.advanceTimersByTime(1000)
      onReasoning('check it')
      const blocks = container.querySelectorAll('.chat-reasoning')
      expect(blocks).toHaveLength(2)
      expect(blocks[0].querySelector('summary').textContent).toBe('Thought for 1s')
      expect(blocks[1].querySelector('summary').textContent).toBe('Thinking… 0s')
      expect(q('.chat-tool').compareDocumentPosition(blocks[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      vi.advanceTimersByTime(2000)
      turn.release()
      await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
      expect(blocks[1].querySelector('summary').textContent).toBe('Thought for 2s')
    }))

  it('closes the block when the turn fails or is stopped', async () => {
    const failing = openChat({
      runTurnFn: async ({ onReasoning }) => {
        onReasoning('hmm')
        throw new Error('provider down')
      },
    })
    failing.type('a cube')
    await vi.waitFor(() => expect(failing.q('.chat-msg.error')?.textContent).toBe('provider down'))
    expect(failing.q('.chat-reasoning summary').textContent).toMatch(/^Thought for \d+s$/)

    const turn = heldTurn()
    const stopped = openChat({ runTurnFn: turn.runTurnFn })
    stopped.type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onReasoning('hmm')
    stopped.q('.chat-send').click()
    await vi.waitFor(() => expect(stopped.q('.chat-msg.stopped')).not.toBeNull())
    expect(stopped.q('.chat-reasoning summary').textContent).toMatch(/^Thought for \d+s$/)
  })

  it('stores the reasoning with the reply, shows it on reload, and never sends it to the model', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const writeConversation = vi.fn(async () => {})
      const first = openChat({
        runTurnFn: async ({ onReasoning, onStatus, onText }) => {
          onReasoning('secret plan')
          onStatus({ phase: 'text' })
          onText('hi')
          return { messages: [] }
        },
        storage: { readConversation: async () => null, writeConversation },
        projectId: 'p1',
      })
      first.type('hello')
      await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toHaveLength(2))
      const stored = writeConversation.mock.calls.at(-1)[1]
      expect(stored[1]).toEqual({ role: 'assistant', content: 'hi', reasoning: [{ text: 'secret plan', seconds: expect.any(Number) }] })

      const runTurnFn = vi.fn(async ({ provider }) => {
        for await (const e of provider.send(runTurnFn.mock.calls[0][0].conversation.messages, [])) void e
        return { messages: [] }
      })
      const resumed = [stored[0], { ...stored[1], reasoning: [{ text: 'secret plan', seconds: 4 }] }]
      const second = openChat({ runTurnFn, storage: { readConversation: async () => ({ messages: resumed, updated: 1 }), writeConversation }, projectId: 'p1' })
      await vi.waitFor(() => expect(second.q('.chat-reasoning')).not.toBeNull())
      const block = second.q('.chat-reasoning')
      expect(block.open).toBe(false)
      expect(block.querySelector('summary').textContent).toBe('Thought for 4s')
      expect(block.querySelector('.chat-reasoning-text').textContent).toBe('secret plan')
      expect(block.compareDocumentPosition(second.q('.chat-msg.assistant')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      second.type('again')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(runTurnFn.mock.calls[0][0].conversation.messages.slice(1, 3)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ])
      expect(fetchMock.mock.calls[0][1].body).not.toContain('secret plan')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stores the reasoning of a stopped reply too', async () => {
    const turn = heldTurn()
    const writeConversation = vi.fn(async () => {})
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn, storage: { readConversation: async () => null, writeConversation }, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onReasoning('hmm')
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(writeConversation.mock.calls.at(-1)[1][1]).toEqual({ role: 'assistant', content: '', stopped: true, reasoning: [{ text: 'hmm', seconds: expect.any(Number) }] })
  })
})

describe('message kinds', () => {
  it('marks user, reply, tool and error rows apart', async () => {
    const { container, q, type } = openChat({
      requestTool: async (name) => {
        if (name === 'measure') throw new Error('no geometry')
        if (name === 'check') return { ok: false, error: { message: 'open edges' } }
        if (name === 'docs') return 'cuboid(options)'
        return { ok: true }
      },
      runTurnFn: async ({ requestTool, onText }) => {
        onText('Writing it')
        await requestTool('write', { path: 'main.js', content: 'x' })
        await requestTool('docs', { query: 'cuboid' })
        await requestTool('measure', {})
        await requestTool('check', {})
        throw new Error('provider down')
      },
    })
    type('a cube')
    await vi.waitFor(() => expect(q('.chat-msg.error')).not.toBeNull())
    expect(q('.chat-msg.user').textContent).toBe('a cube')
    expect(q('.chat-msg.assistant').textContent).toBe('Writing it')
    const rows = [...container.querySelectorAll('.chat-tool')]
    const summary = (row) => ['.chat-tool-name', '.chat-tool-target', '.chat-tool-mark'].map((s) => row.querySelector(`summary ${s}`)?.textContent ?? null)
    expect(rows.map(summary)).toEqual([
      ['write', 'main.js', 'ok'],
      ['docs', 'cuboid', 'ok'],
      ['measure', null, 'failed'],
      ['check', null, 'failed'],
    ])
    expect(rows.map((row) => row.classList.contains('failed'))).toEqual([false, false, true, true])
    expect(rows.every((row) => row.tagName === 'DETAILS' && !row.open)).toBe(true)
    expect(JSON.parse(rows[0].querySelector('.chat-tool-input').textContent)).toEqual({ path: 'main.js', content: 'x' })
    expect(rows[1].querySelector('.chat-tool-result').textContent).toBe('cuboid(options)')
    expect(q('.chat-msg.error').textContent).toBe('provider down')
  })

  it('shows a running tool as pending until it answers', async () => {
    let answer
    const { q, type } = openChat({
      requestTool: () => new Promise((resolve) => { answer = resolve }),
      runTurnFn: async ({ requestTool }) => {
        await requestTool('export', { format: 'stl' })
        return { messages: [] }
      },
    })
    type('export it')
    await vi.waitFor(() => expect(q('.chat-tool')).not.toBeNull())
    expect(q('.chat-tool-target').textContent).toBe('stl')
    expect(q('.chat-tool-mark').textContent).toBe('…')
    expect(q('.chat-tool').classList.contains('running')).toBe(true)
    answer({ ok: true })
    await vi.waitFor(() => expect(q('.chat-tool-mark').textContent).toBe('ok'))
    expect(q('.chat-tool').classList.contains('running')).toBe(false)
  })
})
describe('stored conversation', () => {
  it('loads a stored conversation and persists the turn', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const storage = {
      readConversation: async () => ({ messages: [{ role: 'user', content: 'old' }], updated: 1 }),
      writeConversation: vi.fn(async () => {}),
    }
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn: async ({ onText }) => { onText('hi'); return { messages: [] } },
      storage,
      projectId: 'p1',
    })
    await vi.waitFor(() => expect(container.querySelector('.chat-messages').textContent).toMatch(/old/))
    container.querySelector('.chat-input').value = 'hello'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({ role: 'assistant', content: 'hi' }))
    const persisted = storage.writeConversation.mock.calls.at(-1)[1]
    expect(persisted).toContainEqual({ role: 'user', content: 'hello' })
    expect(persisted).toContainEqual({ role: 'assistant', content: 'hi' })
  })
})
describe('opencode session', () => {
  it('keeps one x-opencode-session per project across messages', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    let project = 'p1'
    const runTurnFn = vi.fn(async ({ provider }) => {
      for await (const event of provider.send([], [])) void event
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'opencode-go', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      projectId: () => project,
    })
    const submit = async (text, turns) => {
      container.querySelector('.chat-input').value = text
      container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(turns))
      await vi.waitFor(() => expect(container.querySelector('.chat-send').textContent).toBe('Send'))
    }
    await submit('one', 1)
    await submit('two', 2)
    project = 'p2'
    await submit('three', 3)
    const session = (i) => fetchMock.mock.calls[i][1].headers['x-opencode-session']
    expect(session(0)).toEqual(expect.any(String))
    expect(session(1)).toBe(session(0))
    expect(session(2)).not.toBe(session(0))
    vi.unstubAllGlobals()
  })
})
describe('effort passthrough', () => {
  it('passes effort from selection into the provider body', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="chat"></div>'
    initChat({
      container: document.getElementById('chat'),
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test', effort: 'high' }),
      runTurnFn: async ({ provider }) => {
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
        return { messages: [] }
      },
    })
    document.querySelector('.chat-input').value = 'hi'
    document.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('high')
    vi.unstubAllGlobals()
  })
})
describe('relay base url', () => {
  it('builds per-kind relay paths under the default root', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    expect(relayBaseUrl('anthropic')).toBe('https://jscad.rkroll.com/api/relay/anthropic')
    expect(relayBaseUrl('openai')).toBe('https://jscad.rkroll.com/api/relay/openai')
  })

  it('uses the relay origin stamped in at build time', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    globalThis.__RELAY_ORIGIN__ = 'http://localhost:7377'
    try {
      expect(relayBaseUrl('meta')).toBe('http://localhost:7377/api/relay/meta')
    } finally {
      delete globalThis.__RELAY_ORIGIN__
    }
  })

  it('honors the localStorage root override', async () => {
    window.localStorage.setItem('jscad-ai.relay', 'http://127.0.0.1:9999')
    expect(relayBaseUrl('openai')).toBe('http://127.0.0.1:9999/api/relay/openai')
    window.localStorage.removeItem('jscad-ai.relay')
  })
})
describe('conversation context', () => {
  const submit = async (container, text, calls, runTurnFn) => {
    container.querySelector('.chat-input').value = text
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(calls))
    await vi.waitFor(() => expect(container.querySelector('.chat-send').textContent).toBe('Send'))
  }

  it('sends prior turns and the project files ahead of the new message', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText(`reply ${runTurnFn.mock.calls.length}`)
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      getProjectFiles: async () => ({ 'main.js': 'module.exports = {}' }),
    })
    await submit(container, 'first', 1, runTurnFn)
    await submit(container, 'second', 2, runTurnFn)
    const messages = runTurnFn.mock.calls[1][0].conversation.messages
    expect(messages[0].role).toBe('system')
    expect(messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply 1' },
    ])
    expect(messages[3].content).toContain('### main.js')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it("sends the project's last build report after its files", async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const report = { ok: false, entry: 'main.js', error: { message: 'boom', file: 'main.js', line: 2, column: 5 }, warnings: [], console: [], params: [] }
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      getProjectFiles: async () => ({ 'main.js': 'module.exports = {}' }),
      getBuild: async () => report,
    })
    await submit(container, 'fix it', 1, runTurnFn)
    const header = runTurnFn.mock.calls[0][0].conversation.messages.at(-2).content
    expect(header).toContain('### main.js')
    expect(header).toContain('Last build of the project')
    expect(header).toContain('"message":"boom"')
  })

  it('ends each turn once, after the loop, even when it fails', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const endTurn = vi.fn(async () => {})
    let fail = false
    const runTurnFn = vi.fn(async ({ requestTool }) => {
      await requestTool('write', { path: 'main.js', content: 'x' })
      expect(endTurn).not.toHaveBeenCalled()
      if (fail) throw new Error('provider down')
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => ({ ok: true }),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      endTurn,
    })
    await submit(container, 'one', 1, runTurnFn)
    expect(endTurn).toHaveBeenCalledTimes(1)
    fail = true
    await submit(container, 'two', 2, runTurnFn)
    expect(endTurn).toHaveBeenCalledTimes(2)
  })

  it('sends the chosen API prompt and passes the API to the loop, fluent by default', async () => {
    const run = async (getApi) => {
      document.body.innerHTML = '<div id="chat"></div>'
      const container = document.getElementById('chat')
      const runTurnFn = vi.fn(async () => ({ messages: [] }))
      initChat({
        container,
        requestTool: async () => '{}',
        getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
        runTurnFn,
        ...(getApi ? { getApi } : {}),
      })
      await submit(container, 'a cube', 1, runTurnFn)
      return runTurnFn.mock.calls[0][0]
    }
    const byDefault = await run()
    expect(byDefault.api).toBe('fluent')
    expect(byDefault.conversation.messages[0].content).toBe(buildSystemPrompt('fluent'))
    const modeling = await run(() => 'modeling')
    expect(modeling.api).toBe('modeling')
    expect(modeling.conversation.messages[0].content).toBe(buildSystemPrompt('modeling'))
  })

  it('sends x-jscad-chat-id through the relay but not to a custom base URL', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.removeItem('jscad-ai.relay')
    const run = async (selection) => {
      document.body.innerHTML = '<div id="chat"></div>'
      const container = document.getElementById('chat')
      const runTurnFn = vi.fn(async ({ provider }) => {
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
        return { messages: [] }
      })
      initChat({ container, requestTool: async () => '{}', getProvider: () => selection, runTurnFn, projectId: 'p1' })
      await submit(container, 'hi', 1, runTurnFn)
    }
    await run({ kind: 'openai', model: 'm', apiKey: 'k' })
    await run({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://direct.test' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://jscad.rkroll.com/api/relay/openai/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers['x-jscad-chat-id']).toEqual(expect.any(String))
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-jscad-chat-id')
    vi.unstubAllGlobals()
  })
})
