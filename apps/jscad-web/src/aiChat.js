// The chat panel drives the browser-local agent loop: it builds the provider
// from the account panel, runs runTurn directly, executes each tool request
// through requestTool, and renders streamed text. Provider HTTP targets the
// relay, which proxies path-preserving to the provider and stores nothing.
import { buildMessages, buildSystemPrompt, createProvider, DEFAULT_API, runTurn as defaultRunTurn } from '@jscadui/agent-loop'

/* global __RELAY_ORIGIN__ */
const RELAY_OVERRIDE_KEY = 'jscad-ai.relay'

// build.js stamps __RELAY_ORIGIN__; unit tests run unbundled without it.
const relayDefault = () => (typeof __RELAY_ORIGIN__ === 'string' ? __RELAY_ORIGIN__ : 'https://jscad.rkroll.com')

export const relayBaseUrl = (kind) => {
  const root = globalThis.localStorage?.getItem(RELAY_OVERRIDE_KEY) || relayDefault()
  return `${root.replace(/\/+$/, '')}/api/relay/${kind}`
}

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const STOPPED_NOTE = '[stopped by the user]'

// A stopped reply may be empty, and providers refuse an empty assistant message.
const forModel = (m) => (m.stopped ? { role: 'assistant', content: m.content ? `${m.content}\n\n${STOPPED_NOTE}` : STOPPED_NOTE } : m)

const phaseLabel = (status) => {
  switch (status.phase) {
    case 'text':
      return 'Writing…'
    case 'tool':
      return `${status.tool}${status.detail ? ` ${status.detail}` : ''}…`
    case 'retry':
      return `Provider busy, retrying (${status.attempt}/${status.maxAttempts})…`
    default:
      return 'Thinking…'
  }
}

// Providers stream reasoning text, not its token count; about four characters make a token.
const CHARS_PER_TOKEN = 4

/**
 * `getBuild` answers the open project's last build report, whichever run made
 * it; `endTurn` runs once after every turn, when its writes are final.
 * @param {{container:HTMLElement,requestTool:Function,getProvider:Function,getApi?:()=>'fluent'|'modeling',runTurnFn?:Function,storage?:{readConversation:Function,writeConversation:Function},projectId?:string|(()=>string),getProjectFiles?:()=>Promise<Record<string,string|ArrayBuffer>>,getBuild?:()=>Promise<object|null>,endTurn?:()=>Promise<void>}} options
 */
export const initChat = ({ container, requestTool, getProvider, getApi = () => DEFAULT_API, runTurnFn = defaultRunTurn, storage, projectId, getProjectFiles = async () => ({}), getBuild = async () => null, endTurn = async () => {} }) => {
  const header = el('div', 'chat-header', 'AI Chat')
  const messagesEl = el('div', 'chat-messages')
  const form = el('form', 'chat-form')
  const input = el('input', 'chat-input')
  input.type = 'text'
  input.placeholder = 'Describe the part to build'
  input.autocomplete = 'off'
  const send = el('button', 'chat-send', 'Send')
  form.append(input, send)
  // Only the phase is live: screen readers hear each change, not each second.
  const statusEl = el('div', 'chat-status')
  const statusPhase = el('span', 'chat-status-phase')
  statusPhase.setAttribute('aria-live', 'polite')
  const statusTime = el('span', 'chat-status-time')
  statusTime.setAttribute('aria-hidden', 'true')
  statusEl.append(statusPhase, statusTime)
  container.append(header, messagesEl, statusEl, form)

  let running = false
  let aborter = null
  let status = null
  let startedAt = 0
  let ticker = null
  let assistantEl = null
  let transcript = []
  const pid = () => (typeof projectId === 'function' ? projectId() : projectId)
  // opencode groups a conversation's requests by this id, so it must outlive one message.
  const sessions = new Map()
  const sessionId = () => {
    const key = pid() ?? ''
    if (!sessions.has(key)) sessions.set(key, crypto.randomUUID())
    return sessions.get(key)
  }

  const persistTranscript = async () => {
    if (!storage || !pid()) return
    try {
      await storage.writeConversation(pid(), transcript)
    } catch (err) {
      console.warn('chat persist failed:', err)
    }
  }

  const projectFiles = async () => {
    try {
      return (await getProjectFiles()) ?? {}
    } catch (err) {
      console.warn('chat: project files unavailable:', err)
      return {}
    }
  }

  const lastBuild = async () => {
    try {
      return (await getBuild()) ?? null
    } catch (err) {
      console.warn('chat: last build unavailable:', err)
      return null
    }
  }

  const finishTurn = async () => {
    try {
      await endTurn()
    } catch (err) {
      console.warn('chat: saving the turn failed:', err)
    }
  }

  if (storage && pid()) {
    storage.readConversation(pid()).then((resumed) => {
      if (!resumed) return
      transcript = resumed.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      for (const m of transcript) {
        if (m.role === 'user') addMessage(m.content, 'user')
        else if (m.content) addMessage(m.content, 'assistant')
        if (m.stopped) addStopped()
      }
    }).catch((err) => console.warn('chat resume failed:', err))
  }

  const addMessage = (text, kind) => {
    const node = el('div', `chat-msg ${kind}`, text)
    messagesEl.append(node)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return node
  }

  const addStopped = () => addMessage('Stopped', 'stopped')

  const renderStatus = () => {
    if (!status) {
      statusEl.classList.remove('active')
      statusPhase.textContent = ''
      statusTime.textContent = ''
      return
    }
    const label = phaseLabel(status)
    if (statusPhase.textContent !== label) statusPhase.textContent = label
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    const tokens = status.phase === 'thinking' && status.reasoningChars ? `~${Math.round(status.reasoningChars / CHARS_PER_TOKEN)} tokens · ` : ''
    statusTime.textContent = `${tokens}${seconds}s`
    statusEl.classList.add('active')
  }

  const setStatus = (next) => {
    status = next?.phase === 'done' ? null : next
    renderStatus()
  }

  const addToolLine = (name, inputJson) => {
    const details = el('details', 'chat-tool')
    details.append(el('summary', 'chat-tool-name', name))
    details.append(el('pre', 'chat-tool-input', JSON.stringify(inputJson, null, 2)))
    const resultEl = el('pre', 'chat-tool-result', 'running...')
    details.append(resultEl)
    messagesEl.append(details)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return resultEl
  }

  // A running turn's button stops it. As type=button it is no default button,
  // so Enter in the input submits the form, which a running turn ignores.
  const setRunning = (value) => {
    running = value
    send.type = value ? 'button' : 'submit'
    send.textContent = value ? 'Stop' : 'Send'
    send.setAttribute('aria-label', value ? 'Stop the reply' : 'Send the message')
    send.classList.toggle('running', value)
    clearInterval(ticker)
    if (value) {
      startedAt = Date.now()
      ticker = setInterval(renderStatus, 1000)
      setStatus({ phase: 'thinking' })
    } else {
      setStatus(null)
    }
  }
  setRunning(false)

  send.addEventListener('click', () => {
    if (running) aborter?.abort()
  })

  // Renders the tool line, then hands the result back to the loop as JSON.
  // Never throws: a rejection becomes an {ok:false} result so the turn
  // always has content to feed back.
  const handleTool = async (name, input) => {
    assistantEl = null
    const resultEl = addToolLine(name, input)
    try {
      const result = await requestTool(name, input)
      resultEl.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return typeof result === 'string' ? result : JSON.stringify(result ?? null)
    } catch (err) {
      const errorResult = { ok: false, error: { name: err.name, message: err.message } }
      resultEl.textContent = JSON.stringify(errorResult, null, 2)
      return JSON.stringify(errorResult)
    }
  }

  const runTurnLocal = async (message) => {
    const selection = getProvider()
    if (!selection) {
      addMessage('Set your model and API key in AI settings first.', 'error')
      return
    }
    setRunning(true)
    addMessage(message, 'user')
    const prior = transcript
    transcript = [...transcript, { role: 'user', content: message }]
    persistTranscript()
    assistantEl = null
    aborter = new AbortController()
    const { signal } = aborter
    let assistantText = ''
    let stopped = false
    try {
      const provider = createProvider({
        ...selection,
        baseUrl: selection.baseUrl || relayBaseUrl(selection.kind),
        sessionId: sessionId(),
        // A custom base URL may be a provider called directly, whose CORS preflight would refuse this header.
        ...(selection.baseUrl ? {} : { chatId: sessionId() }),
      })
      const files = await projectFiles()
      const build = await lastBuild()
      const api = getApi()
      await runTurnFn({
        conversation: { messages: buildMessages({ systemPrompt: buildSystemPrompt(api), transcript: prior.map(forModel), files, build, message }) },
        provider,
        api,
        requestTool: handleTool,
        onText: (text) => {
          assistantText += text
          if (!assistantEl) assistantEl = addMessage('', 'assistant')
          assistantEl.textContent += text
          messagesEl.scrollTop = messagesEl.scrollHeight
        },
        onStatus: setStatus,
        signal,
      })
      if (assistantText) {
        transcript = [...transcript, { role: 'assistant', content: assistantText }]
        persistTranscript()
      }
    } catch (err) {
      if (signal.aborted) stopped = true
      else addMessage(err.message, 'error')
    } finally {
      if (stopped) {
        addStopped()
        transcript = [...transcript, { role: 'assistant', content: assistantText, stopped: true }]
        persistTranscript()
      }
      await finishTurn()
      assistantEl = null
      aborter = null
      setRunning(false)
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const message = input.value.trim()
    if (!message || running) return
    input.value = ''
    runTurnLocal(message)
  })
}