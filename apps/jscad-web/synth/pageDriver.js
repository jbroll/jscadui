// Drives one chat session in the real app page for synth/session.js
// (`runSession`): send, wait out a turn while answering its questions, stop,
// and call the chat's own tool handlers through the harness hook.
import { dismissWelcome, seedTos, waitForRender } from '../e2e/helpers.js'
import { offBuilderModel } from './relayGuard.js'

const LOAD_TIMEOUT_MS = 60_000
const SEND_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 30_000
const POLL_MS = 250

const isTimeout = (e) => e?.name === 'TimeoutError'

// Runs in the page: an open question card, a finished turn with the error rows
// it added (a failed builder request), or neither.
const turnState = () => {
  const card = [...document.querySelectorAll('.chat-question:not(.answered)')].at(-1)
  if (card) {
    const text = card.querySelector('.chat-question-text')?.textContent ?? ''
    const options = [...card.querySelectorAll('.chat-question-option')].map((b) => b.textContent)
    return { question: options.length > 0 ? `${text}\nOptions: ${options.join(' / ')}` : text }
  }
  const send = document.querySelector('.chat-send')
  if (!send || send.classList.contains('running')) return false
  const rows = [...document.querySelectorAll('.chat-messages .chat-msg')]
  const start = rows.findLastIndex((r) => r.classList.contains('user'))
  const errors = rows.slice(start + 1).filter((r) => r.classList.contains('error')).map((r) => r.textContent)
  return { done: true, error: errors.join('\n') || null }
}

// Runs in the page. While a question is open a non-empty Send answers it; done
// in one step so a turn that ended meanwhile never gets the answer as a new message.
const answerOpenQuestion = (answer) => {
  if (!document.querySelector('.chat-question:not(.answered)')) return false
  document.querySelector('.chat-input').value = answer
  document.querySelector('.chat-send').click()
  return true
}

// Runs in the page: the turn's own reply, not an earlier turn's.
const turnReply = () => {
  const rows = [...document.querySelectorAll('.chat-messages .chat-msg')]
  const start = rows.findLastIndex((r) => r.classList.contains('user'))
  return rows.slice(start + 1).findLast((r) => r.classList.contains('assistant'))?.textContent ?? ''
}

export async function openSession(browser, { url, key, model, vision }) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const seed = {
    'jscad-ai.tos': seedTos(),
    'jscad-studio.key': JSON.stringify({ mode: 'device', key }),
    'jscad-ai.selection': JSON.stringify({ kind: 'opencode-go', model, baseUrl: '', api: 'fluent', keyMode: 'device' }),
    'jscad-harness': '1',
    ...(vision ? { 'jscad-ai.vision-overrides': JSON.stringify({ [model]: true }) } : {}),
  }
  await page.addInitScript((entries) => {
    // The compute frame is a sandboxed cross-origin child with no storage.
    if (window !== window.top) return
    for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v)
  }, seed)

  const chatIds = new Set()
  let rounds = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.startsWith('/api/relay/')) return
    const id = request.headers()['x-jscad-chat-id']
    if (!id) return
    chatIds.add(id)
    rounds++
  })

  // Second zero-spend guard after assertFree: no builder request may name
  // another model, whatever the app's selection turns out to be.
  let offModel = null
  try {
    await page.route('**/api/relay/**', (route) => {
      const request = route.request()
      const used = request.method() === 'POST' ? offBuilderModel(request.postData(), model) : null
      if (used === null) return route.continue()
      offModel ??= used
      return route.abort()
    })
    await page.goto(url)
    await dismissWelcome(page)
    await waitForRender(page, LOAD_TIMEOUT_MS)
    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await page.locator('#ai-chat').waitFor({ state: 'visible' })
  } catch (e) {
    await context.close().catch(() => {})
    throw e
  }

  const harness = async (method, arg) => {
    const r = await page.evaluate(async ([m, a]) => {
      try {
        return { ok: true, value: await globalThis.jscadHarness[m](a) }
      } catch (e) {
        return { ok: false, error: `${e?.name}: ${e?.message}` }
      }
    }, [method, arg])
    if (!r.ok) throw new Error(r.error)
    return r.value
  }

  const userRows = () => page.locator('.chat-msg.user').count()

  return {
    async send(text) {
      const before = await userRows()
      await page.locator('.chat-input').fill(text)
      await page.locator('.chat-send').click()
      // A turn that starts shows the message; a gated or unconfigured one shows an error instead.
      try {
        await page.waitForFunction((n) => document.querySelectorAll('.chat-msg.user').length > n, before, { timeout: SEND_TIMEOUT_MS, polling: POLL_MS })
      } catch (e) {
        if (!isTimeout(e)) throw e
        const shown = await page.locator('.chat-msg.error').last().textContent({ timeout: 1000 }).catch(() => null)
        throw new Error(`send did not start a turn${shown ? `: ${shown}` : ''}`)
      }
    },

    async waitTurn({ timeoutMs, onQuestion }) {
      const ended = (timedOut, rowError = null) => ({
        timedOut,
        error: offModel ? `builder request used ${offModel}` : rowError && `builder: ${rowError}`,
      })
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return ended(true)
        let state
        try {
          state = await (await page.waitForFunction(turnState, null, { timeout: remaining, polling: POLL_MS })).jsonValue()
        } catch (e) {
          if (isTimeout(e)) return ended(true)
          throw e
        }
        if (state.done) return ended(false, state.error)
        const answer = await onQuestion(state.question)
        await page.evaluate(answerOpenQuestion, answer)
      }
    },

    async stop() {
      const send = page.locator('.chat-send.running')
      if ((await send.count()) === 0) return
      // An empty input makes the click a Stop, not an answer to an open question.
      await page.locator('.chat-input').fill('')
      await send.click()
      await page.waitForFunction(() => !document.querySelector('.chat-send.running'), null, { timeout: STOP_TIMEOUT_MS, polling: POLL_MS })
    },

    lastAssistantText: () => page.evaluate(turnReply),
    view: (spec) => harness('view', spec),
    measure: (args) => harness('measure', args),
    check: (args) => harness('check', args),
    buildReport: () => harness('buildReport'),
    chatIds: () => [...chatIds],
    rounds: () => rounds,
    close: () => context.close(),
  }
}
