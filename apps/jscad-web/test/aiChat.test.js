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
      await vi.waitFor(() => expect(container.querySelector('.chat-input').disabled).toBe(false))
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
    await vi.waitFor(() => expect(container.querySelector('.chat-input').disabled).toBe(false))
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
