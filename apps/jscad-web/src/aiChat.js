// The chat panel drives the browser-local agent loop: it builds the provider
// from the account panel, runs runTurn directly, executes each tool request
// through requestTool, and renders streamed text. Provider HTTP targets the
// relay, which proxies path-preserving to the provider and stores nothing.
import { buildMessages, buildSystemPrompt, createProvider, DEFAULT_API, partitionTranscript, runTurn as defaultRunTurn, SUMMARY_PREFIX, summarizeTranscript, summarizeWithProvider, toolDetail, turnsOf } from '@jscadui/agent-loop'
import { checkTurn, DEMO_NOTICE_MESSAGE, getRecordOwnChats, isDemoSelection, openConsentGate, TOS_REQUIRED_MESSAGE } from './aiConsent.js'

/* global __RELAY_ORIGIN__ */
const RELAY_OVERRIDE_KEY = 'jscad-ai.relay'

// build.js stamps __RELAY_ORIGIN__; unit tests run unbundled without it.
const relayDefault = () => (typeof __RELAY_ORIGIN__ === 'string' ? __RELAY_ORIGIN__ : 'https://jscad.rkroll.com')

const relayRoot = () => (globalThis.localStorage?.getItem(RELAY_OVERRIDE_KEY) || relayDefault()).replace(/\/+$/, '')

// A demo (shared) selection rides `/api/relay/shared/<id>`, where the relay
// injects the server-held key; own keys ride their kind's route.
export const relayBaseUrl = (kind, shared) =>
  shared ? `${relayRoot()}/api/relay/shared/${shared}` : `${relayRoot()}/api/relay/${kind}`

// The demo option list lives on the relay beside the per-id routes.
export const sharedListUrl = () => `${relayRoot()}/api/relay/shared`

// One line above the input while our recording is on, and the always-saved
// variant while a demo selection is active (demo cannot be opted out).
export const CHAT_LOG_NOTICE = 'Chats are saved to improve the assistant. Turn this off in Chat settings.'
export const CHAT_DEMO_NOTICE = 'Chats on shared keys are always saved to improve the assistant.'
// The relay's 402 when a demo budget is spent; the turn never reached a model.
export const SHARED_QUOTA_MESSAGE = 'This demo is out of budget right now. Add your own key in Chat settings to keep chatting.'

const sharedQuotaError = (err) =>
  err?.status === 402 && /shared_quota_exhausted/.test(`${err?.message ?? ''} ${err?.body ?? ''}`)

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const STOPPED_NOTE = '[stopped by the user]'

// The selection stores 'off'; callers may also pass false. Both remove the tool.
const websearchOff = (provider) => provider === false || provider === 'off'

// Blanket web-search permission: granted once per conversation, not per call.
// Ungranted websearch or webfetch short-circuits to a grant request instead of
// reaching the network (never auto-searches); every granted call is logged so
// spend is auditable.
export const WEBSEARCH_GRANT_REQUEST =
  'websearch needs the user\'s permission once per conversation, which is not granted yet. ' +
  'Ask the user with question whether to allow web search for this conversation ' +
  '(or tell them they can allow it in Chat settings), and only call websearch again after they agree.'

// Fetching a page is the same blanket network permission, so it shares the gate.
export const WEBFETCH_GRANT_REQUEST =
  'webfetch needs the user\'s permission once per conversation, which is not granted yet. ' +
  'Ask the user with question whether to allow fetching web pages for this conversation ' +
  '(or tell them they can allow it in Chat settings), and only call webfetch again after they agree.'

export const createWebsearchGrant = ({ granted = false, log = () => {} } = {}) => {
  let on = granted
  return {
    isGranted: () => on,
    setGranted: (next) => {
      on = next === true
    },
    beforeToolCall: async (name) => {
      if (!on && (name === 'websearch' || name === 'webfetch')) {
        return { decision: 'deny', reason: name === 'webfetch' ? WEBFETCH_GRANT_REQUEST : WEBSEARCH_GRANT_REQUEST }
      }
      return undefined
    },
    afterToolCall: async (name, input, result) => {
      if (!on || (name !== 'websearch' && name !== 'webfetch')) return undefined
      let parsed = result
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {
          return undefined
        }
      }
      if (!parsed || typeof parsed !== 'object') return undefined
      // Audit logging must never corrupt a good result.
      try {
        if (name === 'webfetch') {
          if (parsed.ok === true) {
            log({ url: input?.url, bytes: typeof parsed.content === 'string' ? parsed.content.length : 0 })
          }
          return undefined
        }
        if (!Array.isArray(parsed.results)) return undefined
        const providers = [...new Set(parsed.results.map((hit) => hit?.provider).filter(Boolean))]
        log({ query: input?.query, provider: providers.join('+') || 'unknown', count: parsed.results.length })
      } catch {
        // The transcript already carries the tagged results.
      }
      return undefined
    },
  }
}

// A stopped reply may be empty, and providers refuse an empty assistant message.
// Stored reasoning stays on the page: the model never gets it back. A reply's
// mentions come through, since `buildMessages` reads their paths for recency.
const forModel = (m) => {
  const base = { role: m.role, content: m.content }
  if (m.stopped) base.content = m.content ? `${m.content}\n\n${STOPPED_NOTE}` : STOPPED_NOTE
  if (m.role === 'assistant' && m.mentions?.length > 0) base.mentions = m.mentions
  return base
}

// A summary rides at the front of the transcript as a system message; `basis`
// counts the leading model-coordinate messages already folded into it.
const isSummaryMsg = (m) => m?.role === 'system' && typeof m?.basis === 'number'
const stripSummary = (msgs) => msgs.filter((m) => !isSummaryMsg(m))

const thinkingLabel = (seconds) => `Thinking… ${seconds}s`
const thoughtLabel = (seconds) => `Thought for ${seconds}s`

// A tool answers failure as {ok:false}, as an object or as its JSON text.
const toolFailed = (result) => {
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    } catch {
      return false
    }
  }
  return result !== null && typeof result === 'object' && result.ok === false
}

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
 * it; `startTurn` runs before a turn reads the project for its context, and
 * `endTurn` once after every turn, when its writes are final.
 * `getSummarizer` picks the model that summarizes evicted turns; it defaults
 * to `getProvider`, so wiring a cheaper model is a selection swap, not a
 * change here.
 * @param {{container:HTMLElement,requestTool:Function,getProvider:Function,getSummarizer?:Function,getApi?:()=>'fluent'|'modeling',runTurnFn?:Function,beforeToolCall?:Function,afterToolCall?:Function,storage?:{readConversation:Function,writeConversation:Function},projectId?:string|(()=>string),getProjectFiles?:()=>Promise<Record<string,string|ArrayBuffer>>,getBuild?:()=>Promise<object|null>,startTurn?:()=>void,endTurn?:()=>Promise<void>}} options
 */
export const initChat = ({ container, requestTool, getProvider, getSummarizer = getProvider, getApi = () => DEFAULT_API, runTurnFn = defaultRunTurn, beforeToolCall, afterToolCall, websearchGranted = false, websearchLog = () => {}, websearchProvider, storage, projectId, getProjectFiles = async () => ({}), getBuild = async () => null, startTurn = () => {}, endTurn = async () => {} }) => {
  const header = el('div', 'chat-header')
  header.append(el('span', 'chat-title', 'AI Chat'))
  const newChatBtn = el('button', 'chat-new', 'New chat')
  newChatBtn.type = 'button'
  newChatBtn.title = 'Start a new conversation'
  header.append(newChatBtn)
  const messagesEl = el('div', 'chat-messages')
  const form = el('form', 'chat-form')
  const input = el('textarea', 'chat-input')
  input.rows = 2
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
  // The recording notice sits directly above the input; the settings word is
  // the link into the gear dialog, which owns the logging toggle.
  const notice = el('div', 'chat-notice')
  const noticeText = el('span', 'chat-notice-text')
  const noticeSettings = el('button', 'chat-notice-settings', 'Chat settings')
  const noticeTail = el('span', 'chat-notice-tail', '.')
  noticeSettings.type = 'button'
  noticeSettings.addEventListener('click', () => document.querySelector('.ai-gear')?.click())
  notice.append(noticeText, noticeSettings, noticeTail)
  container.append(header, messagesEl, notice, statusEl, form)

  let running = false
  // A Send that is waiting on the consent gate; another Send in the meantime
  // must not queue a second turn.
  let gating = false
  let aborter = null
  let status = null
  let startedAt = 0
  let ticker = null
  let assistantEl = null
  // The step's open reasoning block, and the steps this turn has finished.
  let reasoning = null
  let turnReasoning = []
  let turnMentions = []
  let transcript = []
  const pid = () => (typeof projectId === 'function' ? projectId() : projectId)
  // Blanket web-search grant for this chat panel: the gear dialog toggles the
  // global default for new conversations, setWebsearchGranted flips this one.
  // Revoking clears the grant, never the stored keys.
  const websearchGrant = createWebsearchGrant({ granted: websearchGranted, log: websearchLog })
  const gatedBeforeToolCall = async (name, input) =>
    (await websearchGrant.beforeToolCall(name, input)) ?? (await beforeToolCall?.(name, input))
  const gatedAfterToolCall = async (name, input, result) => {
    await websearchGrant.afterToolCall(name, input, result)
    return afterToolCall?.(name, input, result)
  }
  // The running turn's project; set at turn start so module-scope helpers
  // (handleTool) can skip DOM writes once another project is open.
  let turnProject = null
  const live = () => turnProject === pid()
  // opencode groups a conversation's requests by this id, so it must outlive one message.
  const sessions = new Map()
  const sessionId = () => {
    const key = pid() ?? ''
    if (!sessions.has(key)) sessions.set(key, crypto.randomUUID())
    return sessions.get(key)
  }

  // The drawer notice above the input: it reflects the live selection (which
  // `getProvider` reads) and the recording consent, and is re-rendered whenever
  // the gear dialog changes either. Demo is always saved.
  const renderNotice = () => {
    const sel = getProvider()
    // A custom base URL calls the provider directly and is never logged, so the
    // recording line would be wrong there; demo always records regardless.
    const demo = isDemoSelection(sel)
    const show = demo || (getRecordOwnChats() && !sel?.baseUrl)
    notice.style.display = show ? '' : 'none'
    if (!show) return
    if (demo) {
      noticeText.textContent = CHAT_DEMO_NOTICE
      noticeSettings.textContent = ''
      noticeSettings.style.display = 'none'
      noticeTail.textContent = ''
    } else {
      noticeText.textContent = CHAT_LOG_NOTICE.split('Chat settings')[0]
      noticeSettings.textContent = 'Chat settings'
      noticeSettings.style.display = ''
      noticeTail.textContent = '.'
    }
  }

  const persistTranscript = async (id = pid(), messages = transcript) => {
    if (!storage || !id) return
    try {
      await storage.writeConversation(id, messages)
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

  // Streaming must not yank a reader who scrolled up to an earlier reply, so
  // new rows and chunks follow the end only while the reader is already there.
  const NEAR_BOTTOM_PX = 40
  const atBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= NEAR_BOTTOM_PX
  const follow = (stick) => { if (stick) messagesEl.scrollTop = messagesEl.scrollHeight }

  const addMessage = (text, kind) => {
    const stick = atBottom()
    const node = el('div', `chat-msg ${kind}`, text)
    messagesEl.append(node)
    follow(stick)
    return node
  }

  const addStopped = () => addMessage('Stopped', 'stopped')

  const addReasoningBlock = (label, text) => {
    const stick = atBottom()
    const details = el('details', 'chat-reasoning')
    const summary = el('summary', 'chat-reasoning-summary', label)
    const textEl = el('div', 'chat-reasoning-text', text)
    details.append(summary, textEl)
    messagesEl.append(details)
    follow(stick)
    return { summary, textEl }
  }

  const renderLoaded = (messages) => {
    transcript = messages.filter((m) => m.role === 'user' || m.role === 'assistant' || isSummaryMsg(m))
    messagesEl.innerHTML = ''
    assistantEl = null
    turnReasoning = []
    for (const m of transcript) {
      for (const step of m.reasoning ?? []) addReasoningBlock(thoughtLabel(step.seconds), step.text)
      if (m.role === 'user') addMessage(m.content, 'user')
      else if (m.role === 'assistant' && m.content) addMessage(m.content, 'assistant')
      if (m.stopped) addStopped()
    }
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  // The open project changed: show its conversation, not the previous
  // project's. An in-flight turn keeps its own messages and persists them
  // under the project it started in.
  const switchTo = async (id) => {
    transcript = []
    messagesEl.innerHTML = ''
    assistantEl = null
    turnReasoning = []
    if (!storage || !id) return
    try {
      const resumed = await storage.readConversation(id)
      if (!resumed || pid() !== id) return
      renderLoaded(resumed.messages)
    } catch (err) {
      console.warn('chat resume failed:', err)
    }
  }

  const newChat = async () => {
    if (running) return
    transcript = []
    messagesEl.innerHTML = ''
    assistantEl = null
    turnReasoning = []
    const id = pid()
    if (id) sessions.delete(id)
    if (storage && id) {
      try {
        await storage.writeConversation(id, [])
      } catch (err) {
        console.warn('chat persist failed:', err)
      }
    }
  }
  newChatBtn.addEventListener('click', newChat)

  const reasoningSeconds = () => Math.floor((Date.now() - reasoning.startedAt) / 1000)

  const addReasoning = (text) => {
    const stick = atBottom()
    if (!reasoning) {
      reasoning = { ...addReasoningBlock(thinkingLabel(0), ''), startedAt: Date.now(), text: '' }
      assistantEl = null
    }
    reasoning.text += text
    reasoning.textEl.textContent += text
    follow(stick)
  }

  const renderReasoning = () => {
    if (reasoning) reasoning.summary.textContent = thinkingLabel(reasoningSeconds())
  }

  // A step's reasoning ends when its text or tool call starts, or the turn ends.
  const endReasoning = () => {
    if (!reasoning) return
    const seconds = Math.max(1, reasoningSeconds())
    reasoning.summary.textContent = thoughtLabel(seconds)
    turnReasoning.push({ text: reasoning.text, seconds })
    reasoning = null
  }

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

  // A bare `thinking` is a new provider request, so a new model step.
  const setStatus = (next) => {
    if (next?.phase !== 'thinking' || next.reasoningChars === undefined) endReasoning()
    status = next?.phase === 'done' ? null : next
    renderStatus()
  }

  const tick = () => {
    renderStatus()
    renderReasoning()
  }

  const addToolLine = (name, inputJson) => {
    const stick = atBottom()
    const details = el('details', 'chat-tool running')
    const summary = el('summary', 'chat-tool-summary')
    summary.append(el('span', 'chat-tool-name', name))
    const target = toolDetail(inputJson)
    if (target !== undefined) summary.append(el('span', 'chat-tool-target', target))
    const mark = el('span', 'chat-tool-mark', '…')
    summary.append(mark)
    details.append(summary)
    details.append(el('pre', 'chat-tool-input', JSON.stringify(inputJson, null, 2)))
    const resultEl = el('pre', 'chat-tool-result', 'running...')
    details.append(resultEl)
    messagesEl.append(details)
    follow(stick)
    return (result, failed) => {
      resultEl.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      mark.textContent = failed ? 'failed' : 'ok'
      details.classList.remove('running')
      details.classList.toggle('failed', failed)
    }
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
      ticker = setInterval(tick, 1000)
      setStatus({ phase: 'thinking' })
    } else {
      setStatus(null)
    }
  }
  setRunning(false)

  // The abort can end the turn, and turn this back into a submit button, before
  // the click's default action runs, which would then send the draft in the input.
  send.addEventListener('click', (event) => {
    if (!running) return
    event.preventDefault()
    aborter?.abort()
  })

  // Renders the tool line, then hands the result back to the loop as JSON.
  // Never throws: a rejection becomes an {ok:false} result so the turn
  // always has content to feed back.
  const handleTool = async (name, input) => {
    if (typeof input?.path === 'string') turnMentions.push(input.path)
    if (live()) { endReasoning(); assistantEl = null }
    const finish = live() ? addToolLine(name, input) : () => {}
    try {
      const result = await requestTool(name, input)
      finish(result, toolFailed(result))
      return typeof result === 'string' ? result : JSON.stringify(result ?? null)
    } catch (err) {
      const errorResult = { ok: false, error: { name: err.name, message: err.message } }
      finish(errorResult, true)
      return JSON.stringify(errorResult)
    }
  }

  const runTurnLocal = async (message) => {
    const selection = getProvider()
    if (!selection) {
      addMessage('Set your model and API key in Chat settings first.', 'error')
      return
    }
    // Every turn is gated on the accepted terms version and, for demo, on the
    // always-recorded notice. Declining blocks this turn with the usual error
    // line and keeps the draft and the history readable.
    const gate = checkTurn(selection)
    if (!gate.ok) {
      if (gating) return
      gating = true
      let allowed = false
      try {
        allowed = await openConsentGate(selection)
      } finally {
        gating = false
      }
      if (!allowed) {
        addMessage(gate.reason === 'demo-notice' ? DEMO_NOTICE_MESSAGE : TOS_REQUIRED_MESSAGE, 'error')
        return
      }
    }
    input.value = ''
    turnProject = pid()
    renderNotice()
    let local = [...transcript, { role: 'user', content: message }]
    const persist = (messages) => {
      if (!storage || !turnProject) return
      persistTranscript(turnProject, messages)
    }
    // Every phase persists under the project the turn started in; only the
    // visible transcript and the DOM follow the live project.
    const commit = (messages) => {
      local = messages
      persist(messages)
      if (live()) transcript = messages
    }
    commit(local)
    setRunning(true)
    if (live()) addMessage(message, 'user')
    assistantEl = null
    aborter = new AbortController()
    const { signal } = aborter
    let assistantText = ''
    let stopped = false
    turnReasoning = []
    turnMentions = []
    const reply = (fields) => ({ role: 'assistant', content: assistantText, ...fields, ...(turnMentions.length > 0 ? { mentions: [...turnMentions] } : {}), ...(turnReasoning.length > 0 ? { reasoning: turnReasoning } : {}) })
    try {
      const provider = createProvider({
        ...selection,
        baseUrl: selection.baseUrl || relayBaseUrl(selection.kind, selection.shared),
        sessionId: sessionId(),
        // A custom base URL may be a provider called directly, whose CORS preflight would refuse this header.
        // An own-key opt-out must omit it, or the relay would log a turn the user refused.
        ...(selection.baseUrl || !getRecordOwnChats() ? {} : { chatId: sessionId() }),
      })
      startTurn()
      const files = await projectFiles()
      const build = await lastBuild()
      const api = getApi()
      const model = stripSummary(local.slice(0, -1).map(forModel))
      const { evicted } = partitionTranscript(model)
      const prior = local.find(isSummaryMsg)
      const freshTurns = turnsOf(evicted.slice(prior?.basis ?? 0))
      if (freshTurns.length > 0) {
        try {
          const summarizerSelection = getSummarizer()
          const summarizer = createProvider({
            ...summarizerSelection,
            baseUrl: summarizerSelection.baseUrl || relayBaseUrl(summarizerSelection.kind, summarizerSelection.shared),
          })
          const text = await summarizeTranscript(
            { turns: freshTurns, priorSummary: prior?.text ?? '' },
            summarizeWithProvider(summarizer),
          )
          if (text) {
            const summary = { role: 'system', content: `${SUMMARY_PREFIX}${text}`, text, basis: evicted.length }
            commit([summary, ...stripSummary(local)])
          }
        } catch (err) {
          console.warn('chat summarize failed:', err)
        }
      }
      await runTurnFn({
        conversation: { messages: buildMessages({ systemPrompt: buildSystemPrompt(api), transcript: local.slice(0, -1).map(forModel), files, build, message, summary: local.find(isSummaryMsg)?.text }) },
        provider,
        api,
        requestTool: handleTool,
        beforeToolCall: gatedBeforeToolCall,
        afterToolCall: gatedAfterToolCall,
        toolFilter:
          typeof websearchProvider === 'function'
            ? (name) => (websearchOff(websearchProvider()) ? name !== 'websearch' : true)
            : websearchOff(websearchProvider)
              ? (name) => name !== 'websearch'
              : undefined,
        onText: (text) => {
          assistantText += text
          if (!live()) return
          const stick = atBottom()
          if (!assistantEl) assistantEl = addMessage('', 'assistant')
          assistantEl.textContent += text
          follow(stick)
        },
        onReasoning: (text) => { if (live()) addReasoning(text) },
        onStatus: (next) => { if (live()) setStatus(next) },
        signal,
      })
      endReasoning()
      if (assistantText) commit([...local, reply()])
    } catch (err) {
      endReasoning()
      if (signal.aborted) stopped = true
      else {
        commit(local.slice(0, -1))
        if (live()) addMessage(sharedQuotaError(err) ? SHARED_QUOTA_MESSAGE : err.message, 'error')
      }
    } finally {
      if (stopped) {
        if (live()) addStopped()
        commit([...local, reply({ stopped: true })])
      }
      await finishTurn()
      assistantEl = null
      turnProject = null
      aborter = null
      setRunning(false)
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const message = input.value.trim()
    if (!message || running) return
    runTurnLocal(message)
  })

  // A textarea does not submit on Enter; Shift+Enter keeps a newline.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  })

  if (storage && pid()) switchTo(pid())
  renderNotice()

  return { switchTo, newChat, refreshNotice: renderNotice, setWebsearchGranted: websearchGrant.setGranted, isWebsearchGranted: websearchGrant.isGranted }
}
