// The chat panel drives the browser-local agent loop: it builds the provider
// from the account panel, runs runTurn directly, executes each tool request
// through requestTool, and renders streamed text. Provider HTTP targets the
// relay, which proxies path-preserving to the provider and stores nothing.
import { buildMessages, createProvider, runTurn as defaultRunTurn, SYSTEM_PROMPT } from '@jscadui/agent-loop'

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

/**
 * @param {{container:HTMLElement,requestTool:Function,getProvider:Function,runTurnFn?:Function,storage?:{readConversation:Function,writeConversation:Function},projectId?:string|(()=>string),getProjectFiles?:()=>Promise<Record<string,string|ArrayBuffer>>}} options
 */
export const initChat = ({ container, requestTool, getProvider, runTurnFn = defaultRunTurn, storage, projectId, getProjectFiles = async () => ({}) }) => {
  const header = el('div', 'chat-header', 'AI Chat')
  const messagesEl = el('div', 'chat-messages')
  const form = el('form', 'chat-form')
  const input = el('input', 'chat-input')
  input.type = 'text'
  input.placeholder = 'Describe the part to build'
  input.autocomplete = 'off'
  const send = el('button', 'chat-send', 'Send')
  form.append(input, send)
  container.append(header, messagesEl, form)

  let running = false
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

  if (storage && pid()) {
    storage.readConversation(pid()).then((resumed) => {
      if (!resumed) return
      transcript = resumed.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      for (const m of transcript) addMessage(m.content, m.role === 'user' ? 'user' : 'assistant')
    }).catch((err) => console.warn('chat resume failed:', err))
  }

  const addMessage = (text, kind) => {
    const node = el('div', `chat-msg ${kind}`, text)
    messagesEl.append(node)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return node
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

  const setRunning = (value) => {
    running = value
    input.disabled = value
    send.disabled = value
  }

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
    const aborter = new AbortController()
    try {
      const provider = createProvider({
        ...selection,
        baseUrl: selection.baseUrl || relayBaseUrl(selection.kind),
        sessionId: sessionId(),
        // A custom base URL may be a provider called directly, whose CORS preflight would refuse this header.
        ...(selection.baseUrl ? {} : { chatId: sessionId() }),
      })
      const files = await projectFiles()
      let assistantText = ''
      await runTurnFn({
        conversation: { messages: buildMessages({ systemPrompt: SYSTEM_PROMPT, transcript: prior, files, message }) },
        provider,
        requestTool: handleTool,
        onText: (text) => {
          assistantText += text
          if (!assistantEl) assistantEl = addMessage('', 'assistant')
          assistantEl.textContent += text
          messagesEl.scrollTop = messagesEl.scrollHeight
        },
        signal: aborter.signal,
      })
      if (assistantText) {
        transcript = [...transcript, { role: 'assistant', content: assistantText }]
        persistTranscript()
      }
    } catch (err) {
      addMessage(err.message, 'error')
    } finally {
      assistantEl = null
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